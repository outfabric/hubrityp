import 'server-only';

import { eq } from 'drizzle-orm';

import type { AppDb } from '@/shared/db/client';
import {
  onboardingChecklist,
  type OnboardingChecklist,
} from '@/shared/db/schema/onboarding/tables';

/**
 * Reads the authenticated psychologist's onboarding checklist row.
 *
 * Authorization is enforced by RLS: `db` MUST be the request's RLS-scoped
 * Drizzle client (bound to the caller's Supabase session), never the
 * service-role / module-level singleton. The `WHERE user_id = userId`
 * predicate is defensive belt-and-suspenders on top of RLS — `userId` comes
 * from the authenticated session, not from caller-supplied input, so it can
 * never widen access beyond the caller's own row.
 *
 * Returns `null` when the row does not exist yet (lazy upsert means the first
 * read for a brand-new user has no checklist), so callers MUST handle `null`.
 *
 * @param db the RLS-scoped Drizzle client (the spec calls it the "supabase" /
 *   RLS-scoped client; here it is the Drizzle `AppDb` bound to that session)
 * @param userId the authenticated psychologist's id (from the session)
 */
export async function getOnboardingChecklist(
  db: AppDb,
  userId: string,
): Promise<OnboardingChecklist | null> {
  const rows = await db
    .select()
    .from(onboardingChecklist)
    .where(eq(onboardingChecklist.userId, userId))
    .limit(1);

  return rows[0] ?? null;
}
