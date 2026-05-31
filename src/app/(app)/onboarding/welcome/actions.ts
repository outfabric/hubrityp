'use server';

import { skipOnboardingImpl, type SkipOnboardingResult } from '@/modules/onboarding';
import { createServerClient } from '@/shared/supabase/server';

export type { SkipOnboardingResult } from '@/modules/onboarding';

/**
 * Thin Server Action wrapper around {@link skipOnboardingImpl}.
 *
 * The directive lives here (at the call-site boundary), not inside the module
 * `server/` implementation, per the project's module conventions. The action
 * takes NO client input — authorization is `auth.uid()` only, resolved through
 * the request-bound Supabase server client (cookies carry the session). RLS is
 * the backstop on the owner-scoped `profiles` UPDATE.
 */
export async function skipOnboarding(): Promise<SkipOnboardingResult> {
  const supabase = await createServerClient();
  return skipOnboardingImpl(supabase);
}
