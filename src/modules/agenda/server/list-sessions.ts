import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { locations, sessions, type Session } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves patient names for couple sessions that have `patient_ids` with 2
 * entries. Returns a map of session.id -> "Name1 & Name2" display string.
 */
async function resolveCoupleDisplayNames(
  sessionRows: Array<{ id: string; patientIds: string[] | null; patientName: string | null }>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  // Collect all unique secondary patient IDs that we need to resolve
  const secondaryIdToSessionIds = new Map<string, string[]>();
  for (const row of sessionRows) {
    if (!row.patientIds || row.patientIds.length !== 2) continue;
    // The primary patient is already resolved via the JOIN. We need the other one.
    // patient_ids[0] is the primary (same as patient_id), patient_ids[1] is secondary.
    const secondaryId = row.patientIds[1];
    if (!secondaryId) continue;
    const existing = secondaryIdToSessionIds.get(secondaryId) ?? [];
    existing.push(row.id);
    secondaryIdToSessionIds.set(secondaryId, existing);
  }

  if (secondaryIdToSessionIds.size === 0) return result;

  // Batch-fetch all secondary patient names
  const secondaryIds = [...secondaryIdToSessionIds.keys()];
  const nameRows = await db
    .select({ id: patients.id, fullName: patients.fullName })
    .from(patients)
    .where(inArray(patients.id, secondaryIds));

  const nameMap = new Map(nameRows.map((r) => [r.id, r.fullName]));

  // Build "Name1 & Name2" for each couple session
  for (const row of sessionRows) {
    if (!row.patientIds || row.patientIds.length !== 2) continue;
    const secondaryId = row.patientIds[1];
    if (!secondaryId) continue;
    const secondaryName = nameMap.get(secondaryId);
    const primaryFirst = row.patientName?.split(' ')[0] ?? 'Paciente';
    const secondaryFirst = secondaryName?.split(' ')[0] ?? 'Paciente';
    result.set(row.id, `${primaryFirst} & ${secondaryFirst}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface SessionWithDetails extends Session {
  patientName: string | null;
  locationName: string | null;
  locationType: string | null;
  locationAddress: string | null;
  /** "Ana & Carlos" format for couple sessions (patient_ids.length === 2). */
  coupleDisplayName: string | null;
}

export type ListSessionsResult =
  | { ok: true; sessions: SessionWithDetails[] }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Lists sessions for the authenticated psychologist within a time window.
 *
 * JOINs with `patients` (for name) and `locations` (for name/type).
 * Results are ordered by `start_at ASC`. Uses the composite index
 * `(user_id, start_at)` for performance.
 *
 * RLS guarantees ownership scope, but we add an explicit `userId` filter
 * for defense-in-depth.
 */
export async function listSessionsImpl(
  supabase: SupabaseClient,
  startDate: Date,
  endDate: Date,
): Promise<ListSessionsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Query sessions with LEFT JOINs on patients and locations
  try {
    const rows = await db
      .select({
        session: sessions,
        patientName: patients.fullName,
        locationName: locations.name,
        locationType: locations.type,
        locationAddress: locations.address,
      })
      .from(sessions)
      .leftJoin(patients, eq(sessions.patientId, patients.id))
      .leftJoin(locations, eq(sessions.locationId, locations.id))
      .where(
        and(
          eq(sessions.userId, user.id),
          gte(sessions.startAt, startDate),
          lte(sessions.startAt, endDate),
        ),
      )
      .orderBy(asc(sessions.startAt));

    // Resolve couple display names for sessions with 2 patient_ids
    const coupleInputs = rows.map((row) => ({
      id: row.session.id,
      patientIds: row.session.patientIds,
      patientName: row.patientName,
    }));
    const coupleNames = await resolveCoupleDisplayNames(coupleInputs);

    const result: SessionWithDetails[] = rows.map((row) => ({
      ...row.session,
      patientName: row.patientName,
      locationName: row.locationName,
      locationType: row.locationType,
      locationAddress: row.locationAddress,
      coupleDisplayName: coupleNames.get(row.session.id) ?? null,
    }));

    return { ok: true, sessions: result };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'list_sessions_failed', errorCode: pgError.code },
      'unexpected error listing sessions',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao listar sessoes. Tente novamente.',
    };
  }
}
