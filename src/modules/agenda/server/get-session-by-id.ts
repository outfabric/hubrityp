import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface SessionLocator {
  id: string;
  /** UTC start instant — used by the agenda to position the calendar. */
  startAt: Date;
}

export type GetSessionByIdResult =
  | { ok: true; session: SessionLocator }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Fetches a single owner-scoped session by id, returning just enough to
 * position the agenda calendar on it (the `start_at` instant).
 *
 * Ownership is enforced server-side from the authenticated session — the
 * client-supplied `sessionId` is never trusted on its own. RLS is the final
 * line of defense; the explicit `userId` predicate is defense-in-depth. Used
 * by the agenda `?focusSession=:id` deep-link (RF-13.09).
 */
export async function getSessionByIdImpl(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<GetSessionByIdResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  try {
    const [row] = await db
      .select({ id: sessions.id, startAt: sessions.startAt })
      .from(sessions)
      .where(
        and(eq(sessions.id, sessionId), eq(sessions.userId, user.id), isNull(sessions.deletedAt)),
      );

    if (!row) {
      return { ok: false, error: 'not_found' };
    }

    return { ok: true, session: { id: row.id, startAt: row.startAt } };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'get_session_by_id_failed', errorCode: pgError.code },
      'unexpected error fetching session by id',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao buscar sessão. Tente novamente.',
    };
  }
}
