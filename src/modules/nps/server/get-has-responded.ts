import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';

/**
 * Whether the authenticated psychologist has already responded to (or dismissed)
 * the NPS survey — i.e. `nps_responded_at IS NOT NULL`. Consumed by the
 * Configurações > Feedback entry to decide between the form and the thank-you
 * state.
 *
 * Security: identity from `supabase.auth.getUser()` (GoTrue-validated), read is
 * owner-scoped (`WHERE user_id = user.id`), RLS is the backstop. Fail-closed:
 * an unauthenticated request or missing profile returns `true` so a stranger is
 * never offered the submit form. No PII is read or logged.
 */
export async function getNpsHasResponded(supabase: SupabaseClient): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return true;

  const { profiles } = await import('@/shared/db/schema/auth/tables');

  const rows = await db
    .select({ npsRespondedAt: profiles.npsRespondedAt })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1);

  const profile = rows[0];
  if (!profile) return true;

  return profile.npsRespondedAt !== null;
}
