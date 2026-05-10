import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { calculateCancellationNotice } from '@/modules/agenda/lib/cancellation-notice';
import { calculateEndTime } from '@/modules/agenda/lib/date-helpers';
import { sessionInputSchema } from '@/modules/agenda/lib/session-input-schema';
import { isValidTransition, type SessionStatus } from '@/modules/agenda/lib/session-status';
import { db } from '@/shared/db/client';
import { sessions, sessionHistory } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CompleteRescheduleResult =
  | { ok: true; newSessionId: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'invalid_transition'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Completes a reschedule operation: cancels the old session and creates a
 * new one with bidirectional links.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate new session input via `sessionInputSchema`.
 *   3. Verify ownership of old session.
 *   4. Validate transition (scheduled|confirmed → cancelled) on old session.
 *   5. In a single transaction:
 *      a. Cancel old session with reschedule metadata.
 *      b. Create new session with `rescheduled_from_session_id`.
 *      c. Update old session with `rescheduled_to_session_id`.
 *      d. Create history entries for both sessions.
 *
 * Inngest event `agenda/session.rescheduled` will be emitted once the
 * Inngest client is configured in the project.
 */
export async function completeRescheduleImpl(
  supabase: SupabaseClient,
  oldSessionId: string,
  newSessionInput: unknown,
): Promise<CompleteRescheduleResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate new session input
  const parsed = sessionInputSchema.safeParse(newSessionInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const newData = parsed.data;
  const userId = user.id;
  const newStartAt = new Date(newData.start_at);
  const newEndAt = calculateEndTime(newStartAt, newData.duration_minutes);

  try {
    // 3. Verify ownership of old session
    const [oldSession] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, oldSessionId), eq(sessions.userId, userId)));

    if (!oldSession) {
      return { ok: false, error: 'not_found' };
    }

    // 4. Validate transition on old session
    const fromStatus = oldSession.status as SessionStatus;
    if (!isValidTransition(fromStatus, 'cancelled')) {
      return {
        ok: false,
        error: 'invalid_transition',
        message: `Transicao de "${fromStatus}" para "cancelled" nao e permitida para remarcar.`,
      };
    }

    // 5. Transaction: cancel old + create new + link + history
    const cancelledAt = new Date();
    const notice = calculateCancellationNotice(oldSession.startAt, cancelledAt);

    const [newSessionRow] = await db.transaction(async (tx) => {
      // 5a. Create new session
      const [created] = await tx
        .insert(sessions)
        .values({
          userId,
          patientId: newData.patient_id ?? null,
          isBlocking: newData.is_blocking ?? false,
          blockingTitle: newData.blocking_title ?? null,
          startAt: newStartAt,
          endAt: newEndAt,
          durationMinutes: newData.duration_minutes,
          locationId: newData.location_id ?? null,
          modality: newData.modality ?? null,
          amount: newData.amount ?? null,
          notes: newData.notes ?? null,
          color: newData.color ?? null,
          status: 'scheduled',
          rescheduledFromSessionId: oldSessionId,
        })
        .returning({ id: sessions.id });

      // 5b. Cancel old session with reschedule metadata
      await tx
        .update(sessions)
        .set({
          status: 'cancelled',
          cancellationReason: 'therapist_cancelled',
          cancelledBy: 'therapist',
          cancellationNotice: notice,
          cancelledAt,
          chargeCancellation: false,
          rescheduledToSessionId: created!.id,
          updatedAt: sql`now()`,
        })
        .where(eq(sessions.id, oldSessionId));

      // 5c. History for old session (cancellation + reschedule)
      await tx.insert(sessionHistory).values({
        sessionId: oldSessionId,
        userId,
        action: 'status_changed',
        changes: {
          status: { old: fromStatus, new: 'cancelled' },
          reschedule: {
            type: 'rescheduled_to',
            newSessionId: created!.id,
          },
        },
      });

      // 5d. History for new session (created via reschedule)
      await tx.insert(sessionHistory).values({
        sessionId: created!.id,
        userId,
        action: 'created',
        changes: {
          reschedule: {
            type: 'rescheduled_from',
            oldSessionId,
          },
        },
      });

      return [created!];
    });

    // TODO: Emit `agenda/session.rescheduled` via Inngest when client is available

    return { ok: true, newSessionId: newSessionRow.id };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'complete_reschedule_failed', errorCode: pgError.code },
      'unexpected error completing reschedule',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao remarcar sessao. Tente novamente.',
    };
  }
}
