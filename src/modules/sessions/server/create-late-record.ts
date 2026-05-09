import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, gte, lte } from 'drizzle-orm';

import { calculateEndTime } from '@/modules/agenda/lib/date-helpers';
import { type ConflictResult, detectConflicts } from '@/modules/agenda/lib/detect-conflicts';
import { sessionInputSchema } from '@/modules/agenda/lib/session-input-schema';
import { lateRecordSchema } from '@/modules/sessions/lib/recurrence-schema';
import { db } from '@/shared/db/client';
import { sessions, sessionHistory, locations } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CreateLateRecordResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'conflict_warning'; conflicts: ConflictResult[] }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

interface LateRecordInput {
  session: unknown;
  lateRecord: unknown;
  force_conflict?: boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a late (retroactive) session record for the authenticated psychologist.
 *
 * A late record bypasses the "no past dates" rule (RN-03.02) because it
 * represents a session that already happened. Status is always 'done'.
 * Conflict detection still applies (RN-03.01).
 * Reminder dispatch is skipped (the session already happened).
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate session template and late record schema.
 *   3. Verify that the date is in the past (enforced by lateRecordSchema).
 *   4. Verify ownership of patient_id and location_id.
 *   5. Detect conflicts.
 *   6. Insert session with is_late_record=true, status='done'.
 */
export async function createLateRecordImpl(
  supabase: SupabaseClient,
  input: LateRecordInput,
): Promise<CreateLateRecordResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate inputs
  const sessionParsed = sessionInputSchema.safeParse(input.session);
  if (!sessionParsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: sessionParsed.error.flatten().fieldErrors,
    };
  }

  const lateRecordParsed = lateRecordSchema.safeParse(input.lateRecord);
  if (!lateRecordParsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: lateRecordParsed.error.flatten().fieldErrors,
    };
  }

  const sessionData = sessionParsed.data;
  const lateRecordData = lateRecordParsed.data;
  const userId = user.id;

  // 3. Extra guard: lateRecordSchema already validates that the date is in the
  // past when is_late_record=true, but we verify it with the session's start_at
  if (!lateRecordData.is_late_record) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: { is_late_record: ['Lancamento retroativo nao marcado.'] },
    };
  }

  const startAt = new Date(sessionData.start_at);
  const endAt = calculateEndTime(startAt, sessionData.duration_minutes);

  // Verify that start_at is indeed in the past
  if (startAt >= new Date()) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: { start_at: ['Lancamentos retroativos devem ter uma data no passado.'] },
    };
  }

  try {
    // 4. Verify ownership of patient_id and location_id
    if (sessionData.patient_id) {
      const [ownedPatient] = await db
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.id, sessionData.patient_id), eq(patients.userId, userId)))
        .limit(1);
      if (!ownedPatient) {
        return {
          ok: false,
          error: 'invalid_input',
          fieldErrors: { patient_id: ['Paciente nao encontrado.'] },
        };
      }
    }

    if (sessionData.location_id) {
      const [ownedLocation] = await db
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.id, sessionData.location_id), eq(locations.userId, userId)))
        .limit(1);
      if (!ownedLocation) {
        return {
          ok: false,
          error: 'invalid_input',
          fieldErrors: { location_id: ['Local nao encontrado.'] },
        };
      }
    }

    // 5. Conflict detection (still applies per design, RN-03.01)
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
          gte(sessions.startAt, windowStart),
          lte(sessions.startAt, windowEnd),
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

    if (conflicts.length > 0 && !input.force_conflict) {
      return {
        ok: false,
        error: 'conflict_warning',
        conflicts,
      };
    }

    // 6. Insert session with is_late_record=true, status='done'
    const [inserted] = await db.transaction(async (tx) => {
      const [sessionRow] = await tx
        .insert(sessions)
        .values({
          userId,
          patientId: sessionData.patient_id ?? null,
          isBlocking: sessionData.is_blocking,
          blockingTitle: sessionData.blocking_title ?? null,
          startAt,
          endAt,
          durationMinutes: sessionData.duration_minutes,
          locationId: sessionData.location_id ?? null,
          modality: sessionData.modality ?? null,
          amount: sessionData.amount ?? null,
          notes: sessionData.notes ?? null,
          color: sessionData.color ?? null,
          status: 'done',
          isLateRecord: true,
        })
        .returning({ id: sessions.id });

      await tx.insert(sessionHistory).values({
        sessionId: sessionRow!.id,
        userId,
        action: 'created',
        changes: { isLateRecord: true },
      });

      return [sessionRow!];
    });

    return { ok: true, sessionId: inserted.id };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'create_late_record_failed', errorCode: pgError.code },
      'unexpected error creating late record',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao criar lancamento retroativo. Tente novamente.',
    };
  }
}
