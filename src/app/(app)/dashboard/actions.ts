'use server';

// Thin route shell for the dashboard Server Actions.
//
// The actual implementation lives in `src/modules/onboarding/server/` and is
// re-exported from `@/modules/onboarding`. This file carries the `'use server'`
// directive — that is what marks each export as a Server Action entry point for
// the Next.js compiler. Every export of a `'use server'` file MUST be an async
// function; types cannot be re-exported from here.
//
// Security: the wrapper builds a fresh RLS-scoped Supabase client carrying the
// caller's session cookies (`createServerClient`) — never the service role. The
// underlying impl authenticates via `supabase.auth.getUser()` and scopes the
// write to `auth.uid()`, so it can only ever stamp the caller's own profile row.

import { completeTourImpl } from '@/modules/onboarding';
import { createServerClient } from '@/shared/supabase/server';

/**
 * Stamps `profiles.tour_completed_at` for the authenticated psychologist when
 * the guided tour finishes or is skipped. Idempotent (the impl no-ops once the
 * timestamp is set). Returns `void` — the client tour leaf does not branch on
 * the outcome; a failed stamp only means the tour may auto-run again, which is
 * acceptable and self-healing.
 */
export async function completeTour(): Promise<void> {
  const supabase = await createServerClient();
  await completeTourImpl(supabase);
}
