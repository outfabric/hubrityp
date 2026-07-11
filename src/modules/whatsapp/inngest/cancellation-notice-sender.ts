/**
 * Cancellation notice sender — Inngest function that sends a
 * "cancelamento_aviso" WhatsApp message to a patient when the
 * psychologist cancels a session.
 *
 * Triggered by `agenda/session.cancelled` events emitted by the
 * cancel-session Server Action.
 *
 * Guard conditions (all must pass before sending):
 *   - cancelled_by != 'patient' (patient already knows)
 *   - patient.whatsapp_opt_out = false
 *   - whatsapp_accounts.status = 'active'
 *
 * Steps:
 *   1. Validate guard conditions
 *   2. Fetch session + patient + psychologist data
 *   3. Resolve the "cancelamento_aviso" Content SID from serverEnv
 *   4. Build named contentVariables via the platform template contract
 *   5. Send the Content template via the Twilio adapter
 *   6. Insert whatsapp_messages record (body IS NULL — template send)
 *
 * The SID comes from `serverEnv` (via the contract), never from
 * `message_templates`. Template sends carry no rendered body and no consent
 * footer — the platform Content template is pre-approved (design D9).
 *
 * Uses a SHA-256 idempotency key derived from `sessionId:cancelled`
 * to prevent duplicate sends on retries.
 */

import { and, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { NonRetriableError } from 'inngest';

import { type SessionCancelledEvent } from '@/modules/agenda/lib/session-events';
import { generateIdempotencyKey } from '@/modules/whatsapp/lib/reminders/idempotency-key';
import {
  buildContentVariables,
  resolvePlatformContentSid,
} from '@/modules/whatsapp/lib/reminders/platform-template-contract';
import type {
  SendTemplateInput,
  SendTemplateResult,
} from '@/modules/whatsapp/server/adapters/twilio-bsp';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { whatsappAccounts, whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

import { inngest } from './client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEMPLATE_KEY = 'cancelamento_aviso';
const KIND = 'cancelled';
const EVENT_NAME = 'agenda/session.cancelled';

/** Error codes that should NOT be retried. */
const NON_RETRIABLE_ERROR_CODES = new Set(['INVALID_PHONE', 'BLOCKED_BY_USER', 'OPT_OUT']);

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

export interface CancellationNoticeDeps {
  db: DrizzleDb;
  sendTemplate: (input: SendTemplateInput) => Promise<SendTemplateResult>;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface CancellationNoticeResult {
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
 * Processes a cancellation notice send event.
 * Extracted from the Inngest handler for testability.
 */
export async function processCancellationNotice(
  eventData: SessionCancelledEvent,
  deps: CancellationNoticeDeps,
): Promise<CancellationNoticeResult> {
  const { db, sendTemplate } = deps;

  // Guard 1: Skip if patient cancelled (they already know)
  if (eventData.cancelledBy === 'patient') {
    return { status: 'skipped', skipReason: 'cancelled_by_patient' };
  }

  const idempotencyKey = generateIdempotencyKey(eventData.sessionId, KIND);

  // Check idempotency in DB
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

  // Guard 2: Check patient opt-out
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

  // Guard 3: Check WhatsApp account status
  const [accountRow] = await db
    .select({ id: whatsappAccounts.id, status: whatsappAccounts.status })
    .from(whatsappAccounts)
    .where(eq(whatsappAccounts.userId, eventData.userId))
    .limit(1);

  if (!accountRow || accountRow.status !== 'active') {
    return { status: 'skipped', skipReason: 'account_not_active' };
  }

  // Fetch psychologist profile (maps to professional_name)
  const [profileRow] = await db
    .select({ displayName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.userId, eventData.userId))
    .limit(1);

  if (!profileRow?.displayName) {
    return { status: 'skipped', skipReason: 'psychologist_not_found' };
  }

  // Fetch session data (only the start instant is needed by the contract)
  const [sessionRow] = await db
    .select({ startAt: sessions.startAt })
    .from(sessions)
    .where(eq(sessions.id, eventData.sessionId))
    .limit(1);

  if (!sessionRow) {
    return { status: 'skipped', skipReason: 'session_not_found' };
  }

  // Resolve the platform Content SID from serverEnv (never message_templates).
  const contentSid = resolvePlatformContentSid(TEMPLATE_KEY);
  if (!contentSid) {
    return { status: 'skipped', skipReason: 'template_not_found' };
  }

  // Build the named contentVariables from the platform template contract.
  const variables = buildContentVariables(TEMPLATE_KEY, {
    patientFullName: patientRow.fullName,
    professionalName: profileRow.displayName,
    startAt: sessionRow.startAt,
  });

  // Send the Content template via the Twilio adapter
  const result = await sendTemplate({
    to: patientPhone,
    templateKey: TEMPLATE_KEY,
    contentSid,
    variables,
  });

  if (!result.ok) {
    const isNonRetriable = NON_RETRIABLE_ERROR_CODES.has(result.error.code);

    if (isNonRetriable) {
      // Template send — no rendered body (design D9), persist body IS NULL.
      await db.insert(whatsappMessages).values({
        userId: eventData.userId,
        patientId: eventData.patientId,
        sessionId: eventData.sessionId,
        direction: 'outbound',
        toPhone: patientPhone,
        body: null,
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

  // Insert whatsapp_messages record (body IS NULL — template send)
  await db.insert(whatsappMessages).values({
    userId: eventData.userId,
    patientId: eventData.patientId,
    sessionId: eventData.sessionId,
    direction: 'outbound',
    toPhone: patientPhone,
    body: null,
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

export const cancellationNoticeSender = inngest.createFunction(
  {
    id: 'whatsapp-cancellation-notice-sender',
    triggers: [{ event: EVENT_NAME }],
    retries: 3,
    onFailure: async ({ error, event, logger }) => {
      const { db } = await import('@/shared/db/client');

      const originalEvent = event.data.event;
      const data = originalEvent.data as SessionCancelledEvent;
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
          event: 'cancellation_notice_send_exhausted',
          userId: data.userId,
          sessionId: data.sessionId,
          patientId: data.patientId,
          errorMessage: error.message,
        },
        `Cancellation notice send failed after all retries for session ${data.sessionId}`,
      );
    },
  },
  async ({ event, step, logger }) => {
    const { db } = await import('@/shared/db/client');
    const { sendTemplate } = await import('@/modules/whatsapp/server/adapters/twilio-bsp');

    const data = event.data as SessionCancelledEvent;

    const result = await step.run('process-cancellation-notice', async () => {
      return processCancellationNotice(data, { db, sendTemplate });
    });

    if (result.status === 'unable_to_send') {
      throw new NonRetriableError(`Unable to send: ${result.errorCode} — ${result.errorMessage}`);
    }

    logger.info(
      {
        event: 'cancellation_notice_complete',
        status: result.status,
        sessionId: data.sessionId,
        bspMessageId: result.bspMessageId,
        skipReason: result.skipReason,
      },
      `Cancellation notice for session ${data.sessionId}: ${result.status}`,
    );

    return result;
  },
);
