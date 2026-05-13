/**
 * Webhook cancellation handler — Inngest function that processes a patient's
 * "Nao posso comparecer" quick-reply button press.
 *
 * Triggered by `whatsapp/cancellation.received` events emitted by the
 * Twilio webhook Route Handler.
 *
 * Steps:
 *   1. Resolve the original outbound message by bsp_message_id
 *   2. Look up the linked session
 *   3. Guard: skip if session is already cancelled (duplicate)
 *   4. Cancel session: set status='cancelled', cancelled_by='patient',
 *      compute cancellation notice (early/late based on time before session)
 */

import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { sessions } from '@/shared/db/schema/agenda/tables';
import { whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

import { inngest, WHATSAPP_EVENTS, type CancellationReceivedEventData } from './client';

// ---------------------------------------------------------------------------
// Extended event data — the webhook enriches with originalBspMessageId/fromPhone
// ---------------------------------------------------------------------------

export interface WebhookCancellationEventData extends CancellationReceivedEventData {
  originalBspMessageId?: string;
  fromPhone?: string;
}

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

export interface CancellationHandlerDeps {
  db: DrizzleDb;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface CancellationHandlerResult {
  status: 'cancelled' | 'skipped' | 'not_found';
  skipReason?: string;
  sessionId?: string;
  cancellationNotice?: string;
}

// ---------------------------------------------------------------------------
// Cancellation notice computation
// ---------------------------------------------------------------------------

/**
 * Computes the cancellation notice category based on how far in advance
 * of the session the cancellation was received.
 */
function computeCancellationNotice(sessionStartAt: Date, cancelledAt: Date): string {
  const hoursBeforeSession = (sessionStartAt.getTime() - cancelledAt.getTime()) / (1000 * 60 * 60);

  if (hoursBeforeSession >= 24) return '24h+';
  if (hoursBeforeSession >= 12) return '12h-24h';
  if (hoursBeforeSession >= 2) return '2h-12h';
  return 'less_than_2h';
}

// ---------------------------------------------------------------------------
// Core logic (extracted for testing)
// ---------------------------------------------------------------------------

/**
 * Processes a patient cancellation received via WhatsApp quick-reply.
 *
 * Resolves session from the original outbound message's bsp_message_id,
 * then cancels the session with cancelled_by='patient'. Duplicates ignored.
 */
export async function processCancellation(
  eventData: WebhookCancellationEventData,
  deps: CancellationHandlerDeps,
): Promise<CancellationHandlerResult> {
  const { db } = deps;

  // Resolve the original outbound message to find the session
  let sessionId = eventData.sessionId;

  if (!sessionId && eventData.originalBspMessageId) {
    const [originalMsg] = await db
      .select({
        sessionId: whatsappMessages.sessionId,
      })
      .from(whatsappMessages)
      .where(eq(whatsappMessages.bspMessageId, eventData.originalBspMessageId))
      .limit(1);

    if (!originalMsg?.sessionId) {
      return { status: 'not_found' };
    }

    sessionId = originalMsg.sessionId;
  }

  if (!sessionId) {
    return { status: 'not_found' };
  }

  // Look up the session
  const [session] = await db
    .select({
      id: sessions.id,
      status: sessions.status,
      startAt: sessions.startAt,
      cancelledAt: sessions.cancelledAt,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    return { status: 'not_found' };
  }

  // Guard: skip if already cancelled (duplicate)
  if (session.status === 'cancelled') {
    return { status: 'skipped', skipReason: 'already_cancelled', sessionId };
  }

  // Guard: skip if session is done
  if (session.status === 'done') {
    return { status: 'skipped', skipReason: 'session_already_done', sessionId };
  }

  // Compute cancellation notice based on time before session
  const now = new Date();
  const cancellationNotice = computeCancellationNotice(session.startAt, now);

  // Cancel the session
  await db
    .update(sessions)
    .set({
      status: 'cancelled',
      cancelledBy: 'patient',
      cancelledAt: sql`now()`,
      cancellationReason: eventData.message ?? 'Cancelado via WhatsApp',
      cancellationNotice,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sessions.id, sessionId),
        // Only cancel if not already cancelled or done
        sql`${sessions.status} NOT IN ('cancelled', 'done')`,
      ),
    );

  return {
    status: 'cancelled',
    sessionId,
    cancellationNotice,
  };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const webhookCancellationHandler = inngest.createFunction(
  {
    id: 'whatsapp-webhook-cancellation-handler',
    triggers: [{ event: WHATSAPP_EVENTS.CANCELLATION_RECEIVED }],
    retries: 2,
  },
  async ({ event, step, logger }) => {
    const { db } = await import('@/shared/db/client');
    const data = event.data as WebhookCancellationEventData;

    const result = await step.run('process-cancellation', async () => {
      return processCancellation(data, { db });
    });

    logger.info(
      {
        event: 'webhook_cancellation_processed',
        result: result.status,
        sessionId: result.sessionId,
        skipReason: result.skipReason,
        cancellationNotice: result.cancellationNotice,
      },
      `Cancellation processed: ${result.status}`,
    );

    return result;
  },
);
