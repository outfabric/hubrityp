import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, gte, lte } from 'drizzle-orm';

import { calculateEndTime, isInPast } from '@/modules/agenda/lib/date-helpers';
import { type ConflictResult, detectConflicts } from '@/modules/agenda/lib/detect-conflicts';
import { sessionInputSchema } from '@/modules/agenda/lib/session-input-schema';
import { coupleSessionSchema } from '@/modules/sessions/lib/recurrence-schema';
import { db } from '@/shared/db/client';
import { sessions, sessionHistory, locations } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CreateCoupleSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'past_date'; message: string }
  | { ok: false; error: 'conflict_warning'; conflicts: ConflictResult[] }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

interface CoupleSessionInput {
  session: unknown;
  couple: unknown;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a couple session for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate session template and couple schema (patient_ids).
 *   3. Verify ownership of both patients and optional location.
 *   4. Reject past dates (RN-03.02).
 *   5. Detect conflicts (RN-03.01).
 *   6. Insert session with patient_id = first entry, patient_ids = full array.
 */
export async function createCoupleSessionImpl(
  supabase: SupabaseClient,
  input: CoupleSessionInput,
): Promise<CreateCoupleSessionResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate session template — override patient_id requirement since
  // we set it from couple data
  const sessionParsed = sessionInputSchema.safeParse(input.session);
  if (!sessionParsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: sessionParsed.error.flatten().fieldErrors,
    };
  }

  const coupleParsed = coupleSessionSchema.safeParse(input.couple);
  if (!coupleParsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: coupleParsed.error.flatten().fieldErrors,
    };
  }

  const sessionData = sessionParsed.data;
  const coupleData = coupleParsed.data;
  const userId = user.id;
  const startAt = new Date(sessionData.start_at);
  const endAt = calculateEndTime(startAt, sessionData.duration_minutes);

  try {
    // 3. Verify ownership of all patient_ids
    for (const patientId of coupleData.patient_ids) {
      const [owned] = await db
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
        .limit(1);
      if (!owned) {
        return {
          ok: false,
          error: 'invalid_input',
          fieldErrors: { patient_ids: ['Paciente nao encontrado.'] },
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

    // 4. Reject past dates
    if (isInPast(startAt)) {
      return {
        ok: false,
        error: 'past_date',
        message: 'Nao e possivel agendar sessoes no passado.',
      };
    }

    // 5. Conflict detection
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

    if (conflicts.length > 0 && !sessionData.force_conflict) {
      return {
        ok: false,
        error: 'conflict_warning',
        conflicts,
      };
    }

    // 6. Insert session — patient_id = first entry, patient_ids = full array
    const primaryPatientId = coupleData.patient_ids[0]!;

    const [inserted] = await db.transaction(async (tx) => {
      // Use raw SQL for patient_ids because Drizzle needs explicit UUID[] cast
      const [sessionRow] = await tx
        .insert(sessions)
        .values({
          userId,
          patientId: primaryPatientId,
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
          remindersDisabled: sessionData.reminders_disabled ?? false,
          status: 'scheduled',
          patientIds: coupleData.patient_ids,
        })
        .returning({ id: sessions.id });

      await tx.insert(sessionHistory).values({
        sessionId: sessionRow!.id,
        userId,
        action: 'created',
        changes: { coupleSession: true, patientIds: coupleData.patient_ids },
      });

      return [sessionRow!];
    });

    return { ok: true, sessionId: inserted.id };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'create_couple_session_failed', errorCode: pgError.code },
      'unexpected error creating couple session',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao criar sessao de casal. Tente novamente.',
    };
  }
}
