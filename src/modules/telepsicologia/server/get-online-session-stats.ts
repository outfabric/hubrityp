import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, count, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const onlineSessionStatsInputSchema = z.object({
  /** Start of the month (inclusive), ISO 8601 date string. */
  monthStart: z.string().datetime({ message: 'monthStart must be a valid ISO datetime.' }),
  /** End of the month (exclusive), ISO 8601 date string. */
  monthEnd: z.string().datetime({ message: 'monthEnd must be a valid ISO datetime.' }),
});

export type OnlineSessionStatsInput = z.infer<typeof onlineSessionStatsInputSchema>;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface OnlineSessionStats {
  onlineCount: number;
  totalDoneCount: number;
  /** Percentage of online sessions among all done sessions (0-100). */
  percentage: number;
}

export type GetOnlineSessionStatsResult =
  | { ok: true; stats: OnlineSessionStats }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Returns online session statistics for the dashboard (RF-09.29).
 *
 * Queries sessions WHERE status='done' in the given month range, counting
 * total done sessions and those with modality='online'. The percentage is
 * computed server-side.
 *
 * Auth: authenticates via `supabase.auth.getUser()` and scopes the query
 * to the authenticated user's sessions (user_id = auth.uid()). RLS provides
 * the defense-in-depth layer.
 *
 * Soft-deleted sessions (deleted_at IS NOT NULL) are excluded.
 */
export async function getOnlineSessionStatsImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<GetOnlineSessionStatsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = onlineSessionStatsInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const monthStart = new Date(parsed.data.monthStart);
  const monthEnd = new Date(parsed.data.monthEnd);
  const userId = user.id;

  // 3. Query: count done sessions and online done sessions in a single query.
  //    Uses conditional aggregation to avoid two round-trips.
  const [result] = await db
    .select({
      totalDone: count(),
      onlineCount: count(sql`CASE WHEN ${sessions.modality} = 'online' THEN 1 END`),
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.status, 'done'),
        gte(sessions.startAt, monthStart),
        lt(sessions.startAt, monthEnd),
        isNull(sessions.deletedAt),
      ),
    );

  const totalDoneCount = result?.totalDone ?? 0;
  const onlineCount = result?.onlineCount ?? 0;
  const percentage = totalDoneCount > 0 ? Math.round((onlineCount / totalDoneCount) * 100) : 0;

  return {
    ok: true,
    stats: {
      onlineCount,
      totalDoneCount,
      percentage,
    },
  };
}
