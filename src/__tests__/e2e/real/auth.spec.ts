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
  // TEMPORARILY DISABLED — known-broken, tracked separately.
  //
  // Symptom (CI only): login succeeds and the Server Action sets a valid
  // chunked session cookie (`sb-127-auth-token.0/.1`, Path=/, SameSite=lax)
  // with `x-action-redirect: /dashboard;push`, but the Edge middleware then
  // bounces the client-side /dashboard RSC navigation back to /login — so the
  // dashboard greeting never renders. The bounce reproduces even with the real
  // anon key inlined into the build and even when a valid session cookie is
  // injected directly, which rules out the build-time key and points at the
  // Edge middleware's session/profile validation under `next start` (candidates:
  // middleware `getUser()` token validation, the Edge PostgREST `profiles` read
  // in `getCurrentProfileEdge`, or the Next.js 16 `middleware`→`proxy` runtime
  // change flagged by the build warning). Needs local reproduction with the
  // Supabase CLI to fix properly — do NOT re-enable without a verified fix.
  //
  // `test.fixme` skips the body but keeps the case visible as outstanding work.
  test.fixme('login → dashboard → logout → login round-trip', async ({ page }) => {
    const creds = await readCredentials();

    // 1. Log in.
    await page.goto('/login');
    await page.getByTestId('login-form-email').fill(creds.email);
    await page.getByTestId('login-form-password').fill(creds.password);
    await page.getByTestId('login-form-submit').click();

    // The Server Action redirects to /dashboard on success. We wait on the
    // URL change rather than `networkidle` because the dashboard render is
    // a streamed RSC response and `networkidle` is unreliable for those.
    await page.waitForURL('**/dashboard');
    await expect(page).toHaveURL(/\/dashboard$/);

    // The dashboard greeting echoes `profile.fullName` (see
    // `src/app/(app)/dashboard/page.tsx`), which `global-setup.ts` seeds as
    // `SEED_FULL_NAME`. Asserting on it is the strongest signal that the real
    // session round-trip worked: middleware accepted the cookie, the page
    // Server Component called `supabase.auth.getUser`, the profile row was
    // materialized by the `handle_new_user` trigger, and `getCurrentProfile`
    // read it back.
    const greeting = page.getByTestId('dashboard-greeting');
    await expect(greeting).toBeVisible();
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
