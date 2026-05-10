import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, gte, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';

import { calculateEndTime } from '@/modules/agenda/lib/date-helpers';
import { type ConflictResult, detectConflicts } from '@/modules/agenda/lib/detect-conflicts';
import { sessionInputSchema } from '@/modules/agenda/lib/session-input-schema';
import { db } from '@/shared/db/client';
import {
  sessions,
  sessionHistory,
  locations,
  type Session,
} from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type UpdateSessionResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'conflict_warning'; conflicts: ConflictResult[] }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes a diff object between old and new session values for history
 * tracking. Only includes fields that actually changed.
 */
function computeDiff(
  old: Session,
  updated: {
    patientId: string | null;
    isBlocking: boolean;
    blockingTitle: string | null;
    startAt: Date;
    endAt: Date;
    durationMinutes: number;
    locationId: string | null;
    modality: string | null;
    amount: string | null;
    notes: string | null;
    color: string | null;
  },
): Record<string, { old: unknown; new: unknown }> {
  const diff: Record<string, { old: unknown; new: unknown }> = {};

  if (old.patientId !== updated.patientId) {
    diff.patientId = { old: old.patientId, new: updated.patientId };
  }
  if (old.isBlocking !== updated.isBlocking) {
    diff.isBlocking = { old: old.isBlocking, new: updated.isBlocking };
  }
  if (old.blockingTitle !== updated.blockingTitle) {
    diff.blockingTitle = { old: old.blockingTitle, new: updated.blockingTitle };
  }
  if (old.startAt.getTime() !== updated.startAt.getTime()) {
    diff.startAt = { old: old.startAt.toISOString(), new: updated.startAt.toISOString() };
  }
  if (old.endAt.getTime() !== updated.endAt.getTime()) {
    diff.endAt = { old: old.endAt.toISOString(), new: updated.endAt.toISOString() };
  }
  if (old.durationMinutes !== updated.durationMinutes) {
    diff.durationMinutes = { old: old.durationMinutes, new: updated.durationMinutes };
  }
  if (old.locationId !== updated.locationId) {
    diff.locationId = { old: old.locationId, new: updated.locationId };
  }
  if (old.modality !== updated.modality) {
    diff.modality = { old: old.modality, new: updated.modality };
  }
  if (old.amount !== updated.amount) {
    diff.amount = { old: old.amount, new: updated.amount };
  }
  if (old.notes !== updated.notes) {
    diff.notes = { old: old.notes, new: updated.notes };
  }
  if (old.color !== updated.color) {
    diff.color = { old: old.color, new: updated.color };
  }

  return diff;
}

/**
 * Determines the appropriate history action based on what changed.
 * "rescheduled" if start_at or end_at changed, "updated" otherwise.
 */
function determineAction(
  diff: Record<string, { old: unknown; new: unknown }>,
): 'rescheduled' | 'updated' {
  if ('startAt' in diff || 'endAt' in diff) {
    return 'rescheduled';
  }
  return 'updated';
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Updates an existing session for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input against `sessionInputSchema`.
 *   3. Verify ownership — session must belong to authenticated user.
 *   4. Verify ownership of referenced `patient_id` and `location_id`.
 *   5. Detect conflicts (excluding the session being updated).
 *   6. Update session + create history entry in a transaction.
 *      History action is "rescheduled" if start_at/end_at changed,
 *      "updated" otherwise. The diff JSONB records old→new values.
 */
export async function updateSessionImpl(
  supabase: SupabaseClient,
  sessionId: string,
  input: unknown,
): Promise<UpdateSessionResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = sessionInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data = parsed.data;
  const userId = user.id;
  const startAt = new Date(data.start_at);
  const endAt = calculateEndTime(startAt, data.duration_minutes);

  try {
    // 3. Verify ownership
    const [existing] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));

    if (!existing) {
      return { ok: false, error: 'not_found' };
    }

    // 4. Verify ownership of referenced patient_id and location_id
    if (data.patient_id) {
      const [ownedPatient] = await db
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.id, data.patient_id), eq(patients.userId, userId)))
        .limit(1);
      if (!ownedPatient) {
        return {
          ok: false,
          error: 'invalid_input',
          fieldErrors: { patient_id: ['Paciente nao encontrado.'] },
        };
      }
    }

    if (data.location_id) {
      const [ownedLocation] = await db
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.id, data.location_id), eq(locations.userId, userId)))
        .limit(1);
      if (!ownedLocation) {
        return {
          ok: false,
          error: 'invalid_input',
          fieldErrors: { location_id: ['Local nao encontrado.'] },
        };
      }
    }

    // 5. Detect conflicts (excluding the session being updated)
    const windowStart = new Date(startAt.getTime() - 24 * 60 * 60 * 1000);
    const windowEnd = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);

    const existingRows = await db
      .select({
        id: sessions.id,
        startAt: sessions.startAt,
        endAt: sessions.endAt,
        blockingTitle: sessions.blockingTitle,
        patientName: patients.fullName,
      })
      .from(sessions)
      .leftJoin(patients, eq(sessions.patientId, patients.id))
      .where(
        and(
          eq(sessions.userId, userId),
          ne(sessions.id, sessionId),
          gte(sessions.startAt, windowStart),
          lte(sessions.startAt, windowEnd),
          // Cancelled, no-show, and soft-deleted sessions should not block scheduling.
          notInArray(sessions.status, ['cancelled', 'no_show']),
          isNull(sessions.deletedAt),
        ),
      );

    const existingSessions = existingRows.map((row) => ({
      id: row.id,
      startAt: row.startAt,
      endAt: row.endAt,
      patientName: row.patientName,
      blockingTitle: row.blockingTitle,
    }));

    const conflicts = detectConflicts({ startAt, endAt }, existingSessions);

    if (conflicts.length > 0 && !data.force_conflict) {
      return {
        ok: false,
        error: 'conflict_warning',
        conflicts,
      };
    }

    // 6. Update session + history in a transaction
    const updatedValues = {
      patientId: data.patient_id ?? null,
      isBlocking: data.is_blocking,
      blockingTitle: data.blocking_title ?? null,
      startAt,
      endAt,
      durationMinutes: data.duration_minutes,
      locationId: data.location_id ?? null,
      modality: data.modality ?? null,
      amount: data.amount ?? null,
      notes: data.notes ?? null,
      color: data.color ?? null,
    };

    const diff = computeDiff(existing, updatedValues);
    const action = determineAction(diff);

    await db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({ ...updatedValues, updatedAt: sql`now()` })
        .where(eq(sessions.id, sessionId));

      await tx.insert(sessionHistory).values({
        sessionId,
        userId,
        action,
        changes: diff,
      });
    });

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'update_session_failed', errorCode: pgError.code },
      'unexpected error updating session',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao atualizar sessao. Tente novamente.',
    };
  }
}
