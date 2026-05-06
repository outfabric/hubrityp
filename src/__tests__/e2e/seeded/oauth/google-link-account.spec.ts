import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

// @auth — Google OAuth link-account flow.
//
// Tests that the `/auth/link-account` page renders correctly with the
// password form and handles missing/invalid pendingUserId gracefully.

test.describe('@auth Google OAuth link-account flow', () => {
  test('renders password form with correct test IDs when pendingUserId is present', async ({
    page,
  }) => {
    const pendingUserId = randomUUID();
    await page.goto(`/auth/link-account?pendingUserId=${pendingUserId}`);

    // Form elements should be visible with correct test IDs.
    await expect(page.getByTestId('link-account-form-password')).toBeVisible();
    await expect(page.getByTestId('link-account-form-submit')).toBeVisible();

    // Submit button should have correct text.
    await expect(page.getByTestId('link-account-form-submit')).toHaveText('Vincular conta');
  });

  test('shows invalid request message when pendingUserId is missing', async ({ page }) => {
    await page.goto('/auth/link-account');

    // Should show "Solicitacao invalida." instead of the form.
    await expect(page.getByText('Solicitacao invalida.')).toBeVisible();
    await expect(page.getByTestId('link-account-form-password')).toHaveCount(0);
  });
});
