import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { evolutions } from '@/shared/db/schema/medical-records/tables';
import { logger } from '@/shared/lib/logger';

import { computeAttendanceRate } from '../lib/compute-attendance-rate';
import { PatientIdSchema, type SessionHistorySummary } from '../lib/session-history-schema';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Discriminated result for the patient session-history summary read.
 *
 * Mirrors the dashboard read-query convention: the page can render an
 * unauthenticated / error state without an out-of-band channel, and a data
 * payload is unrepresentable alongside an error code.
 */
export type PatientSessionSummaryResult =
  | { ok: true; summary: SessionHistorySummary }
  | { ok: false; code: 'UNAUTHORIZED' | 'INVALID_INPUT' | 'ERROR' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Computes the aggregate session-history summary for one patient of the
 * authenticated psychologist (D3, RF-13.01, RF-13.02).
 *
 * Security (D7 — owner-scope everything):
 *   1. Authenticate via `supabase.auth.getUser()` (NEVER `getSession()` for an
 *      authorization decision).
 *   2. `patientId` from input is a *filter*, never a trust boundary: it is Zod
 *      -validated and the query is scoped `user_id = session.uid AND
 *      patient_id = :pid`. `db` bypasses RLS, so this explicit owner predicate
 *      is the defense-in-depth layer that prevents cross-tenant reads even if
 *      RLS were somehow disabled (RN-13.04).
 *
 * Visibility (RN-13.01, RN-13.02): only non-soft-deleted, non-blocking rows
 * count. Blocking slots have no patient and must never reach a clinical metric.
 *
 * The result carries only counts + the last-done instant — never a session id,
 * a patient name, or any clinical text — so it is safe to surface as-is.
 */
export async function getPatientSessionSummary(
  supabase: SupabaseClient,
  rawPatientId: unknown,
): Promise<PatientSessionSummaryResult> {
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
    // Single aggregate pass over the patient's visible sessions. The LEFT JOIN
    // to `evolutions` (1:1 via `session_id`) lets us count `done` sessions with
    // no matching evolution in the same scan (`e.id IS NULL`). Every count is
    // owner-scoped on `user_id` — the WHERE filters the join input, so the join
    // never widens the visible set beyond the caller's rows.
    const [row] = await db
      .select({
        // doneTotal — completed sessions (RF-13.02).
        doneTotal: sql<number>`count(*) filter (where ${sessions.status} = 'done')::int`,
        // Attendance denominator buckets (RN-13.03): only patient-attributable
        // outcomes. Therapist-initiated and NULL-attributed cancellations are
        // excluded by the explicit `cancelled_by = 'patient'` predicate.
        cancelledByPatient: sql<number>`count(*) filter (where ${sessions.status} = 'cancelled' and ${sessions.cancelledBy} = 'patient')::int`,
        noShow: sql<number>`count(*) filter (where ${sessions.status} = 'no_show')::int`,
        // doneWithoutEvolution — `done` rows whose evolution join missed
        // (RN-13.04). Counts distinct sessions so a (hypothetical) duplicate
        // join row can never inflate the count.
        doneWithoutEvolution: sql<number>`count(distinct ${sessions.id}) filter (where ${sessions.status} = 'done' and ${evolutions.id} is null)::int`,
        // lastDoneAt — newest completed session start (RF-13.02). NULL when the
        // patient has no `done` session yet. A raw `max()` aggregate is returned
        // by the driver as a timestamp string (not a parsed `Date`), so it is
        // normalized to ISO via `Date` below.
        lastDoneAt: sql<
          string | null
        >`max(${sessions.startAt}) filter (where ${sessions.status} = 'done')`,
      })
      .from(sessions)
      .leftJoin(evolutions, eq(evolutions.sessionId, sessions.id))
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.patientId, patientId),
          isNull(sessions.deletedAt),
          eq(sessions.isBlocking, false),
        ),
      );

    // An empty patient (no visible sessions) still returns a single row with
    // zeroed counts and a NULL `lastDoneAt` — never `undefined`.
    const doneTotal = row?.doneTotal ?? 0;
    const cancelledByPatient = row?.cancelledByPatient ?? 0;
    const noShow = row?.noShow ?? 0;
    const doneWithoutEvolution = row?.doneWithoutEvolution ?? 0;
    const rawLastDoneAt = row?.lastDoneAt ?? null;

    const summary: SessionHistorySummary = {
      doneTotal,
      attendanceRate: computeAttendanceRate({ done: doneTotal, cancelledByPatient, noShow }),
      doneWithoutEvolution,
      // Normalize the driver's timestamp string to a stable ISO-8601 instant so
      // the result is serializable across the RSC / client boundary.
      lastDoneAt: rawLastDoneAt === null ? null : new Date(rawLastDoneAt).toISOString(),
    };

    return { ok: true, summary };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'get_patient_session_summary_failed', errorCode: pgError.code },
      'unexpected error computing patient session summary',
    );
    return { ok: false, code: 'ERROR' };
  }
}
