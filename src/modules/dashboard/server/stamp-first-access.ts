import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';

import type { UnauthorizedResult } from '../lib/types';

export interface StampFirstAccessResult {
  ok: true;
  /** True only on the call that actually wrote the timestamp (first access). */
  stamped: boolean;
}

/**
 * Idempotently stamps `profiles.first_access_at` for the authenticated
 * psychologist on their first authenticated dashboard render. PRD 11 ties the
 * day-7 NPS trigger to this instant, and the dashboard is the first
 * authenticated surface a completed user reliably hits.
 *
 * The write is `UPDATE profiles SET first_access_at = now()
 * WHERE user_id = auth.uid() AND first_access_at IS NULL`. The `IS NULL` guard
 * makes every subsequent render a no-op: once stamped, the value is frozen, so
 * re-renders (and concurrent renders) never overwrite the original instant.
 *
 * Security:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`) — the
 *      identity is revalidated against GoTrue before any write.
 *   2. The `WHERE` is scoped `user_id = session.uid` — defense in depth on top
 *      of RLS (`db` bypasses RLS). No caller-supplied id is ever accepted, so a
 *      cross-user write is impossible: only the caller's own row can be touched.
 *
 * The NPS scheduling itself lives in the notifications/NPS change; this helper
 * only records the timestamp.
 */
export async function stampFirstAccess(
  supabase: SupabaseClient,
): Promise<StampFirstAccessResult | UnauthorizedResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  const { profiles } = await import('@/shared/db/schema/auth/tables');

  // `.returning` lets us report whether THIS call performed the stamp without a
  // second read: the row is returned only when the `IS NULL` predicate matched.
  const updated = await db
    .update(profiles)
    .set({ firstAccessAt: sql`now()` })
    .where(and(eq(profiles.userId, userId), isNull(profiles.firstAccessAt)))
    .returning({ userId: profiles.userId });

  return { ok: true, stamped: updated.length > 0 };
}
