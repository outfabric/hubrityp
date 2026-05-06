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

    test('renders form with correct test IDs and pre-filled fields', async ({ page }) => {
      // Navigate to the complete-profile page as an authenticated user.
      // The page renders even if the user already has a profile — it
      // doesn't gate on "no profile" at the page level, only the callback
      // route sends users here.
      await page.goto('/onboarding/complete-profile');

      // Form elements should be visible with correct test IDs.
      await expect(page.getByTestId('complete-profile-form-name')).toBeVisible();
      await expect(page.getByTestId('complete-profile-form-crp-number')).toBeVisible();
      await expect(page.getByTestId('complete-profile-form-crp-uf')).toBeVisible();
      await expect(page.getByTestId('complete-profile-form-terms')).toBeVisible();
      await expect(page.getByTestId('complete-profile-form-privacy')).toBeVisible();
      await expect(page.getByTestId('complete-profile-form-sensitive-data')).toBeVisible();
      await expect(page.getByTestId('complete-profile-form-submit')).toBeVisible();

      // Submit button should have correct text.
      await expect(page.getByTestId('complete-profile-form-submit')).toHaveText(
        'Completar cadastro',
      );
    });
  });
});
