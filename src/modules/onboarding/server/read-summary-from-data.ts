import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';

import type { OnboardingChecklistSummary } from './read-checklist-summary';
import { recomputeChecklistImpl } from './recompute-checklist';

/**
 * Reads the step-4 ("Pronto") summary for the authenticated psychologist from
 * AUTHORITATIVE DOMAIN DATA — the SAME source the dashboard checklist uses —
 * instead of the potentially-stale stored `onboarding_checklist` flags
 * (onboarding-wizard spec, "Step 4 summarizes from authoritative domain data";
 * design D5).
 *
 * Unifying the reader with {@link recomputeChecklistImpl} eliminates the
 * divergence where a location created outside the wizard (e.g. in Configurações)
 * showed as "missing" on step 4 while the dashboard checklist showed it as done.
 * The recompute re-derives every item from the source tables and persists the
 * refreshed booleans, so this call also heals the cached flags as a side effect.
 *
 * Mapping recompute → the three MVP summary items:
 *   - `locationConfigured`  ← `perfil_e_local`     (>= 1 location)
 *   - `firstPatientAdded`   ← `primeiro_paciente`  (>= 1 active patient)
 *   - `profileCompleted`    ← `profiles.full_name` is set
 *
 * The recompute has no standalone "profile filled" item (its `cadastro_completo`
 * means email-verified + CRP-validated, a different concept), so the profile
 * summary flag is derived from the same `full_name` probe the data-aware resume
 * uses — keeping every "is the profile step satisfied?" check on one signal.
 *
 * Security: authorization is `auth.uid()` only — `recomputeChecklistImpl`
 * authenticates via `getUser()` and scopes every read to the session owner, and
 * the `full_name` read is owner-scoped here. No client input. On an unauthorized
 * session (should not happen on the gated `done` step) we return all-`false`, so
 * the non-blocking summary never crashes the terminal screen.
 */
export async function readOnboardingSummaryFromData(
  supabase: SupabaseClient,
): Promise<OnboardingChecklistSummary> {
  const empty: OnboardingChecklistSummary = {
    profileCompleted: false,
    locationConfigured: false,
    firstPatientAdded: false,
  };

  const recompute = await recomputeChecklistImpl(supabase);
  if (!recompute.ok) {
    return empty;
  }

  // `recomputeChecklistImpl` already verified the session and resolved the owner
  // id; re-read it here only to scope the owner's `full_name` probe.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return empty;
  }

  const [profileRow] = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1);

  return {
    profileCompleted: (profileRow?.fullName?.trim().length ?? 0) > 0,
    locationConfigured: recompute.state.perfil_e_local,
    firstPatientAdded: recompute.state.primeiro_paciente,
  };
}
