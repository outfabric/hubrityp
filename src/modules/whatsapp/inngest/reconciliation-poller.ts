/**
 * Reconciliation poller — Inngest cron function that reconciles stuck
 * WhatsApp messages by polling Twilio for their current status.
 *
 * Runs every 30 minutes. Queries `whatsapp_messages` for rows with
 * `status IN ('queued', 'sent')` and `sent_at < NOW() - 5 min`. For each,
 * it calls the Twilio Messages API via `bsp_message_id` and updates the
 * DB row if the status has advanced.
 *
 * Why polling: Twilio webhooks can fail temporarily (~1% failure rate).
 * The poller acts as a safety net to ensure eventual consistency.
 *
 * Status transitions are monotonic — we only advance forward:
 *   queued → sent → delivered → read
 * Never regress (e.g., delivered → sent is ignored).
 */

import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

import { inngest } from './client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum age (in minutes) for a message to be considered "stuck".
 * Messages younger than this are still within Twilio's normal delivery window.
 */
const STUCK_THRESHOLD_MINUTES = 5;

/**
 * Monotonic status ordering — higher index = more advanced.
 * Used to ensure we only advance status, never regress.
 */
const STATUS_ORDER: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/**
 * Maps Twilio message status strings to our internal status enum.
 * Twilio statuses: queued, sending, sent, delivered, read, failed, undelivered.
 */
const TWILIO_STATUS_MAP: Record<string, string> = {
  queued: 'queued',
  sending: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
  undelivered: 'failed',
};

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

/** Minimal DB interface — any Drizzle Postgres client or transaction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

/** Minimal interface for what Twilio returns when fetching a message. */
export interface TwilioMessageResource {
  status: string;
  errorCode?: number | null;
  errorMessage?: string | null;
}

/** Function signature for fetching a single Twilio message by SID. */
export type FetchTwilioMessage = (bspMessageId: string) => Promise<TwilioMessageResource>;

export interface ReconciliationDeps {
  db: DrizzleDb;
  fetchTwilioMessage: FetchTwilioMessage;
  now: Date;
}

// ---------------------------------------------------------------------------
// Core reconciliation logic (extracted for testing)
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  stuckMessagesFound: number;
  messagesReconciled: number;
  messagesFailed: number;
  errors: number;
}

/**
 * Core reconciliation logic — queries stuck messages and reconciles
 * their status with Twilio. Extracted from the Inngest handler for testability.
 */
export async function reconcileStuckMessages(
  deps: ReconciliationDeps,
): Promise<ReconciliationResult> {
  const { db, fetchTwilioMessage, now } = deps;

  const threshold = new Date(now.getTime() - STUCK_THRESHOLD_MINUTES * 60 * 1000);

  // Query messages that are stuck: status is queued/sent and sent_at is older
  // than the threshold. Only consider messages with a bsp_message_id (we need
  // it to look them up in Twilio).
  const stuckMessages = await db
    .select({
      id: whatsappMessages.id,
      bspMessageId: whatsappMessages.bspMessageId,
      status: whatsappMessages.status,
    })
    .from(whatsappMessages)
    .where(
      and(
        inArray(whatsappMessages.status, ['queued', 'sent']),
        lt(whatsappMessages.sentAt, threshold),
        sql`${whatsappMessages.bspMessageId} IS NOT NULL`,
      ),
    );

  let reconciled = 0;
  let failed = 0;
  let errors = 0;

  for (const msg of stuckMessages) {
    // bspMessageId is guaranteed non-null by the WHERE clause
    const bspMessageId = msg.bspMessageId!;

    try {
      const twilioMessage = await fetchTwilioMessage(bspMessageId);

      const mappedStatus = TWILIO_STATUS_MAP[twilioMessage.status];
      if (!mappedStatus) {
        // Unknown Twilio status — skip, don't break the loop
        errors++;
        continue;
      }

      const currentOrder = STATUS_ORDER[msg.status ?? 'queued'] ?? 0;
      const newOrder = STATUS_ORDER[mappedStatus] ?? 0;

      // Only advance — never regress
      if (newOrder <= currentOrder) {
        continue;
      }

      // Build the update payload based on the new status
      const updatePayload: Record<string, unknown> = {
        status: mappedStatus,
      };

      if (mappedStatus === 'delivered') {
        updatePayload.deliveredAt = now;
      } else if (mappedStatus === 'read') {
        updatePayload.deliveredAt = now;
        updatePayload.readAt = now;
      } else if (mappedStatus === 'failed') {
        updatePayload.errorReason = twilioMessage.errorMessage
          ? `Twilio error ${twilioMessage.errorCode ?? ''}: ${twilioMessage.errorMessage}`
          : `Twilio error code: ${twilioMessage.errorCode ?? 'unknown'}`;
        failed++;
      }

      await db.update(whatsappMessages).set(updatePayload).where(eq(whatsappMessages.id, msg.id));

      if (mappedStatus !== 'failed') {
        reconciled++;
      }
    } catch {
      // Individual message fetch failure should not stop the entire batch
      errors++;
    }
  }

  return {
    stuckMessagesFound: stuckMessages.length,
    messagesReconciled: reconciled,
    messagesFailed: failed,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Twilio message fetcher factory
// ---------------------------------------------------------------------------

/**
 * Creates a `FetchTwilioMessage` function backed by a real Twilio client.
 * The `twilioModule` parameter accepts the default export of the `twilio`
 * package (lazily imported inside the Inngest handler to avoid pulling SDK
 * code into test bundles at module-evaluation time).
 */
export function createTwilioFetcher(
  twilioFactory: (
    sid: string,
    token: string,
  ) => {
    messages(sid: string): {
      fetch(): Promise<{ status: string; errorCode?: number | null; errorMessage?: string | null }>;
    };
  },
  accountSid: string,
  authToken: string,
): FetchTwilioMessage {
  const client = twilioFactory(accountSid, authToken);

  return async (bspMessageId: string): Promise<TwilioMessageResource> => {
    const message = await client.messages(bspMessageId).fetch();
    return {
      status: message.status,
      errorCode: message.errorCode,
      errorMessage: message.errorMessage,
    };
  };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const reconciliationPoller = inngest.createFunction(
  {
    id: 'whatsapp-reconciliation-poller',
    triggers: [{ cron: '*/30 * * * *' }],
  },
  async ({ step, logger }) => {
    const { db } = await import('@/shared/db/client');
    const { serverEnv } = await import('@/shared/env');
    const twilioModule = await import('twilio');

    const accountSid = serverEnv.TWILIO_ACCOUNT_SID;
    const authToken = serverEnv.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      logger.warn(
        { event: 'reconciliation_skipped_no_credentials' },
        'Reconciliation poller skipped — Twilio credentials not configured',
      );
      return { stuckMessagesFound: 0, messagesReconciled: 0, messagesFailed: 0, errors: 0 };
    }

    const fetchTwilioMessage = createTwilioFetcher(twilioModule.default, accountSid, authToken);

    const result = await step.run('reconcile-stuck-messages', async () => {
      return reconcileStuckMessages({
        db,
        fetchTwilioMessage,
        now: new Date(),
      });
    });

    logger.info(
      {
        event: 'reconciliation_complete',
        stuckMessagesFound: result.stuckMessagesFound,
        messagesReconciled: result.messagesReconciled,
        messagesFailed: result.messagesFailed,
        errors: result.errors,
      },
      `Reconciliation poller: found ${result.stuckMessagesFound} stuck, reconciled ${result.messagesReconciled}, failed ${result.messagesFailed}, errors ${result.errors}`,
    );

    return result;
  },
);
