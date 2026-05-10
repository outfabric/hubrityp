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

export type EditRecurringSessionResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'not_recurring' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const editRecurringInputSchema = z.object({
  sessionId: z.string().regex(UUID_REGEX, { message: 'ID da sessao invalido.' }),
  scope: z.enum(['this', 'this_and_future', 'all'], {
    message: 'Escopo invalido.',
  }),
  updates: z.object({
    start_at: z.string().datetime({ message: 'Data/hora invalida.' }).optional(),
    duration_minutes: z.number().int().min(15).max(480).optional(),
    location_id: z.string().regex(UUID_REGEX).optional().nullable(),
    modality: z.enum(['in_person', 'online']).optional().nullable(),
    amount: z.string().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    color: z.string().optional().nullable(),
  }),
});

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Edits a recurring session with scope propagation.
 *
 * Scope behaviors:
 *   - 'this': detach session from series (recurrence_id = NULL), apply updates.
 *   - 'this_and_future': split recurrence at target, create new recurrence,
 *     reassign sessions from target onward, apply updates.
 *   - 'all': apply updates to all future scheduled/confirmed sessions in series.
 */
export async function editRecurringSessionImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<EditRecurringSessionResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = editRecurringInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { sessionId, scope, updates } = parsed.data;
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

    // 4. Fetch all sessions in the series for scope computation
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

    const scopeResult = computeEditScope(scope, sessionId, seriesForScope);

    // 5. Build the non-temporal update payload (fields that don't depend on
    //    the individual session's date).
    const sharedPayload: Record<string, unknown> = { updatedAt: sql`now()` };
    if (updates.location_id !== undefined) {
      sharedPayload.locationId = updates.location_id;
    }
    if (updates.modality !== undefined) {
      sharedPayload.modality = updates.modality;
    }
    if (updates.amount !== undefined) {
      sharedPayload.amount = updates.amount;
    }
    if (updates.notes !== undefined) {
      sharedPayload.notes = updates.notes;
    }
    if (updates.color !== undefined) {
      sharedPayload.color = updates.color;
    }
    if (updates.duration_minutes !== undefined) {
      sharedPayload.durationMinutes = updates.duration_minutes;
    }

    // For the "this" scope, the full start_at/end_at can be applied directly
    // because only one session is affected.
    const singleSessionPayload: Record<string, unknown> = { ...sharedPayload };
    if (updates.start_at !== undefined) {
      const newStartAt = new Date(updates.start_at);
      singleSessionPayload.startAt = newStartAt;
      const durationMinutes = updates.duration_minutes ?? target.durationMinutes;
      singleSessionPayload.endAt = new Date(newStartAt.getTime() + durationMinutes * 60 * 1000);
    } else if (updates.duration_minutes !== undefined) {
      singleSessionPayload.endAt = new Date(
        target.startAt.getTime() + updates.duration_minutes * 60 * 1000,
      );
    }

    // For "this_and_future" / "all" scopes, time changes must be applied
    // per-session: keep each session's original date and only change the
    // time-of-day (and/or duration). Compute new time components here.
    const hasTimeChange = updates.start_at !== undefined;
    const newTimeHours = hasTimeChange ? new Date(updates.start_at!).getUTCHours() : null;
    const newTimeMinutes = hasTimeChange ? new Date(updates.start_at!).getUTCMinutes() : null;
    const effectiveDuration = updates.duration_minutes ?? target.durationMinutes;

    /**
     * Builds per-session temporal fields (startAt/endAt) for bulk scopes.
     * Replaces only the time-of-day on the session's existing date.
     */
    function buildPerSessionPayload(existingStartAt: Date): Record<string, unknown> {
      const perSession = { ...sharedPayload };

      if (hasTimeChange) {
        const updated = new Date(existingStartAt);
        updated.setUTCHours(newTimeHours!, newTimeMinutes!, 0, 0);
        perSession.startAt = updated;
        perSession.endAt = new Date(updated.getTime() + effectiveDuration * 60 * 1000);
      } else if (updates.duration_minutes !== undefined) {
        // Duration changed but time didn't — recalculate endAt from existing startAt
        perSession.endAt = new Date(
          existingStartAt.getTime() + updates.duration_minutes * 60 * 1000,
        );
      }

      return perSession;
    }

    // 6. Execute scope-specific logic in a transaction
    await db.transaction(async (tx) => {
      switch (scope) {
        case 'this': {
          // Detach from series
          await tx
            .update(sessions)
            .set({ recurrenceId: null, ...singleSessionPayload })
            .where(eq(sessions.id, sessionId));

          await tx.insert(sessionHistory).values({
            sessionId,
            userId,
            action: 'updated',
            changes: { scope: 'this', detached: true },
          });
          break;
        }

        case 'this_and_future': {
          // Fetch the old recurrence BEFORE updating it so we preserve the
          // original end_date for the new (split) recurrence.
          const [oldRecurrence] = await tx
            .select()
            .from(sessionRecurrences)
            .where(eq(sessionRecurrences.id, recurrenceId));

          if (oldRecurrence) {
            // Preserve the original end_date before truncating the old series
            const originalEndDate = oldRecurrence.endDate;

            // Truncate the old recurrence to end the day before the target
            if (scopeResult.newRecurrenceEndDate) {
              await tx
                .update(sessionRecurrences)
                .set({
                  endDate: scopeResult.newRecurrenceEndDate.toISOString().split('T')[0]!,
                })
                .where(eq(sessionRecurrences.id, recurrenceId));
            }

            // Create new recurrence from the target date onward, using the
            // ORIGINAL end_date so the new series spans the remaining window.
            const [newRecurrence] = await tx
              .insert(sessionRecurrences)
              .values({
                userId,
                patientId: oldRecurrence.patientId,
                frequency: oldRecurrence.frequency,
                daysOfWeek: oldRecurrence.daysOfWeek,
                startDate: target.startAt.toISOString().split('T')[0]!,
                endDate: originalEndDate,
                occurrenceCount: null,
                isIndefinite: oldRecurrence.isIndefinite,
              })
              .returning({ id: sessionRecurrences.id });

            // Reassign (UPDATE, not DELETE+INSERT) sessions from target onward
            // to the new recurrence and apply field edits.
            if (scopeResult.toUpdate.length > 0 && newRecurrence) {
              // When time or duration changed, we must update each session
              // individually to preserve its original date.
              if (hasTimeChange || updates.duration_minutes !== undefined) {
                // Fetch the full startAt for each session being updated
                const sessionsToUpdate = await tx
                  .select({ id: sessions.id, startAt: sessions.startAt })
                  .from(sessions)
                  .where(inArray(sessions.id, scopeResult.toUpdate));

                for (const s of sessionsToUpdate) {
                  await tx
                    .update(sessions)
                    .set({
                      recurrenceId: newRecurrence.id,
                      ...buildPerSessionPayload(s.startAt),
                    })
                    .where(eq(sessions.id, s.id));
                }
              } else {
                // No temporal changes — bulk update is safe
                await tx
                  .update(sessions)
                  .set({
                    recurrenceId: newRecurrence.id,
                    ...sharedPayload,
                  })
                  .where(inArray(sessions.id, scopeResult.toUpdate));
              }

              // History entries for each updated session
              const historyValues = scopeResult.toUpdate.map((sid) => ({
                sessionId: sid,
                userId,
                action: 'updated',
                changes: {
                  scope: 'this_and_future',
                  newRecurrenceId: newRecurrence.id,
                },
              }));
              await tx.insert(sessionHistory).values(historyValues);
            }
          }
          break;
        }

        case 'all': {
          if (scopeResult.toUpdate.length > 0) {
            // When time or duration changed, update each session individually
            // to preserve its original date.
            if (hasTimeChange || updates.duration_minutes !== undefined) {
              const sessionsToUpdate = await tx
                .select({ id: sessions.id, startAt: sessions.startAt })
                .from(sessions)
                .where(inArray(sessions.id, scopeResult.toUpdate));

              for (const s of sessionsToUpdate) {
                await tx
                  .update(sessions)
                  .set(buildPerSessionPayload(s.startAt))
                  .where(eq(sessions.id, s.id));
              }
            } else {
              await tx
                .update(sessions)
                .set(sharedPayload)
                .where(inArray(sessions.id, scopeResult.toUpdate));
            }

            // History entries
            const historyValues = scopeResult.toUpdate.map((sid) => ({
              sessionId: sid,
              userId,
              action: 'updated',
              changes: { scope: 'all' },
            }));
            await tx.insert(sessionHistory).values(historyValues);
          }
          break;
        }
      }
    });

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'edit_recurring_session_failed', errorCode: pgError.code },
      'unexpected error editing recurring session',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao editar sessao recorrente. Tente novamente.',
    };
  }
}
