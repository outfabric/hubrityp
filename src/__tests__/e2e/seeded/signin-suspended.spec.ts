import { expect, test } from '@playwright/test';

import { cleanupE2eUser, rejectCrpFromTest, seedE2eUserWithQueue } from './setup/test-helpers';

// `@auth @signin @suspended` — exercises the spec scenario:
//   "Login with valid credentials but a `suspended` profile lands on
//    /login?reason=suspended and never establishes a session."
//
// Flow under test:
//   1. Seed a user at `pending_crp_validation` (with a queue row).
//   2. Drive `rejectCrpFromTest` against the queue row, which writes the
//      queue rejection AND flips the profile to `suspended` — exactly the
//      `crp_rejected` transition path.
//   3. Anonymous user submits valid credentials at `/login`.
//   4. The signIn Server Action loads the profile, sees `suspended`,
//      signs the session out, and redirects to `/login?reason=suspended`.
//   5. The browser lands on `/login?reason=suspended` with NO Supabase
//      session cookie set.
//
// The reason banner copy is whatever section 4 wired into `signInImpl`'s
// terminal-status redirect; we assert on the URL search-param contract
// (which the spec pins) rather than the exact banner text (which is a UI
// concern covered by the unit test for the login page).

test.describe.configure({ mode: 'serial' });

test.describe('@auth @signin @suspended', () => {
  test('valid credentials for a suspended profile redirect to /login?reason=suspended without a session', async ({
    page,
    context,
  }) => {
    const email = 'pending@test.local';
    const password = 'Senha!Forte9';

    // Seed a fresh pending_crp_validation user + queue row. Includes a
    // mock GoTrue credentials registration so the subsequent signin can
    // resolve the email/password combination.
    const seeded = await seedE2eUserWithQueue('pending_crp_validation', {
      email,
      password,
      crpNumber: '06/900001',
      crpUf: 'SP',
    });

    try {
      // Drive CRP rejection — moves status to `suspended` and writes the
      // queue row decision. We pass the seed user as the "actor" because
      // the bootstrap-stub `auth.users` does not include a separate
      // admin row, and the FK on `decided_by` requires an existing id.
      // Production would have a real admin id; the lifecycle outcome is
      // the same.
      await rejectCrpFromTest({
        queueId: seeded.queueId,
        actorUserId: seeded.userId,
        reason: 'CRP não localizado',
      });

      // Sanity-check: ensure the page starts with NO Supabase session
      // cookies (default empty storageState already gives us this).
      const cookiesBefore = await context.cookies();
      expect(cookiesBefore.filter((c) => c.name.startsWith('sb-'))).toHaveLength(0);

      // Submit the login form with valid credentials.
      await page.goto('/login');
      await page.getByTestId('login-form-email').fill(email);
      await page.getByTestId('login-form-password').fill(password);
      await page.getByTestId('login-form-submit').click();

      // The action lands on /login?reason=suspended. Wait for the URL
      // first so any in-flight redirect chain settles, then assert.
      await page.waitForURL(/\/login\?reason=suspended/);
      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('reason')).toBe('suspended');

      // The login form must still render (we did not slip through to a
      // dashboard render that the middleware would normally bounce).
      await expect(page.getByTestId('login-form-email')).toBeVisible();

      // No Supabase session cookie was established. The action signs the
      // user out before the redirect; the cookie that supabase-js would
      // have written is cleared as part of that signOut call.
      const cookiesAfter = await context.cookies();
      const sbAuthCookies = cookiesAfter.filter(
        (c) => c.name.startsWith('sb-') && c.name.includes('auth-token'),
      );
      // Either the cookie is absent, or it is present but empty (the
      // `sb-...-auth-token=base64-...` is set to empty string on signOut).
      // We accept either to keep the assertion robust against
      // `@supabase/ssr` cookie-naming changes.
      for (const cookie of sbAuthCookies) {
        expect(cookie.value === '' || cookie.value === 'null' || cookie.value === '[]').toBe(true);
      }
    } finally {
      await cleanupE2eUser(seeded.userId);
    }
  });
});
