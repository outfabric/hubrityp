import { writeFile } from 'node:fs/promises';

import { test as setup } from '@playwright/test';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

import { readSeedState, STORAGE_STATE_PATH } from './seed-state';

// Programmatic signin for the default `@auth` e2e suite.
//
// We let `@supabase/ssr` write the cookie value itself (via a captured
// `setAll` callback) instead of hand-rolling the format. This keeps the
// suite robust against changes to the cookie name (`sb-<projectRef>-auth-token`),
// the encoding (`base64-` + base64url), or the chunking strategy. The mock
// GoTrue started in `global-setup.ts` validates the bearer when
// `setSession` calls `_getUser` under the hood — that's what makes
// `setSession` succeed without a real Auth server.
//
// The resulting cookies are written to a Playwright `storageState` JSON,
// scoped to the e2e baseURL host (`localhost`). Tests that need an
// authenticated session opt in via:
//   test.use({ storageState: 'e2e/.auth/state.json' })
//
// `auth-real` (wave 3) keeps a separate folder + setup that exercises the
// real GoTrue from `supabase start`.

setup('write simulated auth state', async () => {
  const seed = await readSeedState();

  // Captured cookies from `@supabase/ssr`'s `setAll`. The library calls
  // `setAll` exactly once per `setSession` (after `_saveSession`), so a
  // single capture buffer is sufficient.
  type CapturedCookie = { name: string; value: string; options: CookieOptions };
  const captured: CapturedCookie[] = [];

  const supabase = createServerClient(seed.supabaseUrl, 'e2e-anon-key', {
    cookies: {
      getAll(): { name: string; value: string }[] {
        // Initial state is empty — there are no prior cookies on a fresh
        // setup run.
        return [];
      },
      setAll(cookiesToSet): void {
        captured.push(...cookiesToSet);
      },
    },
  });

  const { error } = await supabase.auth.setSession({
    access_token: seed.accessToken,
    refresh_token: seed.refreshToken,
  });

  if (error) {
    throw new Error(`auth.setup: setSession failed — ${error.message}`);
  }

  if (captured.length === 0) {
    throw new Error('auth.setup: setSession completed but no cookies were captured');
  }

  // Build the Playwright storageState. Scope every captured cookie to the
  // baseURL host (`localhost`) so the test browser ships them on every
  // request to the Next.js server. We deliberately do NOT use the cookie
  // options' `domain` field (`@supabase/ssr` does not set it for
  // first-party use) — Playwright requires either `url` or
  // `domain`+`path`, so we set `domain: 'localhost'` explicitly.
  type PlaywrightCookie = {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  };

  const cookies: PlaywrightCookie[] = captured.map((c) => ({
    name: c.name,
    value: c.value,
    domain: 'localhost',
    path: c.options.path ?? '/',
    // -1 means a session cookie. We always want a stable expiry so a long
    // suite run does not race the cookie maxAge.
    expires: Math.floor(Date.now() / 1000) + (c.options.maxAge ?? 60 * 60 * 24),
    httpOnly: c.options.httpOnly ?? false,
    // The default e2e baseURL is `http://localhost:3000` (no TLS). A
    // `Secure` cookie would be silently dropped, leaving the browser
    // unauthenticated. Force `false` for the simulated suite — the
    // `@auth-real` wave validates the production secure-cookie path.
    secure: false,
    sameSite: normaliseSameSite(c.options.sameSite),
  }));

  const state = { cookies, origins: [] as never[] };

  await writeFile(STORAGE_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
});

function normaliseSameSite(value: CookieOptions['sameSite']): 'Strict' | 'Lax' | 'None' {
  if (value === true) return 'Strict';
  if (value === false || value === undefined) return 'Lax';
  if (value === 'lax') return 'Lax';
  if (value === 'strict') return 'Strict';
  if (value === 'none') return 'None';
  return 'Lax';
}
