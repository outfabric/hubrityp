import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { isSessionLocked } from '@/modules/agenda/lib/session-lock';
import { isValidTransition, type SessionStatus } from '@/modules/agenda/lib/session-status';
import { db } from '@/shared/db/client';
import { sessions, sessionHistory } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

const sessionIdSchema = z.string().uuid({ message: 'ID da sessao invalido.' });

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type MarkSessionDoneResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; message: string }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'invalid_transition'; message: string }
  | { ok: false; error: 'session_locked'; message: string }
  | { ok: false; error: 'concurrent_modification'; message: string }
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
 *   3. Check 7-day lock (RN-03.04) — reject edits on locked done sessions.
 *   4. Validate transition via state machine (scheduled|confirmed → done).
 *   5. Update status to "done" + create history entry in a transaction.
 *
 * Inngest event `agenda/session.done` will be emitted once the
 * Inngest client is configured in the project.
 */
export async function markSessionDoneImpl(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<MarkSessionDoneResult> {
  // 0. Validate input
  const parsed = sessionIdSchema.safeParse(sessionId);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      message: parsed.error.issues[0]?.message ?? 'Input invalido.',
    };
  }
  const validSessionId = parsed.data;

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
      .where(and(eq(sessions.id, validSessionId), eq(sessions.userId, userId)));

    if (!existing) {
      return { ok: false, error: 'not_found' };
    }

    // 3. Check 7-day lock
    if (isSessionLocked({ status: existing.status, updatedAt: existing.updatedAt })) {
      return {
        ok: false,
        error: 'session_locked',
        message: 'Esta sessao esta bloqueada para edicao apos 7 dias.',
      };
    }

    // 4. Validate transition
    const fromStatus = existing.status as SessionStatus;
    if (!isValidTransition(fromStatus, 'done')) {
      return {
        ok: false,
        error: 'invalid_transition',
        message: `Transicao de "${fromStatus}" para "done" nao e permitida.`,
      };
    }

    // 5. Update status + history in a transaction (optimistic lock on status)
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(sessions)
        .set({ status: 'done', updatedAt: sql`now()` })
        .where(and(eq(sessions.id, validSessionId), eq(sessions.status, fromStatus)))
        .returning({ id: sessions.id });

      if (!row) {
        return null;
      }

      await tx.insert(sessionHistory).values({
        sessionId: validSessionId,
        userId,
        action: 'status_changed',
        changes: {
          status: { old: fromStatus, new: 'done' },
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

    // TODO: Emit `agenda/session.done` via Inngest when client is available

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
