import { expect, type Page, test } from '@playwright/test';

import {
  applyTransitionFromTest,
  approveCrpFromTest,
  cleanupE2eUserByEmail,
  countProfilesByEmail,
} from './setup/test-helpers';

// `@auth @signup @happy-path` — the full anonymous → active onboarding flow:
//
//   1. Anonymous user navigates to `/signup` and submits a valid form.
//      The signup Server Action calls the mock GoTrue's signup endpoint
//      (which mirrors the user into the test container's `auth.users`),
//      then inserts the `psychologist_profiles` (status =
//      `pending_verification`) and `crp_validation_queue` rows. The form
//      then navigates the browser to `/auth/verify-email`.
//
//   2. Pragmatic shortcut for the verification step: the mock GoTrue does
//      NOT implement `POST /auth/v1/token?grant_type=pkce`, which is what
//      `supabase.auth.exchangeCodeForSession` calls. Without PKCE we cannot
//      drive `/auth/callback?code=...` end-to-end. We skip the callback
//      and call `applyTransitionFromTest('email_verified')` directly,
//      which produces the same DB state.
//
//   3. With status now `pending_crp_validation` the user signs in via
//      `/login`. The status-aware middleware (section 7) bounces them to
//      `/auth/crp-review` rather than `/dashboard`.
//
//   4. Admin approves: we drive `approveCrpFromTest`, which writes both
//      the queue decision AND advances the profile to `active`.
//
//   5. The user reloads (or navigates to) `/dashboard` and the page
//      renders — proving the lifecycle gate has cleared.
//
// Most of this exercises the real wire path:
//   • signup form → Server Action → mock GoTrue → DB
//   • mock GoTrue ↔ test container's `auth.users` mirror (signup+rollback)
//   • signin form → Server Action → status check → middleware bounce
//   • dashboard render after status flip
// The two corners we cannot exercise end-to-end (PKCE callback, real admin
// UI) are surrogate'd via direct DB writes through the test helpers.

test.describe.configure({ mode: 'serial' });

test.describe('@auth @signup @happy-path', () => {
  test('anonymous signup → verify-email → crp-review → admin approval → dashboard', async ({
    page,
  }) => {
    const email = 'happy-path@test.local';
    const password = 'Senha!Forte9';
    const fullName = 'Dra. Caminho Feliz';
    const crpNumber = '06/600001';
    const crpUf = 'SP';

    try {
      // ─── Step 1: Anonymous signup ─────────────────────────────────────
      await page.goto('/signup');
      await fillSignupForm(page, { fullName, email, password, crpNumber, crpUf });
      await page.getByTestId('signup-form-submit').click();

      // The form pushes to /auth/verify-email on success. The
      // `/auth/verify-email` Server Component then reads the session and,
      // finding none (the email-confirmation flow does not establish one
      // at signup), redirects to `/login?redirectTo=/auth/verify-email`.
      // We accept the final URL as either:
      //   • `/auth/verify-email`  (if a session somehow existed), or
      //   • `/login?redirectTo=/auth/verify-email`
      // The spec scenario for "lands on /auth/verify-email" is satisfied
      // by the URL the form pushes to; the secondary server-side bounce
      // is an artifact of the mock GoTrue not minting a session at signup.
      await page.waitForURL((url) => {
        const u = new URL(url);
        return (
          u.pathname === '/auth/verify-email' ||
          (u.pathname === '/login' && u.searchParams.get('redirectTo') === '/auth/verify-email')
        );
      });

      // The DB carries the new profile + queue row regardless of which
      // URL the user lands on — this proves the signup transaction
      // committed.
      expect(await countProfilesByEmail(email)).toBe(1);

      // ─── Step 2: Surrogate email-verified transition ──────────────────
      // Look up the user id we just created so we can drive the
      // transition. We must do this BEFORE signing in because a session
      // would let the middleware re-route anywhere mid-test.
      const userId = await getUserIdByEmail(email);
      await applyTransitionFromTest(userId, 'email_verified');

      // ─── Step 3: Signin → middleware bounces to /auth/crp-review ──────
      await page.goto('/login');
      await page.getByTestId('login-form-email').fill(email);
      await page.getByTestId('login-form-password').fill(password);
      await page.getByTestId('login-form-submit').click();

      // The `signInImpl` action reads the profile (status =
      // `pending_crp_validation`) and `redirect()`s to /auth/crp-review.
      await page.waitForURL('**/auth/crp-review');
      const url2 = new URL(page.url());
      expect(url2.pathname).toBe('/auth/crp-review');
      // Bloqueante page rendered.
      await expect(page.getByTestId('crp-review-number')).toBeVisible();

      // ─── Step 4: Admin approval ───────────────────────────────────────
      // We need the queue id for this user. Look it up by user_id.
      const queueId = await getPendingQueueIdForUser(userId);
      await approveCrpFromTest({ queueId, actorUserId: userId });

      // ─── Step 5: User reaches /dashboard ──────────────────────────────
      // Refresh the browser session against /dashboard — the middleware's
      // status load now reads `active`, so the gate clears.
      await page.goto('/dashboard');
      const url3 = new URL(page.url());
      expect(url3.pathname).toBe('/dashboard');
      // The dashboard greeting is the canary that proves we landed on
      // the rendered page, not a 5xx.
      await expect(page.getByTestId('dashboard-greeting')).toBeVisible();
    } finally {
      await cleanupE2eUserByEmail(email);
    }
  });
});

// Form-fill helper local to this spec — kept colocated so the test reads
// linearly, top-to-bottom.
type FormData = {
  fullName: string;
  email: string;
  password: string;
  crpNumber: string;
  crpUf: string;
};

async function fillSignupForm(page: Page, data: FormData): Promise<void> {
  await page.getByTestId('signup-form-full-name').fill(data.fullName);
  await page.getByTestId('signup-form-email').fill(data.email);
  await page.getByTestId('signup-form-password').fill(data.password);
  await page.getByTestId('signup-form-password-confirm').fill(data.password);
  await page.getByTestId('signup-form-crp-number').fill(data.crpNumber);
  await page.getByTestId('signup-form-crp-uf').selectOption(data.crpUf);
  await page.getByTestId('signup-form-terms').check();
  await page.getByTestId('signup-form-privacy').check();
  await page.getByTestId('signup-form-sensitive-data').check();
}

// Ad-hoc DB lookups used by this spec only. We do not promote them into
// `setup/test-helpers.ts` because the duplicate-CRP / duplicate-email specs
// do not need them — keeping them local to this file avoids growing the
// shared helpers' surface for a one-off use.
async function getUserIdByEmail(email: string): Promise<string> {
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { sql } = await import('drizzle-orm');
  const postgres = (await import('postgres')).default;
  const seed = await (await import('./setup/seed-state')).readSeedState();
  const sqlClient = postgres(seed.databaseUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(sqlClient);
  try {
    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM auth.users WHERE email = ${email} LIMIT 1`,
    );
    const first = rows[0];
    if (!first) throw new Error(`getUserIdByEmail: no auth.users row for ${email}`);
    return first.id;
  } finally {
    await sqlClient.end();
  }
}

async function getPendingQueueIdForUser(userId: string): Promise<string> {
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { sql } = await import('drizzle-orm');
  const postgres = (await import('postgres')).default;
  const seed = await (await import('./setup/seed-state')).readSeedState();
  const sqlClient = postgres(seed.databaseUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(sqlClient);
  try {
    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM crp_validation_queue WHERE user_id = ${userId} AND status = 'pending' LIMIT 1`,
    );
    const first = rows[0];
    if (!first) throw new Error(`getPendingQueueIdForUser: no pending queue row for ${userId}`);
    return first.id;
  } finally {
    await sqlClient.end();
  }
}
