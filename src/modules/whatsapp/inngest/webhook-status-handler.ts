/**
 * Webhook status handler — Inngest function that processes Twilio delivery
 * status callbacks (delivered, read, failed, etc.) and updates the
 * corresponding `whatsapp_messages` row.
 *
 * Triggered by `whatsapp/status.updated` events emitted by the Twilio
 * webhook Route Handler.
 *
 * Steps:
 *   1. Look up the whatsapp_messages row by bsp_message_id
 *   2. Update status + relevant timestamp fields
 *   3. On failure: record error_reason
 */

import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

import { inngest, WHATSAPP_EVENTS, type StatusUpdatedEventData } from './client';

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

export interface StatusHandlerDeps {
  db: DrizzleDb;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface StatusHandlerResult {
  status: 'updated' | 'not_found' | 'skipped';
  bspMessageId: string;
  newStatus?: string;
}

// ---------------------------------------------------------------------------
// Core logic (extracted for testing)
// ---------------------------------------------------------------------------

/**
 * Processes a status update event from Twilio.
 * Updates the whatsapp_messages row matching the bspMessageId.
 */
export async function processStatusUpdate(
  eventData: StatusUpdatedEventData,
  deps: StatusHandlerDeps,
): Promise<StatusHandlerResult> {
  const { db } = deps;
  const { bspMessageId, status: newStatus, errorCode, errorMessage } = eventData;

  if (!bspMessageId) {
    return { status: 'skipped', bspMessageId: '' };
  }

  // Look up the existing message
  const [existing] = await db
    .select({ id: whatsappMessages.id, status: whatsappMessages.status })
    .from(whatsappMessages)
    .where(eq(whatsappMessages.bspMessageId, bspMessageId))
    .limit(1);

  if (!existing) {
    return { status: 'not_found', bspMessageId };
  }

  // Build the update set based on the new status
  const updateSet: Record<string, unknown> = {
    status: newStatus,
  };

  if (newStatus === 'delivered') {
    updateSet.deliveredAt = sql`now()`;
  } else if (newStatus === 'read') {
    updateSet.deliveredAt = sql`COALESCE(${whatsappMessages.deliveredAt}, now())`;
    updateSet.readAt = sql`now()`;
  } else if (newStatus === 'failed' || newStatus === 'undelivered') {
    const reason = errorMessage
      ? `${errorCode ?? 'UNKNOWN'}: ${errorMessage}`
      : errorCode
        ? `Error code: ${errorCode}`
        : 'Delivery failed';
    updateSet.errorReason = reason;
  }

  await db
    .update(whatsappMessages)
    .set(updateSet)
    .where(eq(whatsappMessages.bspMessageId, bspMessageId));

  return {
    status: 'updated',
    bspMessageId,
    newStatus,
  };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const webhookStatusHandler = inngest.createFunction(
  {
    id: 'whatsapp-webhook-status-handler',
    triggers: [{ event: WHATSAPP_EVENTS.STATUS_UPDATED }],
    retries: 2,
  },
  async ({ event, step, logger }) => {
    const { db } = await import('@/shared/db/client');
    const data = event.data as StatusUpdatedEventData;

    const result = await step.run('process-status-update', async () => {
      return processStatusUpdate(data, { db });
    });

    logger.info(
      {
        event: 'webhook_status_processed',
        result: result.status,
        bspMessageId: result.bspMessageId,
        newStatus: result.newStatus,
      },
      `Status update processed: ${result.status}`,
    );

    return result;
  },
);
