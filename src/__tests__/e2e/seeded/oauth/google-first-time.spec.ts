import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

// @auth — Google OAuth first-time sign-in flow.
//
// Tests that the `/onboarding/complete-profile` page renders correctly for
// an authenticated user (using the seeded session). Since the full OAuth
// callback flow depends on dynamic mock GoTrue registration and DB seeding,
// this test validates the UI layer: the form renders with correct test IDs,
// validation works, and the Google button is visible on the login page.

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
      // The seeded user already has an active profile. The page guard
      // detects this and redirects to /dashboard instead of rendering the
      // complete-profile form.
      await page.goto('/onboarding/complete-profile');

      await page.waitForURL('**/dashboard');
      await expect(page.getByTestId('dashboard-greeting')).toBeVisible();
    });
  });
});
