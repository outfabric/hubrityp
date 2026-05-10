import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { calculateCancellationNotice } from '@/modules/agenda/lib/cancellation-notice';
import { cancelSessionInputSchema } from '@/modules/agenda/lib/cancellation-schema';
import { isValidTransition, type SessionStatus } from '@/modules/agenda/lib/session-status';
import { db } from '@/shared/db/client';
import { sessions, sessionHistory, type Session } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Subset of session data returned when `isReschedule` is true. */
export interface RescheduleSessionData {
  patientId: string | null;
  durationMinutes: number;
  locationId: string | null;
  modality: string | null;
  amount: string | null;
  notes: string | null;
}

export type CancelSessionResult =
  | { ok: true; rescheduleData?: RescheduleSessionData }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'invalid_transition'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Cancels a session for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input via `cancelSessionInputSchema`.
 *   3. Verify ownership — session must belong to authenticated user.
 *   4. Validate transition via state machine (scheduled|confirmed → cancelled).
 *   5. Calculate cancellation notice tier.
 *   6. Update session: set all cancellation fields + status='cancelled'.
 *   7. Append session_history entry with cancellation metadata.
 *   8. If `isReschedule`, return session data for pre-filling the creation modal.
 *
 * Inngest event `agenda/session.cancelled` will be emitted once the
 * Inngest client is configured in the project.
 */
export async function cancelSessionImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<CancelSessionResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = cancelSessionInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data = parsed.data;
  const userId = user.id;

  try {
    // 3. Verify ownership
    const [existing] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, data.sessionId), eq(sessions.userId, userId)));

    if (!existing) {
      return { ok: false, error: 'not_found' };
    }

    // 4. Validate transition
    const fromStatus = existing.status as SessionStatus;
    if (!isValidTransition(fromStatus, 'cancelled')) {
      return {
        ok: false,
        error: 'invalid_transition',
        message: `Transicao de "${fromStatus}" para "cancelled" nao e permitida.`,
      };
    }

    // 5. Calculate cancellation notice
    const cancelledAt = new Date();
    const notice = calculateCancellationNotice(existing.startAt, cancelledAt);

    // 6-7. Update session + history in a transaction
    await db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({
          status: 'cancelled',
          cancellationReason: data.reason,
          cancelledBy: data.cancelledBy,
          cancellationNotice: notice,
          cancelledAt,
          chargeCancellation: data.chargeCancellation,
          updatedAt: sql`now()`,
        })
        .where(eq(sessions.id, data.sessionId));

      await tx.insert(sessionHistory).values({
        sessionId: data.sessionId,
        userId,
        action: 'status_changed',
        changes: {
          status: { old: fromStatus, new: 'cancelled' },
          cancellation: {
            reason: data.reason,
            cancelledBy: data.cancelledBy,
            notice,
            chargeCancellation: data.chargeCancellation,
            isReschedule: data.isReschedule ?? false,
          },
        },
      });
    });

    // TODO: Emit `agenda/session.cancelled` via Inngest when client is available

    // 8. If isReschedule, return session data for pre-filling
    if (data.isReschedule) {
      return {
        ok: true,
        rescheduleData: extractRescheduleData(existing),
      };
    }

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'cancel_session_failed', errorCode: pgError.code },
      'unexpected error cancelling session',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao cancelar sessao. Tente novamente.',
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractRescheduleData(session: Session): RescheduleSessionData {
  return {
    patientId: session.patientId,
    durationMinutes: session.durationMinutes,
    locationId: session.locationId,
    modality: session.modality,
    amount: session.amount,
    notes: session.notes,
  };
}
