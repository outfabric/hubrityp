import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { renderTemplate } from '@/modules/whatsapp/lib/render-template';
import {
  sendTemplate,
  type SendTemplateInput,
  type SendTemplateResult,
} from '@/modules/whatsapp/server/adapters/twilio-bsp';
import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import {
  messageTemplates,
  whatsappConversations,
  whatsappMessages,
  type WhatsappMessage,
} from '@/shared/db/schema/whatsapp/tables';

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

export interface SendTemplateReplyDeps {
  sendTemplate: (input: SendTemplateInput) => Promise<SendTemplateResult>;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type SendTemplateReplyResult =
  | { ok: true; message: WhatsappMessage }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'template_not_found' }
  | { ok: false; error: 'template_not_approved' }
  | { ok: false; error: 'patient_not_found' }
  | { ok: false; error: 'no_phone' }
  | { ok: false; error: 'no_content_sid' }
  | { ok: false; error: 'render_failed'; message: string }
  | { ok: false; error: 'send_failed'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Sends a template-based WhatsApp reply to a patient. This is the fallback
 * mechanism when the 24-hour session window has expired.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Look up the template by (user_id, template_key).
 *   3. Verify the template is approved.
 *   4. Render the template body with the provided variables.
 *   5. Send via Twilio adapter `sendTemplate`.
 *   6. Persist in `whatsapp_messages` (direction='outbound', template_key set).
 *   7. Upsert `whatsapp_conversations`.
 */
export async function sendTemplateReplyImpl(
  supabase: SupabaseClient,
  patientId: string,
  templateKey: string,
  variables: Record<string, string>,
  deps: SendTemplateReplyDeps = { sendTemplate },
): Promise<SendTemplateReplyResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Find the template
  const [template] = await db
    .select()
    .from(messageTemplates)
    .where(and(eq(messageTemplates.userId, user.id), eq(messageTemplates.templateKey, templateKey)))
    .limit(1);

  if (!template) {
    return { ok: false, error: 'template_not_found' };
  }

  // 3. Verify approval
  if (template.metaStatus !== 'approved') {
    return { ok: false, error: 'template_not_approved' };
  }

  if (!template.metaTemplateId) {
    return { ok: false, error: 'no_content_sid' };
  }

  // 4. Fetch patient
  const [patient] = await db
    .select({ id: patients.id, phone: patients.phone })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, user.id)))
    .limit(1);

  if (!patient) {
    return { ok: false, error: 'patient_not_found' };
  }

  if (!patient.phone) {
    return { ok: false, error: 'no_phone' };
  }

  // 5. Render template body
  let bodyRendered: string;
  try {
    bodyRendered = renderTemplate({ body: template.body, vars: variables });
  } catch (err: unknown) {
    return {
      ok: false,
      error: 'render_failed',
      message: err instanceof Error ? err.message : 'Failed to render template',
    };
  }

  // 6. Send via Twilio adapter
  const sendResult = await deps.sendTemplate({
    to: patient.phone,
    fromAccountId: user.id,
    templateKey,
    contentSid: template.metaTemplateId,
    variables,
    bodyRendered,
  });

  if (!sendResult.ok) {
    return { ok: false, error: 'send_failed', message: sendResult.error.message };
  }

  // 7. Persist in whatsapp_messages
  const [persisted] = await db
    .insert(whatsappMessages)
    .values({
      userId: user.id,
      patientId,
      direction: 'outbound',
      toPhone: patient.phone,
      body: bodyRendered,
      templateKey,
      bspMessageId: sendResult.data.bspMessageId,
      status: 'sent',
      sentAt: sql`now()`,
    })
    .returning();

  // 8. Upsert whatsapp_conversations
  if (persisted) {
    const preview = bodyRendered.length > 80 ? bodyRendered.slice(0, 77) + '...' : bodyRendered;
    await db
      .insert(whatsappConversations)
      .values({
        userId: user.id,
        patientId,
        lastMessageId: persisted.id,
        lastMessageAt: persisted.createdAt,
        lastMessagePreview: preview,
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
