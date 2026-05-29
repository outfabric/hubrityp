import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { inngest } from '@/modules/agenda/inngest/client';
import { calculateCancellationNotice } from '@/modules/agenda/lib/cancellation-notice';
import { isTokenExpired } from '@/modules/agenda/lib/confirmation-token';
import { sessionCancelledEventSchema } from '@/modules/agenda/lib/session-events';
import { isValidTransition, type SessionStatus } from '@/modules/agenda/lib/session-status';
import { db } from '@/shared/db/client';
import { sessions, sessionHistory } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

const reasonSchema = z.string().max(500).optional();

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type PublicDeclineSessionResult =
  | { ok: true }
  | { ok: false; error: 'invalid_token' }
  | { ok: false; error: 'expired' }
  | { ok: false; error: 'already_responded' }
  | { ok: false; error: 'cancelled' }
  | { ok: false; error: 'invalid_transition'; message: string }
  | { ok: false; error: 'concurrent_modification'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Declines (cancels) a session via the public confirmation page (no auth required).
 *
 * The confirmation token is the sole authorization credential. This function
 * uses Drizzle's app-level `db` client which bypasses RLS.
 *
 * Flow:
 *   1. Validate token format (non-empty).
 *   2. Look up session by confirmation_token.
 *   3. Check token validity: not expired, not already responded, not cancelled.
 *   4. Validate state machine transition (scheduled -> cancelled).
 *   5. Calculate cancellation notice tier.
 *   6. Update session: set cancellation fields (cancelled_by='patient',
 *      reason='patient_cancelled', notice auto-calculated).
 *   7. Append session_history entry with performed_by='patient'.
 */
export async function publicDeclineSessionImpl(
  token: string,
  reason?: string,
): Promise<PublicDeclineSessionResult> {
  if (!token || token.length < 1) {
    return { ok: false, error: 'invalid_token' };
  }

  // Validate reason length to prevent payload abuse
  const parsedReason = reasonSchema.safeParse(reason);
  const safeReason = parsedReason.success ? parsedReason.data : undefined;

  try {
    // Look up session by token (must not be soft-deleted)
    const [existing] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.confirmationToken, token), isNull(sessions.deletedAt)))
      .limit(1);

    if (!existing) {
      return { ok: false, error: 'invalid_token' };
    }

    const status = existing.status as SessionStatus;

    // Session was already cancelled
    if (status === 'cancelled') {
      return { ok: false, error: 'cancelled' };
    }

    // Already confirmed or in a terminal state (done, no_show)
    if (
      existing.confirmedAt !== null ||
      status === 'confirmed' ||
      status === 'done' ||
      status === 'no_show'
    ) {
      return { ok: false, error: 'already_responded' };
    }

    // Token expired -- session has started
    if (isTokenExpired(existing.startAt)) {
      return { ok: false, error: 'expired' };
    }

    // Validate state machine transition
    if (!isValidTransition(status, 'cancelled')) {
      return {
        ok: false,
        error: 'invalid_transition',
        message: `Transicao de "${status}" para "cancelled" nao e permitida.`,
      };
    }

    // Calculate cancellation notice
    const cancelledAt = new Date();
    const notice = calculateCancellationNotice(existing.startAt, cancelledAt);

    // Update session + append history in a transaction (optimistic lock on status)
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(sessions)
        .set({
          status: 'cancelled',
          cancellationReason: 'patient_cancelled',
          cancelledBy: 'patient',
          cancellationNotice: notice,
          cancelledAt,
          chargeCancellation: false,
          updatedAt: sql`now()`,
        })
        .where(and(eq(sessions.id, existing.id), eq(sessions.status, status)))
        .returning({ id: sessions.id });

      if (!row) {
        return null;
      }

      await tx.insert(sessionHistory).values({
        sessionId: existing.id,
        // Use the session owner's userId for the history record
        userId: existing.userId,
        action: 'status_changed',
        changes: {
          status: { old: status, new: 'cancelled' },
          performedBy: 'patient',
          cancellation: {
            reason: 'patient_cancelled',
            cancelledBy: 'patient',
            notice,
            chargeCancellation: false,
            patientReason: safeReason ?? null,
          },
        },
      });

      return row;
    });

    if (!updated) {
      return {
        ok: false,
        error: 'concurrent_modification',
        message:
          'O status da sessao foi alterado por outra operacao. Atualize a pagina e tente novamente.',
      };
    }

    // Fire-and-forget: emit Inngest event for downstream consumers.
    // Wrapped in try/catch so a transient Inngest failure never fails the user operation.
    // Blocking slots (null patientId) fail Zod parse here and are skipped by design.
    try {
      const payload = sessionCancelledEventSchema.parse({
        sessionId: existing.id,
        patientId: existing.patientId,
        userId: existing.userId,
        cancelledAt,
        cancelledBy: 'patient',
        reason: 'patient_cancelled',
        notice,
        chargeApplied: false,
      });

      await inngest.send({
        name: 'agenda/session.cancelled',
        data: payload,
      });
    } catch (inngestErr: unknown) {
      const errMsg = inngestErr instanceof Error ? inngestErr.message : 'unknown';
      logger.error(
        {
          event: 'inngest_send_failed',
          eventName: 'agenda/session.cancelled',
          sessionId: existing.id,
          error: errMsg,
        },
        'failed to send agenda/session.cancelled event',
      );
    }

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'public_decline_session_failed', errorCode: pgError.code },
      'unexpected error declining session via public link',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao cancelar sessao. Tente novamente.',
    };
  }
}
