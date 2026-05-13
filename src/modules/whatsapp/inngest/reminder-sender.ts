/**
 * Reminder sender — Inngest function that sends a single WhatsApp
 * reminder message to a patient.
 *
 * Triggered by `whatsapp/reminder.send` events emitted by the dispatcher.
 * Uses function-level idempotency via `event.data.idempotencyKey` and
 * DB-level idempotency check before calling Twilio.
 *
 * Steps:
 *   1. Check idempotency in DB (skip if already sent)
 *   2. Check if this is the first message to the patient (consent footer)
 *   3. Select template variables
 *   4. Render template body
 *   5. Send via Twilio adapter
 *   6. Insert whatsapp_messages record
 *
 * Error handling:
 *   - INVALID_PHONE / BLOCKED_BY_USER → status='unable_to_send', no retry
 *   - Other failures after retries → status='failed', notify psychologist
 */

import { and, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { NonRetriableError } from 'inngest';

import { selectTemplateVariables } from '@/modules/whatsapp/lib/reminders/select-template-variables';
import { renderTemplate } from '@/modules/whatsapp/lib/render-template';
import type {
  SendTemplateInput,
  SendTemplateResult,
} from '@/modules/whatsapp/server/adapters/twilio-bsp';
import { whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

import { inngest, WHATSAPP_EVENTS, type ReminderSendEventData } from './client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONSENT_FOOTER =
  'Voce esta recebendo essa mensagem via WhatsApp. ' +
  'Dados tratados conforme nossa Politica de Privacidade. ' +
  'Para parar de receber, responda PARAR.';

/** Error codes that should NOT be retried — the phone is permanently unreachable. */
const NON_RETRIABLE_ERROR_CODES = new Set(['INVALID_PHONE', 'BLOCKED_BY_USER', 'OPT_OUT']);

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

/** Minimal DB interface — any Drizzle Postgres client or transaction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

export interface SenderDeps {
  db: DrizzleDb;
  sendTemplate: (input: SendTemplateInput) => Promise<SendTemplateResult>;
}

// ---------------------------------------------------------------------------
// Core sender logic (extracted for testing)
// ---------------------------------------------------------------------------

export interface SenderResult {
  status: 'sent' | 'skipped' | 'unable_to_send' | 'failed';
  bspMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Core sender logic — processes a single reminder send event.
 * Extracted from the Inngest handler for testability.
 */
export async function processReminderSend(
  eventData: ReminderSendEventData,
  deps: SenderDeps,
): Promise<SenderResult> {
  const { db, sendTemplate } = deps;

  // Step 1: Check idempotency in DB
  const existingMessages = await db
    .select({ id: whatsappMessages.id })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.idempotencyKey, eventData.idempotencyKey),
        ne(whatsappMessages.status, 'failed'),
      ),
    )
    .limit(1);

  if (existingMessages.length > 0) {
    return { status: 'skipped' };
  }

  // Step 2: Check if this is the first outbound message to the patient
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

  // Step 3: Select template variables
  const variables = selectTemplateVariables(
    {
      startAt: new Date(eventData.sessionStartAt),
      durationMinutes: eventData.sessionDurationMinutes,
      modality: eventData.sessionModality,
      videoLink: eventData.videoLink,
      confirmationLink: eventData.confirmationLink,
      sessionValue: eventData.sessionValue,
    },
    {
      firstName: eventData.patientFirstName,
      fullName: eventData.patientFullName,
    },
    {
      displayName: eventData.psychologistDisplayName,
    },
    eventData.locationName
      ? {
          name: eventData.locationName,
          address: eventData.locationAddress,
          arrivalInstructions: eventData.locationArrivalInstructions,
        }
      : null,
    eventData.kind,
  );

  // Step 4: Render template body
  const bodyRendered = renderTemplate({
    body: eventData.templateBody,
    vars: variables,
  });

  // Step 5: Send via Twilio adapter
  const result = await sendTemplate({
    to: eventData.patientPhone,
    fromAccountId: eventData.whatsappAccountId,
    templateKey: eventData.templateKey,
    contentSid: eventData.contentSid,
    variables,
    bodyRendered,
    consentFooter,
  });

  if (!result.ok) {
    const isNonRetriable = NON_RETRIABLE_ERROR_CODES.has(result.error.code);

    if (isNonRetriable) {
      // Insert message record with unable_to_send status
      await db.insert(whatsappMessages).values({
        userId: eventData.userId,
        patientId: eventData.patientId,
        sessionId: eventData.sessionId,
        direction: 'outbound',
        toPhone: eventData.patientPhone,
        body: bodyRendered,
        templateKey: eventData.templateKey,
        idempotencyKey: eventData.idempotencyKey,
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

  // Step 6: Insert whatsapp_messages record
  await db.insert(whatsappMessages).values({
    userId: eventData.userId,
    patientId: eventData.patientId,
    sessionId: eventData.sessionId,
    direction: 'outbound',
    toPhone: eventData.patientPhone,
    body: bodyRendered,
    templateKey: eventData.templateKey,
    bspMessageId: result.data.bspMessageId,
    idempotencyKey: eventData.idempotencyKey,
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

export const reminderSender = inngest.createFunction(
  {
    id: 'whatsapp-reminder-sender',
    triggers: [{ event: WHATSAPP_EVENTS.REMINDER_SEND }],
    idempotency: 'event.data.idempotencyKey',
    retries: 3,
    onFailure: async ({ error, event, logger }) => {
      // After all retries exhausted — record as failed and notify psychologist
      const { db } = await import('@/shared/db/client');

      // The failure event wraps the original event
      const originalEvent = event.data.event;
      const data = originalEvent.data as ReminderSendEventData;

      // Insert failed message record
      await db.insert(whatsappMessages).values({
        userId: data.userId,
        patientId: data.patientId,
        sessionId: data.sessionId,
        direction: 'outbound',
        toPhone: data.patientPhone,
        templateKey: data.templateKey,
        idempotencyKey: data.idempotencyKey,
        status: 'failed',
        errorReason: error.message,
      });

      // Log the failure for the psychologist notification system
      // (notification infrastructure to be added in a future change)
      logger.error(
        {
          event: 'reminder_send_exhausted',
          userId: data.userId,
          sessionId: data.sessionId,
          patientId: data.patientId,
          kind: data.kind,
          errorMessage: error.message,
        },
        `Reminder send failed after all retries for session ${data.sessionId}`,
      );
    },
  },
  async ({ event, step, logger }) => {
    const { db } = await import('@/shared/db/client');
    const { sendTemplate } = await import('@/modules/whatsapp/server/adapters/twilio-bsp');

    const data = event.data as ReminderSendEventData;

    const result = await step.run('process-reminder-send', async () => {
      return processReminderSend(data, { db, sendTemplate });
    });

    if (result.status === 'unable_to_send') {
      // Throw NonRetriableError to prevent Inngest from retrying
      throw new NonRetriableError(`Unable to send: ${result.errorCode} — ${result.errorMessage}`);
    }

    logger.info(
      {
        event: 'reminder_send_complete',
        status: result.status,
        sessionId: data.sessionId,
        kind: data.kind,
        bspMessageId: result.bspMessageId,
      },
      `Reminder ${data.kind} for session ${data.sessionId}: ${result.status}`,
    );

    return result;
  },
);
