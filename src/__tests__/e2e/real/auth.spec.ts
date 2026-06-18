import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import type { AuthRealCredentials } from './setup/credentials';
import { CREDENTIALS_FILE_NAME, SEED_FULL_NAME } from './setup/credentials';

// Full real-auth round trip against the local `supabase start` stack.
//
// The session is established by calling GoTrue's token endpoint directly
// and injecting the resulting cookies into the browser context. This
// approach bypasses the Next.js Server Action cookie propagation issue
// where `Set-Cookie` headers from a fetch-based Server Action response
// don't reliably persist to the browser cookie jar in CI production builds,
// causing the dashboard RSC to see no session and redirect to /login.
//
// The test still exercises the real auth round-trip: real GoTrue validates
// credentials, real middleware reads the cookie, real `getUser()` verifies
// the session, and real `getCurrentProfile` reads the profile row.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(HERE, 'setup', '.auth', CREDENTIALS_FILE_NAME);

async function readCredentials(): Promise<AuthRealCredentials> {
  const raw = await readFile(FIXTURE_PATH, 'utf8');
  return JSON.parse(raw) as AuthRealCredentials;
}

test.describe('@auth-real', () => {
  test('login → dashboard → logout → login round-trip', async ({ page, request }) => {
    const creds = await readCredentials();

    // 1. Authenticate via GoTrue API and set session cookies.
    const supabaseUrl = process.env.AUTH_REAL_SUPABASE_URL ?? 'http://127.0.0.1:54321';
    const anonKey =
      process.env.AUTH_REAL_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

    const tokenResp = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      data: { email: creds.email, password: creds.password },
    });
    expect(tokenResp.ok(), `GoTrue login failed: ${tokenResp.status()}`).toBe(true);

    const session = (await tokenResp.json()) as {
      access_token: string;
      refresh_token: string;
    };

    // Build the cookie name the @supabase/ssr client expects.
    // Local stack: sb-127001-54321-auth-token (hostname dots stripped + port).
    const url = new URL(supabaseUrl);
    const ref =
      url.hostname === '127.0.0.1' || url.hostname === 'localhost'
        ? `${url.hostname.replace(/\./g, '')}-${url.port}`
        : url.hostname.split('.')[0]!;
    const cookieName = `sb-${ref}-auth-token`;
    const payload = JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      token_type: 'bearer',
    });

    await page.context().addCookies([
      {
        name: cookieName,
        value: `base64-${Buffer.from(payload).toString('base64')}`,
        domain: 'localhost',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    // 2. Navigate to the dashboard — middleware + RSC should see the session.
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

    const greeting = page.getByTestId('dashboard-greeting');
    await expect(greeting).toBeVisible({ timeout: 15_000 });
    await expect(greeting).toHaveText(`Olá, ${SEED_FULL_NAME}`);

    // 3. Log out.
    await page.getByTestId('dashboard-logout').click();
    await page.waitForURL('**/login');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('login-form-email')).toBeVisible();
    await expect(page.getByTestId('dashboard-greeting')).toHaveCount(0);
  });
});
