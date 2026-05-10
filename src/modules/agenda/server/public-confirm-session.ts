import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { isTokenExpired } from '@/modules/agenda/lib/confirmation-token';
import { isValidTransition, type SessionStatus } from '@/modules/agenda/lib/session-status';
import { db } from '@/shared/db/client';
import { sessions, sessionHistory } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type PublicConfirmSessionResult =
  | { ok: true }
  | { ok: false; error: 'invalid_token' }
  | { ok: false; error: 'expired' }
  | { ok: false; error: 'already_responded' }
  | { ok: false; error: 'cancelled' }
  | { ok: false; error: 'invalid_transition'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Confirms a session via the public confirmation page (no auth required).
 *
 * The confirmation token is the sole authorization credential. This function
 * uses Drizzle's app-level `db` client which bypasses RLS.
 *
 * Flow:
 *   1. Validate token format (non-empty).
 *   2. Look up session by confirmation_token.
 *   3. Check token validity: not expired, not already responded, not cancelled.
 *   4. Validate state machine transition (scheduled -> confirmed).
 *   5. Update session: set status='confirmed', confirmed_at=NOW().
 *   6. Append session_history entry with performed_by='patient'.
 */
export async function publicConfirmSessionImpl(token: string): Promise<PublicConfirmSessionResult> {
  if (!token || token.length < 1) {
    return { ok: false, error: 'invalid_token' };
  }

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

    // Session was cancelled
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
    if (!isValidTransition(status, 'confirmed')) {
      return {
        ok: false,
        error: 'invalid_transition',
        message: `Transicao de "${status}" para "confirmed" nao e permitida.`,
      };
    }

    // Update session + append history in a transaction
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({
          status: 'confirmed',
          confirmedAt: now,
          updatedAt: sql`now()`,
        })
        .where(eq(sessions.id, existing.id));

      await tx.insert(sessionHistory).values({
        sessionId: existing.id,
        // Use the session owner's userId for the history record
        userId: existing.userId,
        action: 'status_changed',
        changes: {
          status: { old: status, new: 'confirmed' },
          performedBy: 'patient',
        },
      });
    });

    // TODO: Emit `agenda/session.confirmed` via Inngest when client is available
    // inngest.send({ name: 'agenda/session.confirmed', data: { ... } });

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'public_confirm_session_failed', errorCode: pgError.code },
      'unexpected error confirming session via public link',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao confirmar sessao. Tente novamente.',
    };
  }
}
