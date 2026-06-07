import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { sessions, sessionHistory, type SessionHistory } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type GetSessionHistoryResult =
  | { ok: true; history: SessionHistory[] }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Fetches history entries for a session, ordered by `created_at DESC`.
 *
 * Verifies ownership by JOINing `session_history` → `sessions` and checking
 * that the session belongs to the authenticated user.
 */
export async function getSessionHistoryImpl(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<GetSessionHistoryResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  try {
    // 2. Verify ownership of the session
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, user.id)));

    if (!session) {
      return { ok: false, error: 'not_found' };
    }

    // 3. Fetch history entries ordered by created_at DESC
    const rows = await db
      .select()
      .from(sessionHistory)
      .where(eq(sessionHistory.sessionId, sessionId))
      .orderBy(desc(sessionHistory.createdAt));

    return { ok: true, history: rows };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'get_session_history_failed', errorCode: pgError.code },
      'unexpected error fetching session history',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao buscar histórico da sessão. Tente novamente.',
    };
  }
}
