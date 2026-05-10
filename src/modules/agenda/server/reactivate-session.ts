import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { isValidTransition, type SessionStatus } from '@/modules/agenda/lib/session-status';
import { db } from '@/shared/db/client';
import { sessions, sessionHistory } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ReactivateSessionResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'invalid_transition'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Reactivates a cancelled session back to scheduled.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify ownership — session must belong to authenticated user.
 *   3. Validate transition via state machine (cancelled → scheduled).
 *   4. Clear all cancellation fields + reschedule links.
 *   5. Set status='scheduled', append session_history entry.
 */
export async function reactivateSessionImpl(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<ReactivateSessionResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  try {
    // 2. Verify ownership
    const [existing] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));

    if (!existing) {
      return { ok: false, error: 'not_found' };
    }

    // 3. Validate transition
    const fromStatus = existing.status as SessionStatus;
    if (!isValidTransition(fromStatus, 'scheduled')) {
      return {
        ok: false,
        error: 'invalid_transition',
        message: `Transicao de "${fromStatus}" para "scheduled" nao e permitida.`,
      };
    }

    // 4-5. Clear cancellation fields, reschedule links + update status + history
    await db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({
          status: 'scheduled',
          cancellationReason: null,
          cancelledBy: null,
          cancellationNotice: null,
          cancelledAt: null,
          chargeCancellation: false,
          rescheduledToSessionId: null,
          rescheduledFromSessionId: null,
          updatedAt: sql`now()`,
        })
        .where(eq(sessions.id, sessionId));

      await tx.insert(sessionHistory).values({
        sessionId,
        userId,
        action: 'status_changed',
        changes: {
          status: { old: fromStatus, new: 'scheduled' },
          reactivated: true,
        },
      });
    });

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'reactivate_session_failed', errorCode: pgError.code },
      'unexpected error reactivating session',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao reativar sessao. Tente novamente.',
    };
  }
}
