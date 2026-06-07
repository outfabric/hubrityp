import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { inngest } from '@/modules/agenda/inngest/client';
import { sessionDoneEventSchema } from '@/modules/agenda/lib/session-events';
import { isSessionLocked } from '@/modules/agenda/lib/session-lock';
import { isValidTransition, type SessionStatus } from '@/modules/agenda/lib/session-status';
import { db } from '@/shared/db/client';
import { sessions, sessionHistory } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

const sessionIdSchema = z.string().uuid({ message: 'ID da sessão inválido.' });

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
      message: parsed.error.issues[0]?.message ?? 'Input inválido.',
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
        message: 'Esta sessão está bloqueada para edição após 7 dias.',
      };
    }

    // 4. Validate transition
    const fromStatus = existing.status as SessionStatus;
    if (!isValidTransition(fromStatus, 'done')) {
      return {
        ok: false,
        error: 'invalid_transition',
        message: `Transição de "${fromStatus}" para "done" não é permitida.`,
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
          'O status da sessão foi alterado por outra operação. Atualize a página e tente novamente.',
      };
    }

    // Fire-and-forget: emit Inngest event for downstream consumers.
    // Wrapped in try/catch so a transient Inngest failure never fails the user operation.
    try {
      const payload = sessionDoneEventSchema.parse({
        sessionId: validSessionId,
        patientId: existing.patientId,
        userId,
        doneAt: new Date(),
      });

      await inngest.send({
        name: 'agenda/session.done',
        data: payload,
      });
    } catch (inngestErr: unknown) {
      const errMsg = inngestErr instanceof Error ? inngestErr.message : 'unknown';
      logger.error(
        {
          event: 'inngest_send_failed',
          eventName: 'agenda/session.done',
          sessionId: validSessionId,
          error: errMsg,
        },
        'failed to send agenda/session.done event',
      );
    }

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
      message: 'Erro inesperado ao marcar sessão como realizada. Tente novamente.',
    };
  }
}
