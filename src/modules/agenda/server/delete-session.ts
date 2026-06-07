import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type DeleteSessionResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'not_scheduled'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Deletes a session for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify ownership — session must belong to authenticated user.
 *   3. Verify status is "scheduled" — only scheduled sessions can be deleted.
 *   4. Delete the session.
 *
 * NOTE: ON DELETE CASCADE on `session_history.session_id` means history
 * entries are cleaned up automatically when the session is removed. If
 * persistent audit-on-delete is needed in the future, a separate audit
 * table without the cascade FK should be used.
 */
export async function deleteSessionImpl(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<DeleteSessionResult> {
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

    // 3. Verify status is "scheduled"
    if (existing.status !== 'scheduled') {
      return {
        ok: false,
        error: 'not_scheduled',
        message: 'Apenas sessões com status "agendada" podem ser excluídas.',
      };
    }

    // 4. Delete the session (ON DELETE CASCADE removes related history entries)
    await db.delete(sessions).where(eq(sessions.id, sessionId));

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'delete_session_failed', errorCode: pgError.code },
      'unexpected error deleting session',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao excluir sessão. Tente novamente.',
    };
  }
}
