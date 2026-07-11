/**
 * Confirmation acknowledgment sender — Inngest function that sends a
 * free-form "confirmação recebida" WhatsApp message to a patient after
 * they confirm attendance.
 *
 * Triggered by `whatsapp/confirmation.ack` events emitted when a patient
 * confirms a session via the quick-reply button.
 *
 * The ack is a FREE-FORM message (not a platform Content template): it is
 * always sent inside Meta's 24-hour session window (the patient just replied
 * to a template), so it goes through the `sendFreeText` adapter. The body is a
 * module-level code constant rendered via `renderTemplate` — it does NOT read
 * `message_templates` (design D4). The `whatsapp_messages` row therefore keeps
 * `body` = the exact sent text (faithful record) and `template_key = NULL`
 * (the NULL-body rule applies only to pre-approved template sends).
 *
 * Steps:
 *   1. Check idempotency in DB (`sessionId:confirmed_ack`)
 *   2. Fetch session + patient + psychologist + account data
 *   3. Check if this is the first outbound message (consent footer)
 *   4. Render the free-form body and append the footer on the first message
 *   5. Send via the Twilio free-text adapter
 *   6. Insert whatsapp_messages record (body = sent text, template_key = NULL)
 *
 * Uses a SHA-256 idempotency key derived from `sessionId:confirmed_ack`
 * to prevent duplicate sends on retries.
 */

import { and, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { NonRetriableError } from 'inngest';

import { generateIdempotencyKey } from '@/modules/whatsapp/lib/reminders/idempotency-key';
import { renderTemplate } from '@/modules/whatsapp/lib/render-template';
import type {
  SendFreeTextInput,
  SendFreeTextResult,
} from '@/modules/whatsapp/server/adapters/twilio-bsp';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { whatsappAccounts, whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

import { inngest, WHATSAPP_EVENTS, type ConfirmationAckEventData } from './client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONSENT_FOOTER =
  'Voce esta recebendo essa mensagem via WhatsApp. ' +
  'Dados tratados conforme nossa Politica de Privacidade. ' +
  'Para parar de receber, responda PARAR.';

/**
 * Free-form ack body. Rendered via `renderTemplate` with `first_name` and
 * `professional_name`. Not stored in `message_templates` — the ack is a
 * platform-owned free-form message (design D4).
 */
const ACK_BODY_TEMPLATE =
  'Obrigado, {first_name}! Sua presença na sessão com {professional_name} está confirmada.';

const KIND = 'confirmed_ack';

/** Error codes that should NOT be retried. */
const NON_RETRIABLE_ERROR_CODES = new Set(['INVALID_PHONE', 'BLOCKED_BY_USER', 'OPT_OUT']);

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

export interface ConfirmationAckDeps {
  db: DrizzleDb;
  sendFreeText: (input: SendFreeTextInput) => Promise<SendFreeTextResult>;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ConfirmationAckResult {
  status: 'sent' | 'skipped' | 'unable_to_send' | 'failed';
  bspMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  skipReason?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the first name (first whitespace-delimited token) from a full name.
 * Newlines are treated as whitespace so they never leak into the sent body.
 */
function extractFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}

// ---------------------------------------------------------------------------
// Core logic (extracted for testing)
// ---------------------------------------------------------------------------

/**
 * Processes a confirmation acknowledgment send event.
 * Extracted from the Inngest handler for testability.
 */
export async function processConfirmationAck(
  eventData: ConfirmationAckEventData,
  deps: ConfirmationAckDeps,
): Promise<ConfirmationAckResult> {
  const { db, sendFreeText } = deps;

  const idempotencyKey = generateIdempotencyKey(eventData.sessionId, KIND);

  // Step 1: Check idempotency in DB
  const existingMessages = await db
    .select({ id: whatsappMessages.id })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.idempotencyKey, idempotencyKey),
        ne(whatsappMessages.status, 'failed'),
      ),
    )
    .limit(1);

  if (existingMessages.length > 0) {
    return { status: 'skipped', skipReason: 'already_sent' };
  }

  // Step 2: Fetch session (existence guard — FK integrity for the message row)
  const [sessionRow] = await db
    .select({ sessionId: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, eventData.sessionId))
    .limit(1);

  if (!sessionRow) {
    return { status: 'skipped', skipReason: 'session_not_found' };
  }

  const [patientRow] = await db
    .select({
      fullName: patients.fullName,
      phone: patients.phone,
      reminderPhone: patients.reminderPhone,
      whatsappOptOut: patients.whatsappOptOut,
    })
    .from(patients)
    .where(eq(patients.id, eventData.patientId))
    .limit(1);

  if (!patientRow) {
    return { status: 'skipped', skipReason: 'patient_not_found' };
  }

  if (patientRow.whatsappOptOut) {
    return { status: 'skipped', skipReason: 'patient_opted_out' };
  }

  const patientPhone = patientRow.reminderPhone ?? patientRow.phone;
  if (!patientPhone) {
    return { status: 'skipped', skipReason: 'no_phone' };
  }

  const [profileRow] = await db
    .select({ displayName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.userId, eventData.userId))
    .limit(1);

  if (!profileRow?.displayName) {
    return { status: 'skipped', skipReason: 'psychologist_not_found' };
  }

  // Fetch WhatsApp account
  const [accountRow] = await db
    .select({ id: whatsappAccounts.id, status: whatsappAccounts.status })
    .from(whatsappAccounts)
    .where(eq(whatsappAccounts.userId, eventData.userId))
    .limit(1);

  if (!accountRow || accountRow.status !== 'active') {
    return { status: 'skipped', skipReason: 'account_not_active' };
  }

  // Step 3: Check if first outbound message (consent footer)
  const priorMessages = await db
    .select({ id: whatsappMessages.id })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.patientId, eventData.patientId),
        eq(whatsappMessages.userId, eventData.userId),
        eq(whatsappMessages.direction, 'outbound'),
      ),
    )
    .limit(1);

  const isFirstMessage = priorMessages.length === 0;
  const consentFooter = isFirstMessage ? CONSENT_FOOTER : undefined;

  // Step 4: Render the free-form body (code constant, never message_templates)
  const bodyRendered = renderTemplate({
    body: ACK_BODY_TEMPLATE,
    vars: {
      first_name: extractFirstName(patientRow.fullName),
      professional_name: profileRow.displayName,
    },
  });
  // Free-form send — the sent text IS the persisted text (faithful record),
  // including the consent footer on the first outbound message.
  const sentBody = consentFooter ? `${bodyRendered}\n\n${consentFooter}` : bodyRendered;

  // Step 5: Send via the Twilio free-text adapter (no contentSid)
  const result = await sendFreeText({
    to: patientPhone,
    body: sentBody,
  });

  if (!result.ok) {
    const isNonRetriable = NON_RETRIABLE_ERROR_CODES.has(result.error.code);

    if (isNonRetriable) {
      await db.insert(whatsappMessages).values({
        userId: eventData.userId,
        patientId: eventData.patientId,
        sessionId: eventData.sessionId,
        direction: 'outbound',
        toPhone: patientPhone,
        body: sentBody,
        templateKey: null,
        idempotencyKey,
        status: 'unable_to_send',
        errorReason: `${result.error.code}: ${result.error.message}`,
      });

      return {
        status: 'unable_to_send',
        errorCode: result.error.code,
        errorMessage: result.error.message,
      };
    }

    // Retriable error — throw so Inngest retries
    throw new Error(`Twilio send failed: ${result.error.code} — ${result.error.message}`);
  }

  // Step 6: Insert whatsapp_messages record (free-form → body = sent text)
  await db.insert(whatsappMessages).values({
    userId: eventData.userId,
    patientId: eventData.patientId,
    sessionId: eventData.sessionId,
    direction: 'outbound',
    toPhone: patientPhone,
    body: sentBody,
    templateKey: null,
    bspMessageId: result.data.bspMessageId,
    idempotencyKey,
    status: 'sent',
    sentAt: new Date(),
  });

  return {
    status: 'sent',
    bspMessageId: result.data.bspMessageId,
  };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const confirmationAckSender = inngest.createFunction(
  {
    id: 'whatsapp-confirmation-ack-sender',
    triggers: [{ event: WHATSAPP_EVENTS.CONFIRMATION_ACK }],
    retries: 3,
    onFailure: async ({ error, event, logger }) => {
      const { db } = await import('@/shared/db/client');

      const originalEvent = event.data.event;
      const data = originalEvent.data as ConfirmationAckEventData;
      const idempotencyKey = generateIdempotencyKey(data.sessionId, KIND);

      await db.insert(whatsappMessages).values({
        userId: data.userId,
        patientId: data.patientId,
        sessionId: data.sessionId,
        direction: 'outbound',
        templateKey: null,
        idempotencyKey,
        status: 'failed',
        errorReason: error.message,
      });

      logger.error(
        {
          event: 'confirmation_ack_send_exhausted',
          userId: data.userId,
          sessionId: data.sessionId,
          patientId: data.patientId,
          errorMessage: error.message,
        },
        `Confirmation ACK send failed after all retries for session ${data.sessionId}`,
      );
    },
  },
  async ({ event, step, logger }) => {
    const { db } = await import('@/shared/db/client');
    const { sendFreeText } = await import('@/modules/whatsapp/server/adapters/twilio-bsp');

    const data = event.data as ConfirmationAckEventData;

    const result = await step.run('process-confirmation-ack', async () => {
      return processConfirmationAck(data, { db, sendFreeText });
    });

    if (result.status === 'unable_to_send') {
      throw new NonRetriableError(`Unable to send: ${result.errorCode} — ${result.errorMessage}`);
    }

    logger.info(
      {
        event: 'confirmation_ack_complete',
        status: result.status,
        sessionId: data.sessionId,
        bspMessageId: result.bspMessageId,
        skipReason: result.skipReason,
      },
      `Confirmation ACK for session ${data.sessionId}: ${result.status}`,
    );

    return result;
  },
);
