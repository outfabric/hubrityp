import 'server-only';

import { and, desc, eq, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  AUTO_REPLY_BODY,
  AUTO_REPLY_TEMPLATE_KEY,
  shouldSendAutoReply,
} from '@/modules/whatsapp/lib/auto-reply';
import type { SendFreeTextResult } from '@/modules/whatsapp/server/adapters/twilio-bsp';
import { patients } from '@/shared/db/schema/patients/tables';
import { whatsappMessages } from '@/shared/db/schema/whatsapp/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

export interface ProcessInboundAutoReplyInput {
  /** Patient phone in E.164 (the inbound `From`, stripped of `whatsapp:`). */
  fromPhone: string;
  /** BSP message SID of the inbound message (Twilio `MessageSid`). */
  bspMessageId: string;
  /** Platform's shared WhatsApp number in E.164 (the inbound `To`). */
  platformPhone: string;
}

export interface ProcessInboundAutoReplyDeps {
  db: DrizzleDb;
  sendFreeText: (input: { to: string; body: string }) => Promise<SendFreeTextResult>;
  /** Injectable clock for deterministic throttle tests. */
  now?: () => Date;
}

export type ProcessInboundAutoReplyResult =
  | { status: 'no_patient' }
  | { status: 'throttled'; patientId: string }
  | { status: 'send_failed'; patientId: string }
  | { status: 'sent'; patientId: string; bspMessageId: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Handles an inbound free-text WhatsApp message by sending a single fixed
 * auto-reply, throttled to at most once per phone per 24h.
 *
 * Flow:
 *   1. Resolve the patient by phone (`phone` or `reminder_phone`). If no
 *      patient matches, do nothing — we never message unknown numbers and
 *      cannot anchor a `user_id` (audit/throttle) without one.
 *   2. Persist the inbound message in `whatsapp_messages` for the LGPD audit
 *      trail (`ON CONFLICT (bsp_message_id) DO NOTHING` for idempotency).
 *      This does NOT touch `whatsapp_conversations` — the inbox stays out of
 *      the auto-reply flow.
 *   3. Look up the most recent outbound auto-reply to this phone and apply
 *      the 24h throttle. If suppressed, stop here.
 *   4. Send the fixed auto-reply via the BSP adapter and persist the outbound
 *      row. Send failures are logged (no PII) and never throw.
 *
 * Owner scope: `whatsapp_messages` rows are stamped with the resolved
 * patient's `user_id`, never a client-supplied value.
 */
export async function processInboundAutoReply(
  input: ProcessInboundAutoReplyInput,
  deps: ProcessInboundAutoReplyDeps,
): Promise<ProcessInboundAutoReplyResult> {
  const { db, now = () => new Date() } = deps;
  const { fromPhone, bspMessageId, platformPhone } = input;

  if (!fromPhone) {
    return { status: 'no_patient' };
  }

  // Step 1: Resolve the patient by phone (match `phone` or `reminder_phone`).
  // A shared number may match patients across psychologists; we anchor the
  // audit/throttle rows on the first match (the reply itself is per-phone).
  const [patient] = await db
    .select({ id: patients.id, userId: patients.userId })
    .from(patients)
    .where(or(eq(patients.phone, fromPhone), eq(patients.reminderPhone, fromPhone)))
    .limit(1);

  if (!patient) {
    return { status: 'no_patient' };
  }

  // Step 2: Persist the inbound message (audit trail). Idempotent on the
  // partial UNIQUE index over bsp_message_id — a Twilio retry of the same
  // inbound is ignored. Does NOT touch whatsapp_conversations.
  await db
    .insert(whatsappMessages)
    .values({
      userId: patient.userId,
      patientId: patient.id,
      direction: 'inbound',
      fromPhone,
      toPhone: platformPhone,
      bspMessageId,
    })
    .onConflictDoNothing({
      // bsp_message_id is backed by a PARTIAL unique index (WHERE NOT NULL),
      // so the arbiter predicate must be repeated for conflict inference.
      target: whatsappMessages.bspMessageId,
      where: sql`${whatsappMessages.bspMessageId} IS NOT NULL`,
    });

  // Step 3: Throttle — find the last outbound auto-reply to this phone.
  const [lastAutoReply] = await db
    .select({ createdAt: whatsappMessages.createdAt })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.direction, 'outbound'),
        eq(whatsappMessages.templateKey, AUTO_REPLY_TEMPLATE_KEY),
        eq(whatsappMessages.toPhone, fromPhone),
      ),
    )
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(1);

  if (!shouldSendAutoReply(lastAutoReply?.createdAt ?? null, now())) {
    return { status: 'throttled', patientId: patient.id };
  }

  // Step 4: Send the fixed auto-reply and persist the outbound row.
  const sendResult = await deps.sendFreeText({ to: fromPhone, body: AUTO_REPLY_BODY });

  if (!sendResult.ok) {
    logger.error(
      {
        event: 'whatsapp_auto_reply_send_failed',
        errorCode: sendResult.error.code,
        userId: patient.userId,
        patientId: patient.id,
      },
      'Failed to send WhatsApp auto-reply',
    );
    return { status: 'send_failed', patientId: patient.id };
  }

  await db.insert(whatsappMessages).values({
    userId: patient.userId,
    patientId: patient.id,
    direction: 'outbound',
    fromPhone: platformPhone,
    toPhone: fromPhone,
    body: AUTO_REPLY_BODY,
    templateKey: AUTO_REPLY_TEMPLATE_KEY,
    bspMessageId: sendResult.data.bspMessageId,
    status: 'sent',
    sentAt: sql`now()`,
  });

  return { status: 'sent', patientId: patient.id, bspMessageId: sendResult.data.bspMessageId };
}
