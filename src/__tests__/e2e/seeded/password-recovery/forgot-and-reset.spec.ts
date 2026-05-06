import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

// ---------------------------------------------------------------------------
// 7.8 — E2E: Password recovery flow (forgot + reset)
//
// The seeded e2e suite uses a mock GoTrue, so the full email delivery flow
// (inbucket -> click link -> callback exchange) cannot be tested here — that
// lives in the @auth-real suite. This test covers:
//
//   1. Forgot-password form (public): submit -> success message shown
//   2. Reset-password page without session: shows "link inválido" error
//   3. Reset-password form (with session): UI renders, password policy
//      feedback works, and submitting without a recovery session returns
//      `invalid_session`
//
// The reset-password page requires a valid session (established by the
// recovery callback). Without one, it renders an error UI instead of the
// form. Tests that exercise the form use the seeded storageState; the
// seeded session is a normal (non-recovery) session, so submitting the
// form triggers the `invalid_session` error path.
// ---------------------------------------------------------------------------

test.describe('@auth forgot-password form', () => {
  test('shows success message after submit', async ({ page }) => {
    await page.goto('/forgot-password');

    // Verify form elements are visible
    await expect(page.getByTestId('forgot-password-form-email')).toBeVisible();
    await expect(page.getByTestId('forgot-password-form-submit')).toBeVisible();

    // Fill email and submit
    await page.getByTestId('forgot-password-form-email').fill('seed@example.com');
    await page.getByTestId('forgot-password-form-submit').click();

    // Wait for success message to appear
    const successMessage = page.getByTestId('forgot-password-form-success-message');
    await expect(successMessage).toBeVisible({ timeout: 15_000 });
    await expect(successMessage).toContainText('Se este e-mail estiver cadastrado');
  });
});

test.describe('@auth reset-password page', () => {
  test('shows link-expired error when visited without a session', async ({ page }) => {
    await page.goto('/reset-password');

    const errorEl = page.getByTestId('reset-password-form-error');
    await expect(errorEl).toBeVisible();
    await expect(errorEl).toContainText('Link inválido ou expirado');
  });

  test.describe('with session', () => {
    test.use({ storageState: STORAGE_STATE_PATH });

    test('validates password policy in real-time', async ({ page }) => {
      await page.goto('/reset-password');

      const passwordInput = page.getByTestId('reset-password-form-password');
      await expect(passwordInput).toBeVisible();

      // Type a weak password — criteria should show unmet rules
      await passwordInput.fill('abc');

      // The rules list should be visible and indicate missing criteria
      const rulesList = page.locator('#reset-password-rules');
      await expect(rulesList).toBeVisible();

      // Type a strong password — all criteria should be met
      await passwordInput.fill('Str0ng!Pass99');

      // Wait for the criteria to update (the checkmarks should appear)
      // At least one rule should show the success indicator
      await expect(rulesList.locator('.text-success-700').first()).toBeVisible();
    });

    test('shows invalid_session error when submitted without recovery session', async ({
      page,
    }) => {
      await page.goto('/reset-password');

      const passwordInput = page.getByTestId('reset-password-form-password');
      const confirmInput = page.getByTestId('reset-password-form-confirm');
      const submitButton = page.getByTestId('reset-password-form-submit');

      await expect(passwordInput).toBeVisible();
      await expect(confirmInput).toBeVisible();

      const strongPassword = 'NewStr0ng!Pass99';
      await passwordInput.fill(strongPassword);
      await confirmInput.fill(strongPassword);
      await submitButton.click();

      // The seeded session is a normal session, not a recovery session.
      // The Server Action detects this and returns invalid_session.
      const errorEl = page.getByTestId('reset-password-form-error');
      await expect(errorEl).toBeVisible({ timeout: 15_000 });
      await expect(errorEl).toContainText('Sessão de recuperação inválida');
    });
  });
});
