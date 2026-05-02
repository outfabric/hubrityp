import { mapSupabaseUser } from '@/lib/auth/map-supabase-user';
import { createServerClient } from '@/lib/supabase/server';

// Authenticated identity probe. Identity is read EXCLUSIVELY from the session
// cookie via `supabase.auth.getUser()` — query params and headers are
// deliberately ignored so a malicious caller cannot pass `?userId=...` to
// impersonate another user. Use only as a smoke check / login canary;
// production code paths read the user from the page-level loader instead.
type MeOk = { userId: string; email: string };
type MeUnauthenticated = { ok: false; error: 'unauthenticated' };

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

const UNAUTHENTICATED_BODY: MeUnauthenticated = { ok: false, error: 'unauthenticated' };

export async function GET(): Promise<Response> {
  const supabase = await createServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return Response.json(UNAUTHENTICATED_BODY, { status: 401, headers: NO_STORE_HEADERS });
  }

  const mapped = mapSupabaseUser(user);
  if (!mapped) {
    // Defensive: a Supabase user without an id/email is a contract violation
    // upstream. Treat as unauthenticated rather than leaking a partial body.
    return Response.json(UNAUTHENTICATED_BODY, { status: 401, headers: NO_STORE_HEADERS });
  }

  const body: MeOk = { userId: mapped.id, email: mapped.email };
  return Response.json(body, { status: 200, headers: NO_STORE_HEADERS });
}
