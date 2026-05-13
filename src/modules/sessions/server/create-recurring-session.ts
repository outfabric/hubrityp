import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, gte, lte } from 'drizzle-orm';

import { calculateEndTime } from '@/modules/agenda/lib/date-helpers';
import { type ConflictResult, detectConflicts } from '@/modules/agenda/lib/detect-conflicts';
import { sessionInputSchema } from '@/modules/agenda/lib/session-input-schema';
import { generateRecurrenceInstances } from '@/modules/sessions/lib/generate-recurrence-instances';
import { recurrenceFormSchema } from '@/modules/sessions/lib/recurrence-schema';
import { db } from '@/shared/db/client';
import {
  sessions,
  sessionHistory,
  sessionRecurrences,
  locations,
} from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CreateRecurringSessionResult =
  | { ok: true; recurrenceId: string; sessionCount: number }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | {
      ok: false;
      error: 'conflict_warning';
      conflicts: ConflictResult[];
    }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Input schema — merges session template fields with recurrence rule
// ---------------------------------------------------------------------------

/**
 * The combined input for creating a recurring session: session template fields
 * (patient_id, duration, location, etc.) plus recurrence rule fields.
 *
 * `start_at` from the session schema provides the time-of-day; the recurrence
 * rule provides the dates.
 */
interface RecurringSessionInput {
  session: unknown;
  recurrence: unknown;
  force_conflict?: boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a recurring session series for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate session template input and recurrence rule input separately.
 *   3. Verify ownership of referenced patient_id and location_id.
 *   4. Generate instance dates from the recurrence rule.
 *   5. Detect conflicts across all generated dates.
 *   6. In a single transaction:
 *      a. Create `session_recurrences` row.
 *      b. Batch-insert N `sessions` rows with shared recurrence_id.
 *      c. Create history entries for each session.
 */
export async function createRecurringSessionImpl(
  supabase: SupabaseClient,
  input: RecurringSessionInput,
): Promise<CreateRecurringSessionResult> {
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

  const recurrenceParsed = recurrenceFormSchema.safeParse(input.recurrence);
  if (!recurrenceParsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: recurrenceParsed.error.flatten().fieldErrors,
    };
  }

  const sessionData = sessionParsed.data;
  const recurrenceData = recurrenceParsed.data;
  const userId = user.id;

  try {
    // 3. Verify ownership of patient_id and location_id
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

    // 4. Generate instance dates
    const startDate = new Date(recurrenceData.startDate);
    const instanceDates = generateRecurrenceInstances({
      frequency: recurrenceData.frequency,
      daysOfWeek: recurrenceData.daysOfWeek,
      startDate,
      endDate: recurrenceData.endDate ? new Date(recurrenceData.endDate) : undefined,
      occurrenceCount: recurrenceData.occurrenceCount,
      isIndefinite: recurrenceData.isIndefinite,
    });

    if (instanceDates.length === 0) {
      return {
        ok: false,
        error: 'invalid_input',
        fieldErrors: { startDate: ['Nenhuma sessao gerada. Verifique as datas.'] },
      };
    }

    // 5. Conflict detection — extract time-of-day from the session template
    const templateStartAt = new Date(sessionData.start_at);
    const templateHours = templateStartAt.getUTCHours();
    const templateMinutes = templateStartAt.getUTCMinutes();
    const templateSeconds = templateStartAt.getUTCSeconds();

    // Build all session intervals
    const sessionIntervals = instanceDates.map((date) => {
      const startAt = new Date(date);
      startAt.setUTCHours(templateHours, templateMinutes, templateSeconds, 0);
      const endAt = calculateEndTime(startAt, sessionData.duration_minutes);
      return { startAt, endAt };
    });

    // Compute overall time range for fetching existing sessions
    const overallStart = new Date(
      Math.min(...sessionIntervals.map((s) => s.startAt.getTime())) - 24 * 60 * 60 * 1000,
    );
    const overallEnd = new Date(
      Math.max(...sessionIntervals.map((s) => s.endAt.getTime())) + 24 * 60 * 60 * 1000,
    );

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
          gte(sessions.startAt, overallStart),
          lte(sessions.startAt, overallEnd),
        ),
      );

    const existingSessions = existingRows.map((row) => ({
      id: row.id,
      startAt: row.startAt,
      endAt: row.endAt,
      patientName: row.patientName,
      blockingTitle: row.blockingTitle,
    }));

    // Check all intervals for conflicts
    const allConflicts: ConflictResult[] = [];
    for (const interval of sessionIntervals) {
      const conflicts = detectConflicts(interval, existingSessions);
      for (const c of conflicts) {
        // Avoid duplicate conflict entries
        if (!allConflicts.some((existing) => existing.sessionId === c.sessionId)) {
          allConflicts.push(c);
        }
      }
    }

    if (allConflicts.length > 0 && !input.force_conflict) {
      return {
        ok: false,
        error: 'conflict_warning',
        conflicts: allConflicts,
      };
    }

    // 6. Transaction: create recurrence + sessions + history
    const result = await db.transaction(async (tx) => {
      // 6a. Create session_recurrences row
      const [recurrenceRow] = await tx
        .insert(sessionRecurrences)
        .values({
          userId,
          patientId: sessionData.patient_id ?? null,
          frequency: recurrenceData.frequency,
          daysOfWeek: recurrenceData.daysOfWeek ?? null,
          startDate: recurrenceData.startDate.split('T')[0]!,
          endDate: recurrenceData.endDate ? recurrenceData.endDate.split('T')[0]! : null,
          occurrenceCount: recurrenceData.occurrenceCount ?? null,
          isIndefinite: recurrenceData.isIndefinite,
        })
        .returning({ id: sessionRecurrences.id });

      const recurrenceId = recurrenceRow!.id;

      // 6b. Batch-insert sessions
      const sessionValues = sessionIntervals.map((interval) => ({
        userId,
        patientId: sessionData.patient_id ?? null,
        recurrenceId,
        isBlocking: sessionData.is_blocking,
        blockingTitle: sessionData.blocking_title ?? null,
        startAt: interval.startAt,
        endAt: interval.endAt,
        durationMinutes: sessionData.duration_minutes,
        locationId: sessionData.location_id ?? null,
        modality: sessionData.modality ?? null,
        amount: sessionData.amount ?? null,
        notes: sessionData.notes ?? null,
        color: sessionData.color ?? null,
        remindersDisabled: sessionData.reminders_disabled ?? false,
        status: 'scheduled',
      }));

      const insertedSessions = await tx
        .insert(sessions)
        .values(sessionValues)
        .returning({ id: sessions.id });

      // 6c. Create history entries
      const historyValues = insertedSessions.map((s) => ({
        sessionId: s.id,
        userId,
        action: 'created',
        changes: {},
      }));

      await tx.insert(sessionHistory).values(historyValues);

      return { recurrenceId, sessionCount: insertedSessions.length };
    });

    return { ok: true, ...result };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'create_recurring_session_failed', errorCode: pgError.code },
      'unexpected error creating recurring session',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao criar sessao recorrente. Tente novamente.',
    };
  }
}
