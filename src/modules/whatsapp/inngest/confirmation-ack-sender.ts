/**
 * Confirmation acknowledgment sender — Inngest function that sends a
 * "confirmacao_recebida" WhatsApp message to a patient after they
 * confirm attendance.
 *
 * Triggered by `whatsapp/confirmation.ack` events emitted when a patient
 * confirms a session via the quick-reply button.
 *
 * Steps:
 *   1. Fetch session + patient + psychologist + location data
 *   2. Fetch the "confirmacao_recebida" template for the psychologist
 *   3. Check if this is the first outbound message (consent footer)
 *   4. Select template variables for kind 'confirmed_ack'
 *   5. Render template body
 *   6. Send via Twilio adapter
 *   7. Insert whatsapp_messages record
 *
 * Uses a SHA-256 idempotency key derived from `sessionId:confirmed_ack`
 * to prevent duplicate sends on retries.
 */

import { and, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { NonRetriableError } from 'inngest';

import { generateIdempotencyKey } from '@/modules/whatsapp/lib/reminders/idempotency-key';
import { selectTemplateVariables } from '@/modules/whatsapp/lib/reminders/select-template-variables';
import { renderTemplate } from '@/modules/whatsapp/lib/render-template';
import type {
  SendTemplateInput,
  SendTemplateResult,
} from '@/modules/whatsapp/server/adapters/twilio-bsp';
import { locations, sessions } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import {
  messageTemplates,
  whatsappAccounts,
  whatsappMessages,
} from '@/shared/db/schema/whatsapp/tables';

import { inngest, WHATSAPP_EVENTS, type ConfirmationAckEventData } from './client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONSENT_FOOTER =
  'Voce esta recebendo essa mensagem via WhatsApp. ' +
  'Dados tratados conforme nossa Politica de Privacidade. ' +
  'Para parar de receber, responda PARAR.';

const TEMPLATE_KEY = 'confirmacao_recebida';
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
  sendTemplate: (input: SendTemplateInput) => Promise<SendTemplateResult>;
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
  const { db, sendTemplate } = deps;

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

  // Step 2: Fetch session + patient + psychologist + location
  const [sessionRow] = await db
    .select({
      sessionId: sessions.id,
      startAt: sessions.startAt,
      durationMinutes: sessions.durationMinutes,
      modality: sessions.modality,
      locationId: sessions.locationId,
      amount: sessions.amount,
      patientId: sessions.patientId,
    })
    .from(sessions)
    .where(eq(sessions.id, eventData.sessionId))
    .limit(1);

  if (!sessionRow) {
    return { status: 'skipped', skipReason: 'session_not_found' };
  }

  const [patientRow] = await db
    .select({
      firstName: patients.fullName,
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

  // Extract first name from full name
  const patientFirstName = patientRow.firstName.split(' ')[0] ?? patientRow.firstName;

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

  // Fetch template
  const [templateRow] = await db
    .select({
      body: messageTemplates.body,
      contentSid: messageTemplates.metaTemplateId,
    })
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.userId, eventData.userId),
        eq(messageTemplates.templateKey, TEMPLATE_KEY),
      ),
    )
    .limit(1);

  if (!templateRow?.contentSid) {
    return { status: 'skipped', skipReason: 'template_not_found' };
  }

  // Fetch location (optional)
  let locationData: {
    name: string;
    address: string | null;
    arrivalInstructions: string | null;
  } | null = null;
  if (sessionRow.locationId) {
    const [locRow] = await db
      .select({
        name: locations.name,
        address: locations.address,
        arrivalInstructions: locations.arrivalInstructions,
      })
      .from(locations)
      .where(eq(locations.id, sessionRow.locationId))
      .limit(1);

    if (locRow) {
      locationData = locRow;
    }
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

  // Step 4: Select template variables
  const sessionValue = sessionRow.amount != null ? Number(sessionRow.amount) : null;
  const variables = selectTemplateVariables(
    {
      startAt: sessionRow.startAt,
      durationMinutes: sessionRow.durationMinutes,
      modality: sessionRow.modality ?? 'in_person',
      sessionValue,
    },
    {
      firstName: patientFirstName,
      fullName: patientRow.firstName,
    },
    {
      displayName: profileRow.displayName,
    },
    locationData,
    KIND,
  );

  // Step 5: Render template body
  const bodyRendered = renderTemplate({
    body: templateRow.body,
    vars: variables,
  });

  // Step 6: Send via Twilio adapter
  const result = await sendTemplate({
    to: patientPhone,
    fromAccountId: accountRow.id,
    templateKey: TEMPLATE_KEY,
    contentSid: templateRow.contentSid,
    variables,
    bodyRendered,
    consentFooter,
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
        body: bodyRendered,
        templateKey: TEMPLATE_KEY,
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

  // Step 7: Insert whatsapp_messages record
  await db.insert(whatsappMessages).values({
    userId: eventData.userId,
    patientId: eventData.patientId,
    sessionId: eventData.sessionId,
    direction: 'outbound',
    toPhone: patientPhone,
    body: bodyRendered,
    templateKey: TEMPLATE_KEY,
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
        templateKey: TEMPLATE_KEY,
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
    const { sendTemplate } = await import('@/modules/whatsapp/server/adapters/twilio-bsp');

    const data = event.data as ConfirmationAckEventData;

    const result = await step.run('process-confirmation-ack', async () => {
      return processConfirmationAck(data, { db, sendTemplate });
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
