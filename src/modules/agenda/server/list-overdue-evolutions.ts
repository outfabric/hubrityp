import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, asc, eq, isNull, lt } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { locations, sessions } from '@/shared/db/schema/agenda/tables';
import { evolutions } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

import { overdueDays } from '../lib/overdue-days';

// A `done` session is "overdue without evolution" once it has been done for
// more than this window with no evolution recorded against it. This MUST match
// `OVERDUE_EVOLUTION_DAYS` in `dashboard/server/get-pendencias.ts` so the list
// and the dashboard count stay structurally in parity (RF-12.18).
const OVERDUE_EVOLUTION_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * A single done-but-not-evolved session, normalized for the agenda list view.
 * Carries the patient name (resolved server-side) and a UI-facing `modality`
 * label, but never any clinical content.
 */
export interface OverdueEvolutionItem {
  sessionId: string;
  patientId: string;
  patientName: string;
  startAt: Date;
  /** UI label; `null` when the underlying session/location data is absent (RF-12.08 "se disponível"). */
  modality: 'presencial' | 'online' | null;
  daysOverdue: number;
}

export type ListOverdueEvolutionsResult =
  | { ok: true; items: OverdueEvolutionItem[] }
  | { ok: false; code: 'UNAUTHORIZED' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a DB modality/location type token (`in_person` / `online` / `other`) to
 * the UI label. Anything unrecognized (incl. `null`) collapses to `null` so the
 * caller renders nothing rather than a misleading value.
 */
function toModalityLabel(raw: string | null): 'presencial' | 'online' | null {
  if (raw === 'in_person') return 'presencial';
  if (raw === 'online') return 'online';
  return null;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Lists the authenticated psychologist's `done` sessions that are overdue for
 * an evolution: done for more than 7 days with no evolution recorded.
 *
 * The WHERE predicate is IDENTICAL to the dashboard count in
 * `get-pendencias.ts` (anti-join on `evolutions.session_id`, owner-scoped,
 * `status='done'`, not soft-deleted, `start_at` older than the window), so the
 * list length matches the badge count structurally (RF-12.18). Unlike the
 * weekly dashboard widgets, this list is NOT week-bounded — it surfaces every
 * overdue session, however old.
 *
 * Security:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. Owner-scoped `user_id = session.uid` (defense in depth on top of RLS;
 *      `db` bypasses RLS). No caller-supplied id is accepted (RN-12.02).
 *
 * Ordering is `start_at ASC` (oldest first) so the most overdue work surfaces
 * at the top.
 */
export async function listOverdueEvolutionsImpl(
  supabase: SupabaseClient,
): Promise<ListOverdueEvolutionsResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // `now` is captured once so `overdueBefore` (the predicate bound) and
  // `daysOverdue` (per-row duration) are computed against the same instant.
  const now = new Date();
  const overdueBefore = new Date(now.getTime() - OVERDUE_EVOLUTION_DAYS * MS_PER_DAY);

  // Anti-join the owner's `done` sessions against `evolutions` (1:1 via
  // `session_id`); INNER JOIN `patients` for the display name. The predicate
  // mirrors the dashboard count exactly. Couple sessions resolve via the
  // primary `patient_id` FK, which is sufficient for this list's name column.
  const rows = await db
    .select({
      sessionId: sessions.id,
      patientId: patients.id,
      patientName: patients.fullName,
      startAt: sessions.startAt,
      sessionModality: sessions.modality,
      locationType: locations.type,
    })
    .from(sessions)
    .leftJoin(evolutions, eq(evolutions.sessionId, sessions.id))
    .innerJoin(patients, eq(sessions.patientId, patients.id))
    .leftJoin(locations, eq(sessions.locationId, locations.id))
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.status, 'done'),
        isNull(sessions.deletedAt),
        lt(sessions.startAt, overdueBefore),
        isNull(evolutions.id),
      ),
    )
    .orderBy(asc(sessions.startAt));

  const items: OverdueEvolutionItem[] = rows.map((row) => ({
    sessionId: row.sessionId,
    patientId: row.patientId,
    patientName: row.patientName,
    startAt: row.startAt,
    // Prefer the session's own modality; fall back to the location type.
    modality: toModalityLabel(row.sessionModality) ?? toModalityLabel(row.locationType),
    daysOverdue: overdueDays(row.startAt, now),
  }));

  logger.debug({
    module: 'agenda',
    event: 'list_overdue_evolutions',
    userId,
    count: items.length,
  });

  return { ok: true, items };
}
