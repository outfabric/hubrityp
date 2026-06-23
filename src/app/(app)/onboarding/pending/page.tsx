import { redirect } from 'next/navigation';

import { getCurrentProfile, OnboardingPendingCard, ProfileStatus } from '@/modules/registration';
import { createServerClient } from '@/shared/supabase/server';

// Server Component for `/onboarding/pending`. The middleware (section 8)
// is the authoritative gate for this surface — it routes pending users
// here and bounces active/anonymous users elsewhere — but we still
// defensively re-check the profile on render. Defense-in-depth keeps a
// middleware bypass from leaking the wrong UI to the wrong user, and
// keeps this page useful in tests that don't go through the middleware.
//
// Behavior contract (per `account-registration/spec.md`):
//   - No session OR no profile row yet → redirect to `/login`. The race
//     window where `auth.users` exists but the trigger hasn't materialized
//     `profiles` collapses to "treat as anonymous" per the spec.
//   - `active` → redirect to `/dashboard`. The user already moved past
//     onboarding; landing here would be a stale link.
//   - `suspended` / `cancelled` → redirect to `/login`. These users have
//     no active session by contract; defense-in-depth in case middleware
//     hasn't run yet.
//   - `pending_crp_validation` → render the card.
//   - `pending_verification` is intentionally NOT served here anymore. With
//     Supabase email confirmation enabled, an unconfirmed user can never hold
//     a session, so this authenticated page is unreachable for them. The
//     resend-confirmation experience now lives on the public, session-less
//     `/verifique-email` page. A `pending_verification` profile reaching this
//     branch (only via a middleware bypass) falls through to `/login`.
export default async function OnboardingPendingPage() {
  const supabase = await createServerClient();
  const profile = await getCurrentProfile(supabase);

  if (!profile) {
    redirect('/login');
  }

  switch (profile.status) {
    case ProfileStatus.Active:
      redirect('/dashboard');
    case ProfileStatus.PendingCrpValidation:
      return <OnboardingPendingCard status={profile.status} />;
    case ProfileStatus.PendingVerification:
    case ProfileStatus.Suspended:
    case ProfileStatus.Cancelled:
      redirect('/login');
  }
}
