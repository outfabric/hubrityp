import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

import { readSeedState, STORAGE_STATE_PATH } from './setup/seed-state';

// `@auth @verify-email` smoke. Section 6 of `add-account-signup-and-lifecycle`
// ships the bloqueante page + the `/auth/callback` Route Handler; section 8
// will land the full happy-path E2E (signup → verify-email → CRP review →
// active dashboard) once section 7's middleware is in place.
//
// What this file pins, pragmatically, is the section-6 surface only:
//
//   1. `/auth/verify-email` renders for an authenticated `pending_verification`
//      user — heading, email, resend button, logout button all visible.
//   2. `/auth/callback` returns 307 to `/login?reason=verification_failed`
//      when the `code` query parameter is missing. This is the only branch
//      we can exercise end-to-end without PKCE / a real GoTrue, because
//      Supabase's `exchangeCodeForSession` reads a `code-verifier` from
//      cookie storage that the seeded session does not have. Section 8 will
//      cover the success branch via a real signup round-trip.
//   3. The seeded session lets the verify-email page reach the resend
//      action — we do NOT click resend (it would hit the real `auth.resend`
//      admin call which the mock GoTrue does not stub for `signup` type),
//      but we do confirm the button is present, enabled, and labelled.
//
// We seed a `pending_verification` profile row for the seed user inline so
// the page route shell's status check resolves to render. Cleanup happens
// in `test.afterEach` so this file can run alongside the dashboard suite
// (which expects NO profile for the seed user).

// Serialise this file: every test mutates the same `psychologist_profiles`
// row (keyed by the stable seed user id), so parallel workers would race
// the seed/teardown sequence. Running serially within the file keeps the
// blast radius local; tests in other files still parallelise normally.
test.describe.configure({ mode: 'serial' });

test.describe('@auth @verify-email smoke', () => {
  // Each test seeds and cleans up its own profile row. The seed user's id
  // is stable (see `start-server.ts`); we only need to insert/remove the
  // psychologist_profiles row.
  let connectionString: string;
  let userId: string;

  test.beforeAll(async () => {
    const seed = await readSeedState();
    connectionString = seed.databaseUrl;
    userId = seed.userId;
  });

  test.afterEach(async () => {
    // The Playwright global-setup seeds the seed user with status `active`
    // so the dashboard render test in `auth.spec.ts` can pass even with the
    // section-7 status-aware middleware. Tests in this file flip the seed
    // user to `pending_verification`; the afterEach restores `active` so a
    // race against the dashboard test in another file resolves benignly
    // (worst case: dashboard test sees `active` and passes).
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

  async function seedPendingVerificationProfile(): Promise<void> {
    // Flip the seed user's row (already inserted by `globalSetup` as
    // `active`) to `pending_verification`. We do an UPDATE rather than
    // INSERT because the PK already exists.
    const sqlClient = postgres(connectionString, { max: 1, onnotice: () => {} });
    const db = drizzle(sqlClient);
    try {
      await db
        .update(psychologistProfiles)
        .set({
          status: 'pending_verification',
          statusChangedAt: new Date(),
        })
        .where(eq(psychologistProfiles.userId, userId));
    } finally {
      await sqlClient.end();
    }
  }

  test.describe('/auth/verify-email render — authenticated session', () => {
    // This sub-suite uses the seeded storageState because the page is gated
    // on an authenticated session.
    test.use({ storageState: STORAGE_STATE_PATH });

    test('renders /auth/verify-email for the authenticated pending_verification user', async ({
      page,
    }) => {
      await seedPendingVerificationProfile();

      const response = await page.goto('/auth/verify-email');

      expect(response?.status()).toBe(200);

      // Heading.
      await expect(page.getByText('Verifique seu email')).toBeVisible();
      // The seed user's email appears in the body.
      const emailNode = page.getByTestId('verify-email-address');
      await expect(emailNode).toBeVisible();
      await expect(emailNode).toHaveText('seed@example.com');
      // 24-hour note.
      await expect(page.getByText(/válido por 24 horas/i)).toBeVisible();
      // Resend button is present, enabled, and carries the correct label.
      const resendButton = page.getByTestId('verify-email-resend');
      await expect(resendButton).toBeVisible();
      await expect(resendButton).toBeEnabled();
      await expect(resendButton).toHaveText('Reenviar email de verificação');
      // Logout button.
      await expect(page.getByTestId('verify-email-logout')).toBeVisible();
    });
  });

  test.describe('/auth/callback failure paths — anonymous user', () => {
    // These tests run anonymously (default empty storageState). With an
    // authenticated session the post-callback redirect to /login would be
    // caught by middleware (`authenticated user on /login → /dashboard`) and
    // the assertion would observe the wrong final URL. Anonymous lets us
    // pin the immediate redirect target the handler produces. The seed
    // user's auth.users row stays untouched.

    test('GET /auth/callback without a code redirects to /login?reason=verification_failed', async ({
      page,
    }) => {
      // No profile seeding needed — the handler short-circuits on missing
      // `code` BEFORE calling Supabase, so the user's status is irrelevant.
      const response = await page.goto('/auth/callback');

      // Playwright follows redirects; final response is /login.
      expect(response?.status()).toBe(200);

      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('reason')).toBe('verification_failed');

      // The login form must be rendered to prove we landed on the page, not
      // a 5xx the browser silently rendered.
      await expect(page.getByTestId('login-form-email')).toBeVisible();
    });

    test('GET /auth/callback with an invalid code redirects to /login?reason=verification_failed', async ({
      page,
    }) => {
      // The mock GoTrue does not handle `POST /auth/v1/token?grant_type=pkce`
      // — Supabase's `exchangeCodeForSession` will fail (PKCE code-verifier
      // missing OR mock returns 404), and the handler's failure branch
      // catches the error and redirects to `/login?reason=verification_failed`.
      // The exact failure mode (PKCE error vs. 404 from mock) doesn't matter
      // for the contract this test pins — what matters is that any
      // unrecoverable exchange surfaces the same user-visible URL.
      const response = await page.goto('/auth/callback?code=mock-invalid-code');

      expect(response?.status()).toBe(200);

      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('reason')).toBe('verification_failed');
    });
  });
});
