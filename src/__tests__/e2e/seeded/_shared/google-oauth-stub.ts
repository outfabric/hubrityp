import type { Page, Route } from '@playwright/test';
import postgres from 'postgres';

import { buildFixedJwt } from '../setup/mock-gotrue';
import { readSeedState } from '../setup/seed-state';

// Stub for Google OAuth in E2E tests.
//
// 1. Registers a synthetic OAuth user with the mock GoTrue (via its
//    `/_test/register-oauth-user` API) so the server-side PKCE code
//    exchange returns the correct session.
// 2. Seeds the auth.users row in the real Postgres DB so the server-side
//    Drizzle queries (profile lookup, profile INSERT) work correctly.
// 3. Intercepts browser navigation to Google/Supabase authorize endpoints,
//    redirecting to the local callback.

export type GoogleOAuthStubOptions = {
  /** Email address returned by the simulated Google identity. */
  email: string;
  /** Display name returned by the simulated Google identity. */
  name: string;
  /** Google identity provider user ID. */
  providerUserId: string;
  /** Supabase auth.users.id for this identity. */
  userId: string;
  /** Profile data to return from the PostgREST shim (Edge middleware). null = no profile. */
  profile?: Record<string, unknown> | null;
  /** If true, also seed a profile row in the real DB. */
  seedProfileInDb?: boolean;
};

export type GoogleOAuthStubHandle = {
  teardown: () => Promise<void>;
  /** The JWT minted for this stub identity. */
  jwt: string;
  /** The code registered with the mock GoTrue. */
  code: string;
};

export async function setupGoogleOAuthStub(
  page: Page,
  options: GoogleOAuthStubOptions,
): Promise<GoogleOAuthStubHandle> {
  const code = `mock-oauth-code-${options.userId}`;

  const nowSec = Math.floor(Date.now() / 1000);
  const jwt = buildFixedJwt({
    sub: options.userId,
    email: options.email,
    aud: 'authenticated',
    role: 'authenticated',
    exp: nowSec + 60 * 60 * 24 * 30,
    iat: nowSec,
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: options.name },
  });

  const nowIso = new Date().toISOString();
  const userPayload = {
    id: options.userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: options.email,
    email_confirmed_at: nowIso,
    phone: '',
    confirmed_at: nowIso,
    last_sign_in_at: nowIso,
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: options.name },
    identities: [
      {
        id: options.providerUserId,
        user_id: options.userId,
        provider: 'google',
        identity_data: { email: options.email, full_name: options.name },
        created_at: nowIso,
        updated_at: nowIso,
      },
    ],
    created_at: nowIso,
    updated_at: nowIso,
  };

  // --- Step 1: Register with mock GoTrue ---
  const mockGoTrueUrl = 'http://127.0.0.1:54321';
  const registerResponse = await fetch(`${mockGoTrueUrl}/_test/register-oauth-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user: userPayload,
      jwt,
      code,
      profile: options.profile !== undefined ? options.profile : null,
    }),
  });

  if (!registerResponse.ok) {
    throw new Error(
      `Failed to register OAuth user with mock GoTrue: ${registerResponse.status} ${await registerResponse.text()}`,
    );
  }

  // --- Step 2: Seed auth.users in real Postgres ---
  const seedState = await readSeedState();
  const sql = postgres(seedState.databaseUrl, { max: 1, onnotice: () => {} });
  try {
    // Insert the auth.users row. Temporarily disable the trigger to avoid
    // trigger validation (the OAuth trigger branch may not be present on
    // reused containers with older migration state).
    await sql`ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created`;
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
      VALUES (
        ${options.userId},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${options.email},
        ${JSON.stringify({ full_name: options.name })}::jsonb,
        ${JSON.stringify({ provider: 'google', providers: ['google'] })}::jsonb
      )
      ON CONFLICT (id) DO NOTHING;
    `;
    await sql`ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created`;

    // Optionally seed a profile row (for returning-active user scenario).
    if (options.seedProfileInDb) {
      await sql`
        INSERT INTO public.profiles (
          user_id, email, full_name, crp_number, crp_uf, status,
          email_verified_at, terms_accepted_at, privacy_accepted_at,
          sensitive_data_consent_at
        ) VALUES (
          ${options.userId}, ${options.email}, ${options.name},
          '06/888888', 'SP', 'active',
          NOW(), NOW(), NOW(), NOW()
        )
        ON CONFLICT DO NOTHING;
      `;
    }
  } finally {
    await sql.end();
  }

  // --- Step 3: Intercept browser navigation ---
  const googleHandler = async (route: Route) => {
    const callbackUrl = new URL('/auth/callback', 'http://localhost:3000');
    callbackUrl.searchParams.set('code', code);
    await route.fulfill({
      status: 302,
      headers: { Location: callbackUrl.toString() },
    });
  };

  const supabaseAuthorizeHandler = async (route: Route) => {
    const callbackUrl = new URL('/auth/callback', 'http://localhost:3000');
    callbackUrl.searchParams.set('code', code);
    await route.fulfill({
      status: 302,
      headers: { Location: callbackUrl.toString() },
    });
  };

  await page.route('**/accounts.google.com/**', googleHandler);
  await page.route('**/auth/v1/authorize**', supabaseAuthorizeHandler);

  return {
    teardown: async () => {
      await page.unroute('**/accounts.google.com/**', googleHandler);
      await page.unroute('**/auth/v1/authorize**', supabaseAuthorizeHandler);

      // Cleanup: remove ONLY this stub's registration from the mock GoTrue
      // registry. We pass our own `code` so the clear is surgical — an unscoped
      // clear would wipe the dedicated checklist/empty users registered by
      // sibling specs running in parallel, making the Edge profile shim resolve
      // "no profile" for them and bounce those specs to /login mid-test.
      await fetch(`${mockGoTrueUrl}/_test/clear-oauth-users`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      }).catch(() => {});

      // Cleanup: remove seeded DB rows.
      const cleanSql = postgres(seedState.databaseUrl, { max: 1, onnotice: () => {} });
      try {
        await cleanSql`DELETE FROM oauth_identities WHERE user_id = ${options.userId}`;
        await cleanSql`DELETE FROM auth_logs WHERE user_id = ${options.userId}`;
        // auth.users cascade deletes profiles.
        await cleanSql`DELETE FROM auth.users WHERE id = ${options.userId}`;
      } catch {
        // Best-effort cleanup.
      } finally {
        await cleanSql.end();
      }
    },
    jwt,
    code,
  };
}
