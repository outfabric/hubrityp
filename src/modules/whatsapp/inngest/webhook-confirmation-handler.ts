/**
 * Webhook confirmation handler — Inngest function that processes a patient's
 * "Confirmar" quick-reply button press.
 *
 * Triggered by `whatsapp/confirmation.received` events emitted by the
 * Twilio webhook Route Handler.
 *
 * Steps:
 *   1. Resolve the original outbound message by bsp_message_id
 *   2. Look up the linked session
 *   3. Guard: skip if session is already confirmed (duplicate)
 *   4. Update session status to 'confirmed', set confirmed_at
 *   5. Emit `whatsapp/confirmation.ack` event for acknowledgment message
 */

import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { sessions } from '@/shared/db/schema/agenda/tables';
import { whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

import { inngest, WHATSAPP_EVENTS, type ConfirmationReceivedEventData } from './client';

// ---------------------------------------------------------------------------
// Extended event data — the webhook enriches with originalBspMessageId/fromPhone
// ---------------------------------------------------------------------------

export interface WebhookConfirmationEventData extends ConfirmationReceivedEventData {
  originalBspMessageId?: string;
  fromPhone?: string;
}

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

export interface ConfirmationHandlerDeps {
  db: DrizzleDb;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ConfirmationHandlerResult {
  status: 'confirmed' | 'skipped' | 'not_found';
  skipReason?: string;
  sessionId?: string;
  patientId?: string;
  userId?: string;
}

// ---------------------------------------------------------------------------
// Core logic (extracted for testing)
// ---------------------------------------------------------------------------

/**
 * Processes a patient confirmation received via WhatsApp quick-reply.
 *
 * Resolves session from the original outbound message's bsp_message_id,
 * then updates session status to 'confirmed'. Duplicates are ignored.
 */
export async function processConfirmation(
  eventData: WebhookConfirmationEventData,
  deps: ConfirmationHandlerDeps,
): Promise<ConfirmationHandlerResult> {
  const { db } = deps;

  // Resolve the original outbound message to find the session
  let sessionId = eventData.sessionId;
  let patientId = eventData.patientId;
  let userId = eventData.userId;

  // If sessionId is empty, resolve from the original outbound message
  if (!sessionId && eventData.originalBspMessageId) {
    const [originalMsg] = await db
      .select({
        sessionId: whatsappMessages.sessionId,
        patientId: whatsappMessages.patientId,
        userId: whatsappMessages.userId,
      })
      .from(whatsappMessages)
      .where(eq(whatsappMessages.bspMessageId, eventData.originalBspMessageId))
      .limit(1);

    if (!originalMsg?.sessionId) {
      return { status: 'not_found' };
    }

    sessionId = originalMsg.sessionId;
    patientId = originalMsg.patientId ?? '';
    userId = originalMsg.userId;
  }

  if (!sessionId) {
    return { status: 'not_found' };
  }

  // Look up the session
  const [session] = await db
    .select({
      id: sessions.id,
      status: sessions.status,
      confirmedAt: sessions.confirmedAt,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    return { status: 'not_found' };
  }

  // Guard: skip if already confirmed (duplicate)
  if (session.status === 'confirmed' && session.confirmedAt) {
    return { status: 'skipped', skipReason: 'already_confirmed', sessionId };
  }

  // Guard: skip if session is cancelled or done
  if (session.status === 'cancelled' || session.status === 'done') {
    return { status: 'skipped', skipReason: 'session_not_confirmable', sessionId };
  }

  // Update session to confirmed
  await db
    .update(sessions)
    .set({
      status: 'confirmed',
      confirmedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sessions.id, sessionId),
        // Only update if still in a confirmable state
        sql`${sessions.status} IN ('scheduled')`,
      ),
    );

  return { status: 'confirmed', sessionId, patientId, userId };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const webhookConfirmationHandler = inngest.createFunction(
  {
    id: 'whatsapp-webhook-confirmation-handler',
    triggers: [{ event: WHATSAPP_EVENTS.CONFIRMATION_RECEIVED }],
    retries: 2,
  },
  async ({ event, step, logger }) => {
    const { db } = await import('@/shared/db/client');
    const data = event.data as WebhookConfirmationEventData;

    const result = await step.run('process-confirmation', async () => {
      return processConfirmation(data, { db });
    });

    // Emit ack event as a separate step (Inngest forbids nested step calls)
    if (result.status === 'confirmed' && result.sessionId) {
      await step.sendEvent('emit-confirmation-ack', {
        name: WHATSAPP_EVENTS.CONFIRMATION_ACK,
        data: {
          sessionId: result.sessionId,
          patientId: result.patientId ?? data.patientId,
          userId: result.userId ?? data.userId,
        },
      });
    }

    logger.info(
      {
        event: 'webhook_confirmation_processed',
        result: result.status,
        sessionId: result.sessionId,
        skipReason: result.skipReason,
      },
      `Confirmation processed: ${result.status}`,
    );

    return result;
  },
);
