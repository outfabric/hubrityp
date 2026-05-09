import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { type SeriesSession, computeEditScope } from '@/modules/sessions/lib/compute-edit-scope';
import { db } from '@/shared/db/client';
import { sessions, sessionHistory, sessionRecurrences } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CancelRecurringSessionResult =
  | { ok: true; cancelledCount: number }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'not_recurring' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cancelRecurringInputSchema = z.object({
  sessionId: z.string().regex(UUID_REGEX, { message: 'ID da sessao invalido.' }),
  scope: z.enum(['this', 'this_and_future', 'all'], {
    message: 'Escopo invalido.',
  }),
});

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Cancels a recurring session with scope propagation.
 *
 * Scope behaviors:
 *   - 'this': cancels only the target session (status = 'cancelled').
 *   - 'this_and_future': cancels all sessions from target onward, updates
 *     recurrence end_date.
 *   - 'all': cancels all future non-completed sessions in the series.
 */
export async function cancelRecurringSessionImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<CancelRecurringSessionResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = cancelRecurringInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { sessionId, scope } = parsed.data;
  const userId = user.id;

  try {
    // 3. Fetch target session and verify ownership
    const [target] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));

    if (!target) {
      return { ok: false, error: 'not_found' };
    }

    if (!target.recurrenceId) {
      return { ok: false, error: 'not_recurring' };
    }

    const recurrenceId = target.recurrenceId;

    // 4. Fetch all sessions in the series
    const allSeriesSessions = await db
      .select({
        id: sessions.id,
        startAt: sessions.startAt,
        status: sessions.status,
      })
      .from(sessions)
      .where(and(eq(sessions.recurrenceId, recurrenceId), eq(sessions.userId, userId)));

    const seriesForScope: SeriesSession[] = allSeriesSessions.map((s) => ({
      id: s.id,
      startAt: s.startAt,
      status: s.status,
    }));

    // 5. Compute scope
    let sessionsToCancelIds: string[];

    switch (scope) {
      case 'this': {
        // Cancel only the target session
        sessionsToCancelIds = [sessionId];
        break;
      }
      case 'this_and_future': {
        // Use computeEditScope to get sessions from target onward
        const scopeResult = computeEditScope(scope, sessionId, seriesForScope);
        // toUpdate contains target + all future sessions
        sessionsToCancelIds = scopeResult.toUpdate;
        break;
      }
      case 'all': {
        // Cancel all future non-completed sessions
        const scopeResult = computeEditScope(scope, sessionId, seriesForScope);
        sessionsToCancelIds = scopeResult.toUpdate;
        break;
      }
    }

    if (sessionsToCancelIds.length === 0) {
      return { ok: true, cancelledCount: 0 };
    }

    // 6. Execute cancellation in a transaction
    await db.transaction(async (tx) => {
      // Set status to 'cancelled' for all targeted sessions
      await tx
        .update(sessions)
        .set({ status: 'cancelled', updatedAt: sql`now()` })
        .where(inArray(sessions.id, sessionsToCancelIds));

      // Create history entries
      const historyValues = sessionsToCancelIds.map((sid) => ({
        sessionId: sid,
        userId,
        action: 'status_changed' as const,
        changes: {
          status: { old: 'scheduled', new: 'cancelled' },
          scope,
        },
      }));
      await tx.insert(sessionHistory).values(historyValues);

      // For 'this_and_future': update recurrence end_date
      if (scope === 'this_and_future') {
        const scopeResult = computeEditScope(scope, sessionId, seriesForScope);
        if (scopeResult.newRecurrenceEndDate) {
          await tx
            .update(sessionRecurrences)
            .set({
              endDate: scopeResult.newRecurrenceEndDate.toISOString().split('T')[0]!,
            })
            .where(eq(sessionRecurrences.id, recurrenceId));
        }
      }
    });

    return { ok: true, cancelledCount: sessionsToCancelIds.length };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'cancel_recurring_session_failed', errorCode: pgError.code },
      'unexpected error cancelling recurring session',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao cancelar sessao recorrente. Tente novamente.',
    };
  }
}
