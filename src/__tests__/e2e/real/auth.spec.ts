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

    // The Server Action sets the session cookie and redirects to /dashboard
    // via RSC. Wait for the URL change first.
    await page.waitForURL('**/dashboard');

    // Known Next.js race: the RSC streaming fetch initiated by the Server
    // Action redirect may not carry the just-set session cookie, causing the
    // dashboard RSC to call getCurrentProfile() → null → redirect('/login').
    // A reload forces a fresh navigation where the browser sends all
    // committed cookies, guaranteeing the session is visible to the server.
    await page.reload({ waitUntil: 'domcontentloaded' });
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
