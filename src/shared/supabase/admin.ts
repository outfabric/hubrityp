import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { clientEnv, serverEnv } from '@/shared/env';

// Service-role Supabase client. RESTRICTED to server-side callers that need
// to perform admin operations the anon-key server client cannot reach:
//   • `auth.admin.deleteUser` (compensating delete on signup rollback)
//   • `auth.admin.createUser` (admin-driven user creation)
//   • `auth.resend({ type: 'signup', email })` issued out-of-session
//
// **Never share, return, or expose this client to the browser.** It carries
// `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS entirely. The `'server-only'`
// import at the top of this module crashes the Next.js build if anything in
// the client graph imports it.
//
// We intentionally do NOT memoize across requests: GoTrue's session cache is
// per-instance, and the Server Actions that consume this client run on
// independent Vercel lambdas. A fresh client per call also avoids any
// surprise where a lingering session from a prior call (in tests) bleeds
// into the next one.
// Return type is inferred from `createClient` so consumers always pick up
// the SDK's exact generic shape — no manual `SupabaseClient<...>` to drift
// out of sync across upgrades.
export function createAdminClient() {
  return createClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      // We never persist a session for the admin client; it is used purely
      // to make admin API calls. Disabling persistence avoids the SDK
      // attempting to read/write `localStorage` in a Node context.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
