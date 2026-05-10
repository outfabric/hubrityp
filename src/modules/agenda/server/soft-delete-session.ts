import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { sessions, sessionHistory } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SoftDeleteSessionResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'not_cancelled'; message: string }
  | { ok: false; error: 'has_done_or_no_show_history'; message: string }
  | { ok: false; error: 'not_confirmed'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Soft-deletes a cancelled session by setting `deleted_at = NOW()`.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify ownership — session must belong to authenticated user.
 *   3. Verify session is `cancelled` — only cancelled sessions can be soft-deleted.
 *   4. Verify no prior done/no_show status via session_history query.
 *   5. Verify the caller sent the confirmation flag.
 *   6. Set `deleted_at = NOW()`.
 */
export async function softDeleteSessionImpl(
  supabase: SupabaseClient,
  sessionId: string,
  confirmed: boolean,
): Promise<SoftDeleteSessionResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // Require explicit confirmation
  if (!confirmed) {
    return {
      ok: false,
      error: 'not_confirmed',
      message: 'A exclusao definitiva requer confirmacao explicita.',
    };
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

    // 3. Verify status is cancelled
    if (existing.status !== 'cancelled') {
      return {
        ok: false,
        error: 'not_cancelled',
        message: 'Apenas sessoes canceladas podem ser excluidas definitivamente.',
      };
    }

    // 4. Verify no prior done/no_show status via session_history
    const historyRows = await db
      .select({ changes: sessionHistory.changes })
      .from(sessionHistory)
      .where(eq(sessionHistory.sessionId, sessionId));

    const hasDoneOrNoShowHistory = historyRows.some((row) => {
      const changes = row.changes as Record<string, unknown>;
      if (!changes.status) return false;
      const statusChange = changes.status as { old?: string; new?: string };
      return statusChange.new === 'done' || statusChange.new === 'no_show';
    });

    if (hasDoneOrNoShowHistory) {
      return {
        ok: false,
        error: 'has_done_or_no_show_history',
        message:
          'Sessao com historico de realizada ou falta nao pode ser excluida definitivamente.',
      };
    }

    // 5. Set deleted_at
    await db
      .update(sessions)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(sessions.id, sessionId));

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'soft_delete_session_failed', errorCode: pgError.code },
      'unexpected error soft-deleting session',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao excluir sessao. Tente novamente.',
    };
  }
}
