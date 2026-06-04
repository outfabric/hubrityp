import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';

import { isEligibleForNps } from '../lib/schemas';

/**
 * Resolves whether the authenticated psychologist should be shown the day-7 NPS
 * survey, derived server-side from the profile's `first_access_at` and
 * `nps_responded_at`. Client storage is never consulted.
 *
 * Security:
 *   - Identity comes from `supabase.auth.getUser()` (GoTrue-validated), never a
 *     client-supplied id. The read is owner-scoped (`WHERE user_id = user.id`),
 *     so it cannot widen access; RLS is the backstop.
 *   - An unauthenticated request, a missing profile, or any read error resolves
 *     to `false` (fail-closed: never offer the survey to a stranger).
 *
 * No PII is read or logged — only the two timestamps needed for the predicate.
 */
export async function getNpsEligibility(supabase: SupabaseClient): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  // Imported lazily to keep this server helper off the Edge module graph if it
  // is ever pulled transitively; the table module carries no Node-only deps but
  // matches the pattern used by `submit-nps.ts`.
  const { profiles } = await import('@/shared/db/schema/auth/tables');

  const rows = await db
    .select({
      firstAccessAt: profiles.firstAccessAt,
      npsRespondedAt: profiles.npsRespondedAt,
    })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1);

  const profile = rows[0];
  if (!profile) return false;

  return isEligibleForNps({
    firstAccessAt: profile.firstAccessAt,
    npsRespondedAt: profile.npsRespondedAt,
    now: new Date(),
  });
}
