import { expect, test } from '@playwright/test';

// @auth — Google OAuth returning active user flow.
//
// This test validates that the Google button is present on the login page
// and that the button has the correct test ID and text. The full OAuth
// callback flow (where a returning user gets redirected to /dashboard) is
// covered by the integration tests for `resolveOAuthCallback`.

test.describe('@auth Google OAuth returning active user', () => {
  test('Google button is visible on the login page and has correct attributes', async ({
    page,
  }) => {
    await page.goto('/login');

    const googleButton = page.getByTestId('login-form-google-button');
    await expect(googleButton).toBeVisible();
    await expect(googleButton).toHaveText('Entrar com Google');

    // The button should be type="button" (not submit).
    await expect(googleButton).toHaveAttribute('type', 'button');
  });
});
