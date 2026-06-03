import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';

import type { UnauthorizedResult } from '../lib/types';

export interface HasAnyDataResult {
  ok: true;
  hasAnyData: boolean;
}

/**
 * Returns whether the authenticated psychologist has any data yet — at least
 * one patient OR at least one session. Drives the dashboard's empty-state
 * decision: a brand-new user (zero of both) sees the first-steps checklist slot
 * instead of the four operational sections.
 *
 * Security:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. Both existence checks are scoped `user_id = session.uid` — defense in
 *      depth on top of RLS (`db` bypasses RLS). No caller-supplied id.
 *
 * Each check uses a bounded `EXISTS`-style `limit(1)` so we never count whole
 * tables; the first matching row short-circuits.
 */
export async function hasAnyData(
  supabase: SupabaseClient,
): Promise<HasAnyDataResult | UnauthorizedResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  const { sessions } = await import('@/shared/db/schema/agenda/tables');
  const { patients } = await import('@/shared/db/schema/patients/tables');

  const [patientRows, sessionRows] = await Promise.all([
    db
      .select({ one: sql<number>`1` })
      .from(patients)
      .where(eq(patients.userId, userId))
      .limit(1),
    db
      .select({ one: sql<number>`1` })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .limit(1),
  ]);

  return { ok: true, hasAnyData: patientRows.length > 0 || sessionRows.length > 0 };
}
