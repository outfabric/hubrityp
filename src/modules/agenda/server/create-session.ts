import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, gte, lte } from 'drizzle-orm';

import { calculateEndTime, isInPast } from '@/modules/agenda/lib/date-helpers';
import {
  type ConflictResult,
  detectConflicts,
} from '@/modules/agenda/lib/detect-conflicts';
import { sessionInputSchema } from '@/modules/agenda/lib/session-input-schema';
import { db } from '@/shared/db/client';
import { sessions, sessionHistory } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CreateSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'past_date'; message: string }
  | { ok: false; error: 'conflict_warning'; conflicts: ConflictResult[] }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a new session for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input against `sessionInputSchema`.
 *   3. Reject if `start_at` is in the past (RN-03.02).
 *   4. Fetch existing sessions in a +-24h window for conflict detection.
 *   5. Run `detectConflicts`. If conflicts exist and `force_conflict` is false,
 *      return a warning with the conflicting sessions.
 *   6. Insert session + history entry "created" in a transaction.
 */
export async function createSessionImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<CreateSessionResult> {
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

  // 3. Reject past dates (RN-03.02)
  if (isInPast(startAt)) {
    return {
      ok: false,
      error: 'past_date',
      message: 'Nao e possivel agendar sessoes no passado.',
    };
  }

  // 4. Fetch existing sessions in a +-24h window for conflict detection
  try {
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

    // 5. Detect conflicts
    const conflicts = detectConflicts({ startAt, endAt }, existingSessions);

    if (conflicts.length > 0 && !data.force_conflict) {
      return {
        ok: false,
        error: 'conflict_warning',
        conflicts,
      };
    }

    // 6. Insert session + history in a transaction
    const [inserted] = await db.transaction(async (tx) => {
      const [sessionRow] = await tx
        .insert(sessions)
        .values({
          userId,
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
          status: 'scheduled',
        })
        .returning({ id: sessions.id });

      await tx.insert(sessionHistory).values({
        sessionId: sessionRow!.id,
        userId,
        action: 'created',
        changes: {},
      });

      return [sessionRow!];
    });

    return { ok: true, sessionId: inserted.id };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'create_session_failed', errorCode: pgError.code },
      'unexpected error creating session',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao criar sessao. Tente novamente.',
    };
  }
}
