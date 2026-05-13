import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq, sql } from 'drizzle-orm';

import { freeTextReplySchema } from '@/modules/whatsapp/lib/inbox/free-text-reply-schema';
import {
  sendFreeText,
  type SendFreeTextResult,
} from '@/modules/whatsapp/server/adapters/twilio-bsp';
import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import {
  whatsappConversations,
  whatsappMessages,
  type WhatsappMessage,
} from '@/shared/db/schema/whatsapp/tables';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Meta's session window in milliseconds (24 hours). */
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

export interface SendFreeTextReplyDeps {
  sendFreeText: (input: { to: string; body: string }) => Promise<SendFreeTextResult>;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type SendFreeTextReplyResult =
  | { ok: true; message: WhatsappMessage }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'window_expired' }
  | { ok: false; error: 'clinical_content_blocked'; reason: string }
  | { ok: false; error: 'patient_not_found' }
  | { ok: false; error: 'no_phone' }
  | { ok: false; error: 'send_failed'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Sends a free-text WhatsApp reply to a patient within the 24-hour
 * session window.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input with `freeTextReplySchema` (includes clinical-content check).
 *   3. Verify 24-hour window: query last inbound message, reject if >24h.
 *   4. Call Twilio adapter `sendFreeText`.
 *   5. Persist in `whatsapp_messages` (direction='outbound', template_key=null).
 *   6. Upsert `whatsapp_conversations` with updated last_message info.
 *   7. Return persisted message.
 */
export async function sendFreeTextReplyImpl(
  supabase: SupabaseClient,
  patientId: string,
  rawInput: unknown,
  deps: SendFreeTextReplyDeps = { sendFreeText },
): Promise<SendFreeTextReplyResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input with Zod (includes clinical-content blocker refinement)
  const parsed = freeTextReplySchema.safeParse(rawInput);
  if (!parsed.success) {
    // The clinical-content blocker fires as a Zod `custom` issue on the 'body'
    // path. If present, surface it as a dedicated error variant so the UI can
    // render the appropriate warning.
    const clinicalIssue = parsed.error.issues.find(
      (issue) => issue.code === 'custom' && issue.path[0] === 'body',
    );

    if (clinicalIssue) {
      return { ok: false, error: 'clinical_content_blocked', reason: clinicalIssue.message };
    }

    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { body } = parsed.data;

  // 3. Fetch patient info and phone
  const [patient] = await db
    .select({
      id: patients.id,
      phone: patients.phone,
    })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, user.id)))
    .limit(1);

  if (!patient) {
    return { ok: false, error: 'patient_not_found' };
  }

  if (!patient.phone) {
    return { ok: false, error: 'no_phone' };
  }

  // 4. Verify 24-hour session window
  const [lastInbound] = await db
    .select({ createdAt: whatsappMessages.createdAt })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.patientId, patientId),
        eq(whatsappMessages.userId, user.id),
        eq(whatsappMessages.direction, 'inbound'),
      ),
    )
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(1);

  if (!lastInbound) {
    return { ok: false, error: 'window_expired' };
  }

  const elapsed = Date.now() - lastInbound.createdAt.getTime();
  if (elapsed > SESSION_WINDOW_MS) {
    return { ok: false, error: 'window_expired' };
  }

  // 5. Send via Twilio adapter
  const sendResult = await deps.sendFreeText({ to: patient.phone, body });

  if (!sendResult.ok) {
    return { ok: false, error: 'send_failed', message: sendResult.error.message };
  }

  // 6. Persist in whatsapp_messages
  const [persisted] = await db
    .insert(whatsappMessages)
    .values({
      userId: user.id,
      patientId,
      direction: 'outbound',
      toPhone: patient.phone,
      body,
      templateKey: null,
      bspMessageId: sendResult.data.bspMessageId,
      status: 'sent',
      sentAt: sql`now()`,
    })
    .returning();

  // 7. Upsert whatsapp_conversations
  if (persisted) {
    await db
      .insert(whatsappConversations)
      .values({
        userId: user.id,
        patientId,
        lastMessageId: persisted.id,
        lastMessageAt: persisted.createdAt,
        lastMessagePreview: body.slice(0, 80),
        unreadCount: 0,
      })
      .onConflictDoUpdate({
        target: [whatsappConversations.userId, whatsappConversations.patientId],
        set: {
          lastMessageId: sql`EXCLUDED.last_message_id`,
          lastMessageAt: sql`EXCLUDED.last_message_at`,
          lastMessagePreview: sql`EXCLUDED.last_message_preview`,
          updatedAt: sql`now()`,
        },
      });
  }

  return { ok: true, message: persisted! };
}
