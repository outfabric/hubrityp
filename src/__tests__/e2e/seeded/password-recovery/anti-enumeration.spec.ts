import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// 7.9 — E2E: Anti-enumeration on forgot-password
//
// The forgot-password page MUST show the same success copy for both existing
// and non-existing emails, so an attacker cannot enumerate valid accounts
// through the UI response.
// ---------------------------------------------------------------------------

const SUCCESS_TEXT = 'Se este e-mail estiver cadastrado';

test.describe('@auth password recovery anti-enumeration', () => {
  test('shows same success message for existing email', async ({ page }) => {
    await page.goto('/forgot-password');

    await page.getByTestId('forgot-password-form-email').fill('seed@example.com');
    await page.getByTestId('forgot-password-form-submit').click();

    const successMessage = page.getByTestId('forgot-password-form-success-message');
    await expect(successMessage).toBeVisible({ timeout: 15_000 });

    const text = await successMessage.textContent();
    expect(text).toContain(SUCCESS_TEXT);
  });

  test('shows same success message for non-existing email', async ({ page }) => {
    await page.goto('/forgot-password');

    await page.getByTestId('forgot-password-form-email').fill('nonexistent@example.com');
    await page.getByTestId('forgot-password-form-submit').click();

    const successMessage = page.getByTestId('forgot-password-form-success-message');
    await expect(successMessage).toBeVisible({ timeout: 15_000 });

    const text = await successMessage.textContent();
    expect(text).toContain(SUCCESS_TEXT);
  });
});
