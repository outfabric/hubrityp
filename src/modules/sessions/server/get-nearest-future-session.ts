import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { locations, sessions } from '@/shared/db/schema/agenda/tables';
import { evolutions } from '@/shared/db/schema/medical-records/tables';
import { logger } from '@/shared/lib/logger';

import { PatientIdSchema, type SessionHistoryItem } from '../lib/session-history-schema';

import { mapSessionRow, sessionHistoryColumns } from './session-history-row';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Discriminated result for the nearest-future-session read.
 *
 * `session` is `null` (not `undefined`) when the patient has no upcoming
 * `scheduled`/`confirmed` session — a representable "no future session" state
 * distinct from an error.
 */
export type NearestFutureSessionResult =
  | { ok: true; session: SessionHistoryItem | null }
  | { ok: false; code: 'UNAUTHORIZED' | 'INVALID_INPUT' | 'ERROR' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Returns the single nearest upcoming session for one patient of the
 * authenticated psychologist (RF-13.04).
 *
 * "Upcoming" = a `scheduled` or `confirmed` session with `start_at >= now()`,
 * ordered `start_at ASC`, limited to 1. For a long recurrence this yields only
 * the very next occurrence, never the whole tail.
 *
 * Security (D7 — owner-scope everything):
 *   1. Authenticate via `supabase.auth.getUser()` (NEVER `getSession()` for an
 *      authorization decision).
 *   2. `patientId` is a *filter*, never a trust boundary: it is Zod-validated
 *      and the query is scoped `user_id = session.uid AND patient_id = :pid`.
 *      `db` bypasses RLS, so this explicit owner predicate is the
 *      defense-in-depth layer guaranteeing no cross-tenant read (RN-13.04).
 *
 * Visibility (RN-13.01, RN-13.02): soft-deleted and blocking rows are excluded.
 * A blocking slot has no patient and must never surface as an upcoming session.
 *
 * Couple-safe projection (LGPD-13.03, RN-13.06): the projection exposes only the
 * boolean presence of `patient_ids` — never the partner's id or name.
 */
export async function getNearestFutureSession(
  supabase: SupabaseClient,
  rawPatientId: unknown,
): Promise<NearestFutureSessionResult> {
  // 1. Authenticate (revalidates the JWT with GoTrue — getSession would not).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate the caller-supplied patient id at the boundary.
  const parsed = PatientIdSchema.safeParse(rawPatientId);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT' };
  }

  const userId = user.id;
  const patientId = parsed.data;

  try {
    const [row] = await db
      .select(sessionHistoryColumns)
      .from(sessions)
      .leftJoin(evolutions, eq(evolutions.sessionId, sessions.id))
      .leftJoin(locations, eq(locations.id, sessions.locationId))
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.patientId, patientId),
          isNull(sessions.deletedAt),
          eq(sessions.isBlocking, false),
          inArray(sessions.status, ['scheduled', 'confirmed']),
          gte(sessions.startAt, sql`now()`),
        ),
      )
      .orderBy(asc(sessions.startAt), asc(sessions.id))
      .limit(1);

    return { ok: true, session: row ? mapSessionRow(row) : null };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'get_nearest_future_session_failed', errorCode: pgError.code },
      'unexpected error reading nearest future session',
    );
    return { ok: false, code: 'ERROR' };
  }
}
