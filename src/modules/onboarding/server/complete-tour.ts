import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';

export interface CompleteTourOk {
  ok: true;
  /** True only on the call that actually wrote the timestamp (first completion). */
  stamped: boolean;
}

export interface CompleteTourUnauthorized {
  ok: false;
  code: 'UNAUTHORIZED';
}

export type CompleteTourResult = CompleteTourOk | CompleteTourUnauthorized;

/**
 * Idempotently stamps `profiles.tour_completed_at` for the authenticated
 * psychologist when the guided product tour finishes or is skipped. This is the
 * server-truth gate that prevents the tour from auto-running again: the
 * dashboard reads `tour_completed_at` and only auto-runs the tour when it is
 * still NULL (never localStorage, which a user could clear or which would not
 * follow them across devices).
 *
 * The write is `UPDATE profiles SET tour_completed_at = now()
 * WHERE user_id = auth.uid() AND tour_completed_at IS NULL`. The `IS NULL` guard
 * makes every subsequent call a no-op — once stamped, the instant is frozen, so
 * the "Refazer tour" replay (which deliberately re-runs the tour past the gate)
 * never resets or re-stamps the original completion timestamp.
 *
 * Security:
 *   1. Authenticate via `supabase.auth.getUser()` (NEVER `getSession`, which
 *      does not revalidate the JWT with GoTrue and is unsafe for authz). The
 *      identity is revalidated against GoTrue before any write.
 *   2. The owner id comes from the validated session ONLY. This function takes
 *      no payload, so there is no client-supplied user id to honor; the `WHERE`
 *      is scoped `user_id = session.uid` (IDOR-safe). `db` is the module
 *      singleton and bypasses RLS, so the explicit predicate is what keeps a
 *      tenant from touching another's row — RLS remains the backstop.
 *
 * @param supabase the request's RLS-scoped Supabase client (carries the
 *   caller's session cookies); used only to authenticate via `getUser()`.
 */
export async function completeTourImpl(supabase: SupabaseClient): Promise<CompleteTourResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  const { profiles } = await import('@/shared/db/schema/auth/tables');

  // `.returning` reports whether THIS call performed the stamp without a second
  // read: the row is returned only when the `IS NULL` predicate matched.
  const updated = await db
    .update(profiles)
    .set({ tourCompletedAt: sql`now()` })
    .where(and(eq(profiles.userId, userId), isNull(profiles.tourCompletedAt)))
    .returning({ userId: profiles.userId });

  return { ok: true, stamped: updated.length > 0 };
}
