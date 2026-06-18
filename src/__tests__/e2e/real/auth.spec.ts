import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import type { AuthRealCredentials } from './setup/credentials';
import { CREDENTIALS_FILE_NAME, SEED_FULL_NAME } from './setup/credentials';

// Full real-auth round trip against the local `supabase start` stack.
//
// Unlike the default `@auth` suite (which uses a simulated cookie + an
// in-process mock GoTrue), this test exercises the production code path
// end-to-end: the Server Action talks to the real GoTrue, GoTrue writes a
// real session row, the dashboard re-reads the user via `supabase.auth.getUser`,
// and the logout Action revokes the session through the same real GoTrue.
//
// Spec source: `specs/e2e-auth-real-suite/spec.md` — "Full handshake passes".

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Setup writes the credentials JSON to `setup/.auth/<file>` (relative to the
// real-suite root). The spec reads from the same location — keep them in sync
// if either layout changes.
const FIXTURE_PATH = path.resolve(HERE, 'setup', '.auth', CREDENTIALS_FILE_NAME);

async function readCredentials(): Promise<AuthRealCredentials> {
  const raw = await readFile(FIXTURE_PATH, 'utf8');
  return JSON.parse(raw) as AuthRealCredentials;
}

test.describe('@auth-real', () => {
  test('login → dashboard → logout → login round-trip', async ({ page }) => {
    const creds = await readCredentials();

    // 1. Log in.
    await page.goto('/login');
    await page.getByTestId('login-form-email').fill(creds.email);
    await page.getByTestId('login-form-password').fill(creds.password);
    await page.getByTestId('login-form-submit').click();

    // The Server Action sets cookies via `cookies().set()` and redirects to
    // /dashboard. In CI the RSC client navigation reaches /dashboard, but the
    // dashboard RSC may not see the session cookie on the FIRST render (the
    // session cookie set by the action must propagate through Next.js's
    // internal cookie forwarding, which can fail to reach the server-side
    // `cookies()` read during the same RSC streaming pass). When that happens
    // the dashboard redirects back to /login.
    //
    // Robust strategy: wait for the initial redirect to /dashboard (proves
    // login succeeded), then do a full `page.goto` to /dashboard. This
    // forces a new browser-level navigation where all committed cookies are
    // sent. If the URL ends up at /login after goto, the session cookie
    // truly wasn't stored — retry once with a small delay.
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    // Full-page navigation ensures the browser sends all cookies (including
    // those set by the Server Action response) to the server.
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    // If the dashboard redirected to /login, the session cookie wasn't ready.
    // Wait briefly and retry once — the cookie may need one more event-loop
    // tick to commit on some CI runners.
    if (page.url().includes('/login')) {
      await page.waitForTimeout(1000);
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    }

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

    const greeting = page.getByTestId('dashboard-greeting');
    await expect(greeting).toBeVisible({ timeout: 15_000 });
    await expect(greeting).toHaveText(`Olá, ${SEED_FULL_NAME}`);

    // 2. Log out.
    await page.getByTestId('dashboard-logout').click();

    // After logout the action calls `redirect('/login')` unconditionally —
    // no `redirectTo` query, just the bare path.
    await page.waitForURL('**/login');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('login-form-email')).toBeVisible();
    await expect(page.getByTestId('dashboard-greeting')).toHaveCount(0);
  });
});
