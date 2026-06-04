/**
 * Helper for E2E specs that drive a DEDICATED seeded user (one not covered by
 * the shared `STORAGE_STATE_PATH` cookie, which always belongs to the global
 * seed user).
 *
 * It mirrors exactly what `dashboard/dashboard-home.spec.ts` does inline for its
 * zero-data user: mint a JWT the running mock GoTrue will accept, register the
 * user (so `getUser()` resolves it and the Edge middleware's PostgREST profile
 * shim returns it as `active`), build the Supabase auth cookie with
 * `@supabase/ssr` (so the cookie name/encoding/chunking stay correct), and inject
 * it into the browser context.
 *
 * The dedicated user's REAL `profiles`/data rows must already exist in Postgres
 * (seeded by `global-setup.ts`); this helper only handles the auth handshake. We
 * pass a static profile row to the shim so the Edge middleware resolves the user
 * as `active` without a DB round-trip — the Node-side render still reads the
 * authoritative `profiles` row from Postgres.
 */

import type { BrowserContext, APIRequestContext } from '@playwright/test';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

import { buildFixedJwt, type MockGoTrueUser } from '../setup/mock-gotrue';
import { readSeedState } from '../setup/seed-state';

/** The minimal identity of a dedicated seeded user, as `global-setup.ts` knows it. */
export interface DedicatedUser {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
}

function buildMockUser(user: DedicatedUser): MockGoTrueUser {
  const nowIso = new Date().toISOString();
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: nowIso,
    phone: '',
    confirmed_at: nowIso,
    last_sign_in_at: nowIso,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: nowIso,
    updated_at: nowIso,
  };
}

function buildActiveProfileRow(user: DedicatedUser): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    user_id: user.id,
    email: user.email,
    full_name: user.fullName,
    crp_number: '00000-X',
    crp_uf: 'SP',
    crp_validated_at: now,
    crp_validated_by: null,
    email_verified_at: now,
    status: 'active',
    terms_accepted_at: now,
    privacy_accepted_at: now,
    sensitive_data_consent_at: now,
    last_resend_at: null,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Registers `user` with the running mock GoTrue and injects its Supabase auth
 * cookie into `context`, so subsequent navigations render as that user.
 *
 * Idempotent across calls within a worker (the registry is keyed by a unique
 * `code` we derive from the user id + a timestamp). Returns nothing — the
 * side-effect is the cookie now living in the browser context.
 */
export async function signInAsDedicatedUser(
  context: BrowserContext,
  request: APIRequestContext,
  user: DedicatedUser,
): Promise<void> {
  const seed = await readSeedState();
  const nowSec = Math.floor(Date.now() / 1000);

  // The anon key in the e2e server is `e2e-anon-key`; supabase-js validates the
  // JWT HMAC locally against it before calling /auth/v1/user, so the token must
  // be signed with that same secret (buildFixedJwt's default).
  const accessToken = buildFixedJwt({
    sub: user.id,
    email: user.email,
    aud: 'authenticated',
    role: 'authenticated',
    exp: nowSec + 60 * 60 * 24 * 30,
    iat: nowSec,
  });

  // A UNIQUE refresh token per user. A Server Action's server-side `getUser()`
  // can trigger supabase-js to refresh the session; without a per-user refresh
  // token the mock would re-issue the DEFAULT seeded session and the action
  // would authorize as the wrong user. Keying the mock's refresh grant to this
  // value keeps the refreshed session bound to `user`.
  const refreshToken = `mock-refresh-${user.id}-${nowSec}`;

  const registerRes = await request.post(`${seed.supabaseUrl}/_test/register-oauth-user`, {
    data: {
      user: buildMockUser(user),
      jwt: accessToken,
      refreshToken,
      code: `dedicated-${user.id}-${nowSec}`,
      profile: buildActiveProfileRow(user),
    },
  });
  if (!registerRes.ok()) {
    throw new Error(
      `signInAsDedicatedUser: register-oauth-user failed (${registerRes.status()}) for ${user.id}`,
    );
  }

  const captured: { name: string; value: string; options: CookieOptions }[] = [];
  const supabase = createServerClient(seed.supabaseUrl, 'e2e-anon-key', {
    cookies: {
      getAll: () => [],
      setAll: (cookiesToSet) => {
        captured.push(...cookiesToSet);
      },
    },
  });
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) {
    throw new Error(`signInAsDedicatedUser: setSession failed for ${user.id} — ${error.message}`);
  }
  if (captured.length === 0) {
    throw new Error(`signInAsDedicatedUser: no cookies captured for ${user.id}`);
  }

  await context.addCookies(
    captured.map((c) => ({
      name: c.name,
      value: c.value,
      domain: 'localhost',
      path: c.options.path ?? '/',
      expires: Math.floor(Date.now() / 1000) + (c.options.maxAge ?? 60 * 60 * 24),
      httpOnly: c.options.httpOnly ?? false,
      secure: false,
      sameSite: 'Lax' as const,
    })),
  );
}
