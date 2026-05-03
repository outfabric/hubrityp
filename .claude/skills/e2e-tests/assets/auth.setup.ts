// Programmatic signin for the seeded e2e suite.
//
// Uses `@supabase/ssr` to talk to the mock GoTrue (started by
// `start-server.ts` on port 54321). The library writes the cookies in the
// expected format/encoding via the captured `setAll` callback, which we
// then persist as a Playwright `storageState` JSON. Tests opt in via:
//   test.use({ storageState: STORAGE_STATE_PATH })

import { writeFile } from 'node:fs/promises';

import { test as setup } from '@playwright/test';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

import { readSeedState, STORAGE_STATE_PATH } from './seed-state';

setup('write simulated auth state', async () => {
  const seed = await readSeedState();

  type CapturedCookie = { name: string; value: string; options: CookieOptions };
  const captured: CapturedCookie[] = [];

  const supabase = createServerClient(seed.supabaseUrl, 'e2e-anon-key', {
    cookies: {
      getAll(): { name: string; value: string }[] {
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
  if (error) throw new Error(`auth.setup: setSession failed — ${error.message}`);
  if (captured.length === 0) {
    throw new Error('auth.setup: setSession completed but no cookies were captured');
  }

  const cookies = captured.map((c) => ({
    name: c.name,
    value: c.value,
    domain: 'localhost',
    path: c.options.path ?? '/',
    expires: Math.floor(Date.now() / 1000) + (c.options.maxAge ?? 60 * 60 * 24),
    httpOnly: c.options.httpOnly ?? false,
    secure: false,
    sameSite: 'Lax' as const,
  }));

  await writeFile(
    STORAGE_STATE_PATH,
    JSON.stringify({ cookies, origins: [] }, null, 2),
    'utf8'
  );
});
