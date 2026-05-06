import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { setupGoogleOAuthStub } from '../_shared/google-oauth-stub';
import { STORAGE_STATE_PATH } from '../setup/seed-state';

// @auth — Google OAuth first-time sign-in flow.
//
// Tests two scenarios:
//   1. Google button is visible on the login page with the correct test ID.
//   2. Seeded user (who already has a profile) is redirected to /dashboard
//      when visiting /onboarding/complete-profile.
//   3. A new OAuth user (no profile) goes through the Google button flow
//      and lands on /onboarding/complete-profile with the form rendered.

test.describe('@auth Google OAuth first-time sign-in', () => {
  test('login page shows Google button with correct test ID', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-form-email')).toBeVisible();

    const googleButton = page.getByTestId('login-form-google-button');
    await expect(googleButton).toBeVisible();
    await expect(googleButton).toHaveText('Entrar com Google');
  });

  test.describe('complete-profile page', () => {
    test.use({ storageState: STORAGE_STATE_PATH });

    test('redirects to dashboard when user already has a profile', async ({ page }) => {
      await page.goto('/onboarding/complete-profile');

      await page.waitForURL('**/dashboard');
      await expect(page.getByTestId('dashboard-greeting')).toBeVisible();
    });
  });

  test('renders form with correct test IDs for a new OAuth user', async ({ page }) => {
    const oauthUserId = randomUUID();
    const oauthEmail = `oauth-${oauthUserId.slice(0, 8)}@example.com`;
    const oauthName = 'Maria Oliveira';

    const stub = await setupGoogleOAuthStub(page, {
      email: oauthEmail,
      name: oauthName,
      providerUserId: `google-${oauthUserId}`,
      userId: oauthUserId,
      profile: null,
    });

    try {
      await page.goto('/login');
      await page.getByTestId('login-form-google-button').click();

      // The stub intercepts Google navigation → callback exchanges code →
      // resolveOAuthCallback finds no profile → redirect to complete-profile.
      await page.waitForURL('**/onboarding/complete-profile', { timeout: 15_000 });

      // Form elements should be visible with correct test IDs.
      await expect(page.getByTestId('complete-profile-form-name')).toBeVisible();
      await expect(page.getByTestId('complete-profile-form-crp-number')).toBeVisible();
      await expect(page.getByTestId('complete-profile-form-crp-uf')).toBeVisible();
      await expect(page.getByTestId('complete-profile-form-terms')).toBeVisible();
      await expect(page.getByTestId('complete-profile-form-privacy')).toBeVisible();
      await expect(page.getByTestId('complete-profile-form-sensitive-data')).toBeVisible();
      await expect(page.getByTestId('complete-profile-form-submit')).toBeVisible();

      // Name should be pre-filled from OAuth user_metadata.full_name.
      await expect(page.getByTestId('complete-profile-form-name')).toHaveValue(oauthName);

      // Submit button should have correct text.
      await expect(page.getByTestId('complete-profile-form-submit')).toHaveText(
        'Completar cadastro',
      );
    } finally {
      await stub.teardown();
    }
  });
});
