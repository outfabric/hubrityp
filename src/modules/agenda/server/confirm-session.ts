import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { isValidTransition, type SessionStatus } from '@/modules/agenda/lib/session-status';
import { db } from '@/shared/db/client';
import { sessions, sessionHistory } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

const sessionIdSchema = z.string().uuid({ message: 'ID da sessao invalido.' });

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ConfirmSessionResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; message: string }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'invalid_transition'; message: string }
  | { ok: false; error: 'concurrent_modification'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Confirms a session (scheduled → confirmed).
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify ownership — session must belong to authenticated user.
 *   3. Validate transition via state machine (scheduled → confirmed).
 *   4. Update session: set `status='confirmed'`, `confirmed_at=NOW()`.
 *   5. Append session_history entry with status change metadata.
 *
 * Inngest event `agenda/session.confirmed` will be emitted once the
 * Inngest client is configured in the project.
 */
export async function confirmSessionImpl(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<ConfirmSessionResult> {
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

    // 3. Validate transition
    const fromStatus = existing.status as SessionStatus;
    if (!isValidTransition(fromStatus, 'confirmed')) {
      return {
        ok: false,
        error: 'invalid_transition',
        message: `Transicao de "${fromStatus}" para "confirmed" nao e permitida.`,
      };
    }

    // 4-5. Update session + history in a transaction (optimistic lock on status)
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(sessions)
        .set({
          status: 'confirmed',
          confirmedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
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
          status: { old: fromStatus, new: 'confirmed' },
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

    // TODO: Emit `agenda/session.confirmed` via Inngest when client is available
    // inngest.send({ name: 'agenda/session.confirmed', data: { ... } });

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'confirm_session_failed', errorCode: pgError.code },
      'unexpected error confirming session',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao confirmar sessao. Tente novamente.',
    };
  }
}
