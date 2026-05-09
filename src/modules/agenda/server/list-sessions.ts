import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, asc, eq, gte, lte } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { locations, sessions, type Session } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface SessionWithDetails extends Session {
  patientName: string | null;
  locationName: string | null;
  locationType: string | null;
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

    const result: SessionWithDetails[] = rows.map((row) => ({
      ...row.session,
      patientName: row.patientName,
      locationName: row.locationName,
      locationType: row.locationType,
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
