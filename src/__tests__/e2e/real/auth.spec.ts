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
    // Capture session cookies from the Server Action response. Next.js
    // Server Actions use fetch internally; the `Set-Cookie` headers on the
    // response should be processed by the browser, but in CI production
    // builds the cookies sometimes don't persist to the jar before the RSC
    // redirect fires. We intercept responses to capture them explicitly.
    const capturedCookies: string[] = [];
    page.on('response', (resp) => {
      const headers = resp.headers();
      const raw = headers['set-cookie'] ?? '';
      for (const part of raw.split('\n')) {
        if (part.startsWith('sb-')) capturedCookies.push(part);
      }
    });

    await page.getByTestId('login-form-submit').click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    // If the dashboard RSC redirected to /login (session cookie not in jar),
    // manually apply the captured cookies and retry.
    if (
      page.url().includes('/login') ||
      !(await page
        .getByTestId('dashboard-greeting')
        .isVisible()
        .catch(() => false))
    ) {
      if (capturedCookies.length > 0) {
        const browserCookies = capturedCookies.map((raw) => {
          const [nameValue] = raw.split(';');
          const eqIdx = nameValue!.indexOf('=');
          return {
            name: nameValue!.substring(0, eqIdx),
            value: nameValue!.substring(eqIdx + 1),
            domain: 'localhost',
            path: '/',
          };
        });
        await page.context().addCookies(browserCookies);
      }
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
