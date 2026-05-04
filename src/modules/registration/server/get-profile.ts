import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import type { Profile, ProfileStatus } from '@/modules/registration/lib/profile';
import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';

// `getCurrentProfile` is the canonical adapter from a Supabase session to a
// typed `profiles` row. RSC pages, layouts, Server Actions, and the
// middleware MUST consume profile data through this function so status-aware
// behavior stays consistent across surfaces.
//
// Contract:
//   - One PK lookup MAX per call (no count/join round trips). Performance
//     budget asserted by `data-layer` requirements (P95 < 50ms).
//   - Returns `null` when there is no session, OR when the auth.user exists
//     but the `profiles` row hasn't been materialized yet (race window
//     between `auth.signUp` returning and the SECURITY DEFINER trigger
//     committing). Callers MUST treat both cases identically — "treat like
//     anonymous for redirect logic" per the spec.
//   - `status` arrives from the DB as `text`, narrowed here to the
//     `ProfileStatus` union via the lib type.
//
// The Supabase client is passed in (not constructed inside) so callers
// control the cookie context — middleware uses the middleware-bound client,
// pages use the request-bound server client, etc. The parameter is typed
// as the structurally-compatible `SupabaseClient` from `@supabase/supabase-js`
// (which `@supabase/ssr` clients also satisfy) to keep the dependency
// surface narrow.
export async function getCurrentProfile(supabase: SupabaseClient): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const [row] = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);

  if (!row) {
    return null;
  }

  // The DB stores `status` as `text` with a CHECK constraint; the type
  // narrowing here is the runtime↔type bridge that lets consumers do
  // exhaustive `switch` checks on `profile.status`. If a future migration
  // ever introduces a status outside `ProfileStatus`, this cast becomes a
  // bug — but the trigger and Server Actions also enforce the closed set,
  // so the assumption is safe in practice.
  return { ...row, status: row.status as ProfileStatus };
}
