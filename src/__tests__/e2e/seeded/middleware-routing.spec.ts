import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { type AccountStatus } from '@/modules/account-lifecycle';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

import { readSeedState, STORAGE_STATE_PATH } from './setup/seed-state';

// `@auth @middleware` end-to-end smoke for the section-7 status-aware root
// middleware. Sources of truth:
//   • `specs/authentication/spec.md` Requirement "Middleware enforces auth
//     gating for `(app)` routes".
//   • `specs/account-lifecycle/spec.md` Requirement "Status drives access
//     to authenticated areas".
//
// What this file pins, end-to-end (browser → middleware → page render):
//
//   1. Anonymous `/dashboard` lands on `/login?redirectTo=%2Fdashboard`.
//   2. Authenticated seed user with `pending_verification` lands on
//      `/auth/verify-email` when they hit `/dashboard`.
//   3. Authenticated seed user with `pending_crp_validation` lands on
//      `/auth/crp-review` when they hit `/dashboard`.
//   4. Authenticated seed user with `active` bounces from `/login` to
//      `/dashboard`.
//
// The full status × path matrix lives in the integration test
// (`middleware-status.int.test.ts`) — this file only proves the contract
// holds end-to-end through the production-built Next.js server with the
// real cookie/session/middleware pipeline.

// Serialise this file: each test mutates the same `psychologist_profiles`
// row (keyed by the stable seed user id). Within-file parallelism would
// race the mutation order. Cross-file races (e.g. a parallel `auth.spec.ts`
// run reading the row mid-mutation) are mitigated by the afterEach
// restoring `active` — the dashboard test's worst-case race outcome is to
// observe a transient non-active status and fail; in practice the mutation
// window is sub-millisecond so the flake rate is negligible.
test.describe.configure({ mode: 'serial' });

test.describe('@auth @middleware status-aware routing', () => {
  let connectionString: string;
  let userId: string;

  test.beforeAll(async () => {
    const seed = await readSeedState();
    connectionString = seed.databaseUrl;
    userId = seed.userId;
  });

  test.afterEach(async () => {
    // Restore the seed user to `active` so other spec files (notably
    // `auth.spec.ts`'s dashboard render) keep working. The DELETE-then-
    // UPDATE pattern also works, but UPDATE is cheaper and avoids the
    // (crp_number, crp_uf) UNIQUE re-collision on subsequent inserts.
    const sqlClient = postgres(connectionString, { max: 1, onnotice: () => {} });
    const db = drizzle(sqlClient);
    try {
      await db
        .update(psychologistProfiles)
        .set({ status: 'active', statusChangedAt: new Date() })
        .where(eq(psychologistProfiles.userId, userId));
    } finally {
      await sqlClient.end();
    }
  });

  async function setStatus(status: AccountStatus): Promise<void> {
    const sqlClient = postgres(connectionString, { max: 1, onnotice: () => {} });
    const db = drizzle(sqlClient);
    try {
      await db
        .update(psychologistProfiles)
        .set({ status, statusChangedAt: new Date() })
        .where(eq(psychologistProfiles.userId, userId));
    } finally {
      await sqlClient.end();
    }
  }

  // ─── Anonymous gating ───────────────────────────────────────────────
  test('anonymous /dashboard lands on /login with redirectTo=%2Fdashboard', async ({ page }) => {
    // No storageState — fully anonymous request.
    const response = await page.goto('/dashboard');

    expect(response?.status()).toBe(200);

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('redirectTo')).toBe('/dashboard');
    await expect(page.getByTestId('login-form-email')).toBeVisible();
  });

  // ─── Authenticated × status × path ──────────────────────────────────
  test.describe('with the seeded session', () => {
    test.use({ storageState: STORAGE_STATE_PATH });

    test('pending_verification user visiting /dashboard lands on /auth/verify-email', async ({
      page,
    }) => {
      await setStatus('pending_verification');

      const response = await page.goto('/dashboard');

      // Playwright follows redirects; the final response is the bloqueante
      // page. We assert (a) URL landed on /auth/verify-email, (b) the page
      // actually rendered (200, not a 5xx surfaced as 200 by some CDN).
      expect(response?.status()).toBe(200);

      const url = new URL(page.url());
      expect(url.pathname).toBe('/auth/verify-email');

      // Bloqueante content rendered — the email body should be visible.
      await expect(page.getByTestId('verify-email-address')).toBeVisible();
      // Dashboard greeting must NOT be in the DOM.
      await expect(page.getByTestId('dashboard-greeting')).toHaveCount(0);
    });

    test('pending_crp_validation user visiting /dashboard lands on /auth/crp-review', async ({
      page,
    }) => {
      await setStatus('pending_crp_validation');

      const response = await page.goto('/dashboard');

      expect(response?.status()).toBe(200);

      const url = new URL(page.url());
      expect(url.pathname).toBe('/auth/crp-review');

      // CRP review page rendered — the CRP number block should be visible.
      await expect(page.getByTestId('crp-review-number')).toBeVisible();
      await expect(page.getByTestId('dashboard-greeting')).toHaveCount(0);
    });

    test('active user visiting /login bounces to /dashboard', async ({ page }) => {
      await setStatus('active');

      const response = await page.goto('/login');

      expect(response?.status()).toBe(200);

      const url = new URL(page.url());
      expect(url.pathname).toBe('/dashboard');

      // Dashboard greeting MUST be visible — proves the bounce landed on
      // a fully-rendered page, not a 5xx.
      await expect(page.getByTestId('dashboard-greeting')).toBeVisible();
    });
  });
});
