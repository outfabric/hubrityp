import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { sessions, sessionHistory } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type MarkSessionDoneResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'already_done'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Marks a session as done for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify ownership — session must belong to authenticated user.
 *   3. Verify current status is not already "done".
 *   4. Update status to "done" + create history entry "status_changed"
 *      with { status: { old: "scheduled", new: "done" } } in a transaction.
 */
export async function markSessionDoneImpl(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<MarkSessionDoneResult> {
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

    // 3. Verify status
    if (existing.status === 'done') {
      return {
        ok: false,
        error: 'already_done',
        message: 'Esta sessao ja foi marcada como realizada.',
      };
    }

    const oldStatus = existing.status;

    // 4. Update status + history in a transaction
    await db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({ status: 'done', updatedAt: new Date() })
        .where(eq(sessions.id, sessionId));

      await tx.insert(sessionHistory).values({
        sessionId,
        userId,
        action: 'status_changed',
        changes: {
          status: { old: oldStatus, new: 'done' },
        },
      });
    });

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'mark_session_done_failed', errorCode: pgError.code },
      'unexpected error marking session as done',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao marcar sessao como realizada. Tente novamente.',
    };
  }
}
