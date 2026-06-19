import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, asc, eq, gte, isNull, lt } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { logger } from '@/shared/lib/logger';

import { startOfNextSaoPauloDay, startOfSaoPauloDay } from '../lib/sao-paulo-windows';
import type {
  SessionModality,
  SessionStatus,
  TodaySessionsResult,
  TodaySessionView,
  UnauthorizedResult,
} from '../lib/types';

/**
 * Builds the "Abrir sessão" deep link from the session's own row.
 *
 * The target is derived purely from server-side data (modality + ids on the
 * owner's session), never from any client-supplied parameter — so it cannot be
 * coerced into an open-redirect or IDOR sink:
 *   - `online`    → the session's video room
 *   - `in_person` → the patient's file
 */
function buildOpenHref(
  sessionId: string,
  patientId: string | null,
  modality: SessionModality | null,
): string | null {
  if (modality === 'online') {
    return `/sessao/${sessionId}/video`;
  }
  if (modality === 'in_person' && patientId) {
    return `/pacientes/${patientId}`;
  }
  return null;
}

/**
 * Returns the authenticated psychologist's sessions for the current
 * `America/Sao_Paulo` calendar day, ordered by start time, plus the next
 * upcoming session (start >= now).
 *
 * Security:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. Every query is scoped `user_id = session.uid` — defense in depth on top
 *      of RLS (`db` bypasses RLS). No caller-supplied id is ever accepted.
 *   3. Blocking slots and soft-deleted rows are excluded; only real patient
 *      sessions surface in the day view.
 *
 * The result carries only the day-view display fields (patient name, time,
 * modality, status) plus a server-computed `openHref` — no clinical content.
 */
export async function getTodaySessions(
  supabase: SupabaseClient,
  // Injectable clock. Production never passes this (defaults to the real wall
  // clock); tests pin it so the SP-calendar-day window is deterministic and
  // does not flake when the suite runs near the São Paulo midnight boundary.
  now: Date = new Date(),
): Promise<TodaySessionsResult | UnauthorizedResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // Dynamic import keeps the schema out of the Edge bundle path and mirrors the
  // other read-only aggregate actions in the codebase.
  const { sessions } = await import('@/shared/db/schema/agenda/tables');
  const { patients } = await import('@/shared/db/schema/patients/tables');

  const dayStart = startOfSaoPauloDay(now);
  const dayEnd = startOfNextSaoPauloDay(now);

  const rows = await db
    .select({
      sessionId: sessions.id,
      patientId: sessions.patientId,
      patientName: patients.fullName,
      startAt: sessions.startAt,
      modality: sessions.modality,
      status: sessions.status,
    })
    .from(sessions)
    .leftJoin(patients, eq(sessions.patientId, patients.id))
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.isBlocking, false),
        isNull(sessions.deletedAt),
        gte(sessions.startAt, dayStart),
        lt(sessions.startAt, dayEnd),
      ),
    )
    .orderBy(asc(sessions.startAt));

  const views: TodaySessionView[] = rows.map((row) => {
    const modality = (row.modality ?? null) as SessionModality | null;
    return {
      sessionId: row.sessionId,
      patientId: row.patientId,
      patientName: row.patientName,
      startAt: row.startAt,
      modality,
      status: row.status as SessionStatus,
      openHref: buildOpenHref(row.sessionId, row.patientId, modality),
    };
  });

  const next = views.find((view) => view.startAt.getTime() >= now.getTime()) ?? null;

  logger.debug({ module: 'dashboard', event: 'today_sessions', userId, count: views.length });

  return { ok: true, next, sessions: views };
}
