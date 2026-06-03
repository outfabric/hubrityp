import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { logger } from '@/shared/lib/logger';

import {
  startOfNextSaoPauloWeek,
  startOfSaoPauloMonth,
  startOfSaoPauloWeek,
} from '../lib/sao-paulo-windows';
import type { UnauthorizedResult, WeeklySummaryResult } from '../lib/types';

// The no-show rate is statistically meaningless on a tiny sample, so it is
// withheld (null) until the week has at least this many resolved sessions
// (done + no_show). Tunable later without a spec change.
const MIN_RESOLVED_FOR_NO_SHOW_RATE = 5;

/**
 * Computes the owner-only weekly summary metrics for the authenticated
 * psychologist:
 *   - sessions done this week (SP calendar week, Monday-based);
 *   - sessions scheduled this week (scheduled/confirmed, including today);
 *   - no-show rate (no_show / (done + no_show)), gated by a minimum sample;
 *   - new patients this month (SP calendar month);
 *   - evolutions recorded this week.
 *
 * Security:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. Every count is scoped `user_id = session.uid` — defense in depth on top
 *      of RLS (`db` bypasses RLS). No caller-supplied id is accepted.
 *
 * All metrics are owner-only counts — never an aggregate that could be mistaken
 * for a market benchmark (RN-11.04). The result carries no clinical content.
 */
export async function getWeeklySummary(
  supabase: SupabaseClient,
): Promise<WeeklySummaryResult | UnauthorizedResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  const { sessions } = await import('@/shared/db/schema/agenda/tables');
  const { patients } = await import('@/shared/db/schema/patients/tables');
  const { evolutions } = await import('@/shared/db/schema/medical-records/tables');

  const now = new Date();
  const weekStart = startOfSaoPauloWeek(now);
  const weekEnd = startOfNextSaoPauloWeek(now);
  const monthStart = startOfSaoPauloMonth(now);

  // One pass over the week's sessions yields every status bucket we need:
  // done, no-show, and scheduled/confirmed. `filter (where …)` keeps it a
  // single owner-scoped scan instead of four separate queries.
  const weekSessionsPromise = db
    .select({
      done: sql<number>`count(*) filter (where ${sessions.status} = 'done')::int`,
      noShow: sql<number>`count(*) filter (where ${sessions.status} = 'no_show')::int`,
      scheduled: sql<number>`count(*) filter (where ${sessions.status} in ('scheduled', 'confirmed'))::int`,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.isBlocking, false),
        isNull(sessions.deletedAt),
        gte(sessions.startAt, weekStart),
        lt(sessions.startAt, weekEnd),
      ),
    );

  const newPatientsPromise = db
    .select({ count: sql<number>`count(*)::int` })
    .from(patients)
    .where(and(eq(patients.userId, userId), gte(patients.createdAt, monthStart)));

  const evolutionsPromise = db
    .select({ count: sql<number>`count(*)::int` })
    .from(evolutions)
    .where(
      and(
        eq(evolutions.userId, userId),
        gte(evolutions.createdAt, weekStart),
        lt(evolutions.createdAt, weekEnd),
      ),
    );

  const [weekRows, newPatientsRows, evolutionsRows] = await Promise.all([
    weekSessionsPromise,
    newPatientsPromise,
    evolutionsPromise,
  ]);

  const sessionsDoneThisWeek = weekRows[0]?.done ?? 0;
  const noShowThisWeek = weekRows[0]?.noShow ?? 0;
  const sessionsScheduledThisWeek = weekRows[0]?.scheduled ?? 0;
  const newPatientsThisMonth = newPatientsRows[0]?.count ?? 0;
  const evolutionsThisWeek = evolutionsRows[0]?.count ?? 0;

  const resolvedCount = sessionsDoneThisWeek + noShowThisWeek;
  const noShowRatePercent =
    resolvedCount >= MIN_RESOLVED_FOR_NO_SHOW_RATE
      ? Math.round((noShowThisWeek / resolvedCount) * 100)
      : null;

  logger.debug({
    module: 'dashboard',
    event: 'weekly_summary',
    userId,
    sessionsDoneThisWeek,
    sessionsScheduledThisWeek,
    newPatientsThisMonth,
    evolutionsThisWeek,
  });

  return {
    ok: true,
    sessionsDoneThisWeek,
    sessionsScheduledThisWeek,
    noShowRatePercent,
    newPatientsThisMonth,
    evolutionsThisWeek,
  };
}
