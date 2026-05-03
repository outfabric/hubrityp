import { expect, type Page, test } from '@playwright/test';

import {
  cleanupE2eUser,
  cleanupE2eUserByEmail,
  countAuthUsersByEmail,
  countProfilesByCrp,
  countProfilesByEmail,
  seedE2eUser,
} from './setup/test-helpers';

// `@auth @signup @duplicates` — exercises the rejection paths from the
// signup spec ("email_already_registered", "crp_already_registered"):
//
//   1. Submitting with an email that already exists in `auth.users` produces
//      the typed `email_already_registered` error in the email field AND the
//      form-level banner; no new `psychologist_profiles` row is created.
//   2. Submitting with a CRP that already exists produces the typed
//      `crp_already_registered` error; no new profile or auth.users row is
//      created (compensating delete already covered, but the pre-flight
//      check actually short-circuits BEFORE any auth.users row is created).
//   3. Each rejection path is followed by a successful retry with a fresh
//      email/CRP, proving the form's error state is recoverable.
//
// These tests run anonymously (default empty storageState) so the request
// hits middleware as a fully-anonymous user and the signup page renders.
//
// We rely on the mock GoTrue's `POST /auth/v1/signup` mirroring the user
// into the test container's `auth.users` stub — see
// `src/__tests__/e2e/seeded/setup/mock-gotrue.ts`. That mirror lets the FK
// from `psychologist_profiles.user_id` resolve when the Server Action's
// post-signup transaction commits.

// Serialise this file so the seeded `dup-active` users do not race each
// other across parallel workers — both tests rely on the same DB state
// (a pre-existing active user with a known email/CRP).
test.describe.configure({ mode: 'serial' });

test.describe('@auth @signup @duplicates', () => {
  test('duplicate email is rejected, no profile created, retry with fresh email succeeds', async ({
    page,
  }) => {
    // Seed an active user that owns the email we are about to attempt.
    const dup = await seedE2eUser('active', {
      email: 'dup-email@test.local',
      crpNumber: '06/700001',
      crpUf: 'SP',
    });

    try {
      // Anonymous user attempts to sign up with the duplicate email but a
      // fresh CRP. The signup Server Action's pre-flight CRP check passes
      // (CRP is unique), so the action proceeds to call Supabase signUp,
      // which the mock answers with 422 "User already registered".
      await page.goto('/signup');
      await fillSignupForm(page, {
        fullName: 'Outro Psicólogo',
        email: 'dup-email@test.local',
        password: 'Senha!Forte9',
        crpNumber: '06/700002',
        crpUf: 'SP',
      });
      await page.getByTestId('signup-form-submit').click();

      // Wait for the form-level error banner. The submit handler calls
      // setError on the email field AND sets the banner — both must render.
      const banner = page.getByTestId('signup-form-error');
      await expect(banner).toBeVisible();
      await expect(banner).toHaveText('Este email já está cadastrado.');

      // The email field carries the inline server error too.
      const emailError = page.locator('#signup-email-error');
      await expect(emailError).toBeVisible();
      await expect(emailError).toHaveText('Este email já está cadastrado.');

      // No new profile row was created for this email — only the seeded
      // active user's row exists. That row's email is `dup-email@test.local`.
      // Asserting count === 1 (the seeded one) proves the duplicate attempt
      // did NOT create a second.
      expect(await countProfilesByEmail('dup-email@test.local')).toBe(1);

      // Retry with a fresh email + same fresh CRP. Submission now goes
      // through; the mock signup creates a new auth.users row, the action
      // inserts the profile + queue rows, and the action redirects to
      // `/auth/verify-email`.
      await page.getByTestId('signup-form-email').fill('fresh@test.local');
      await page.getByTestId('signup-form-submit').click();

      await page.waitForURL('**/auth/verify-email');
      const url = new URL(page.url());
      expect(url.pathname).toBe('/auth/verify-email');

      // The newly-created psychologist profile row is visible under the
      // fresh email — proving the retry path actually persisted.
      expect(await countProfilesByEmail('fresh@test.local')).toBe(1);
    } finally {
      // Best-effort cleanup. Find the fresh user and clean it up too — we
      // don't have its userId in scope, so we look it up by email.
      await cleanupE2eUser(dup.userId);
      await cleanupE2eUserByEmail('fresh@test.local');
    }
  });

  test('duplicate CRP is rejected, no profile or auth user created, retry with fresh CRP succeeds', async ({
    page,
  }) => {
    // Seed an active user that owns the CRP we are about to attempt. Email
    // is unique so the pre-flight CRP check (which runs BEFORE Supabase
    // signUp) is what fires.
    const dup = await seedE2eUser('active', {
      email: 'dup-crp@test.local',
      crpNumber: '06/800001',
      crpUf: 'SP',
    });
    const newEmail = 'unique-crp-attempt@test.local';

    try {
      await page.goto('/signup');
      await fillSignupForm(page, {
        fullName: 'Psicólogo CRP Duplicado',
        email: newEmail,
        password: 'Senha!Forte9',
        crpNumber: '06/800001',
        crpUf: 'SP',
      });
      await page.getByTestId('signup-form-submit').click();

      const banner = page.getByTestId('signup-form-error');
      await expect(banner).toBeVisible();
      await expect(banner).toHaveText('Este CRP já está cadastrado.');

      // The crpNumber field carries the inline server error.
      const crpError = page.locator('#signup-crp-number-error');
      await expect(crpError).toBeVisible();
      await expect(crpError).toHaveText('Este CRP já está cadastrado.');

      // No new psychologist_profiles row for the duplicate (crp_number, uf)
      // beyond the seeded active user.
      expect(await countProfilesByCrp('06/800001', 'SP')).toBe(1);
      // The pre-flight CRP check short-circuits BEFORE the Supabase signUp
      // call, so the auth.users row was never created either.
      expect(await countAuthUsersByEmail(newEmail)).toBe(0);

      // Retry with a fresh CRP succeeds. Same email, same password, just a
      // different CRP value.
      await page.getByTestId('signup-form-crp-number').fill('06/800999');
      await page.getByTestId('signup-form-submit').click();

      await page.waitForURL('**/auth/verify-email');
      const url = new URL(page.url());
      expect(url.pathname).toBe('/auth/verify-email');

      expect(await countProfilesByCrp('06/800999', 'SP')).toBe(1);
    } finally {
      await cleanupE2eUser(dup.userId);
      await cleanupE2eUserByEmail(newEmail);
    }
  });
});

type FormData = {
  fullName: string;
  email: string;
  password: string;
  crpNumber: string;
  crpUf: string;
};

// Fills every field of the signup form using the canonical data-testids.
// We split this out so the duplicate-email and duplicate-CRP tests do not
// duplicate the form-filling boilerplate.
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
