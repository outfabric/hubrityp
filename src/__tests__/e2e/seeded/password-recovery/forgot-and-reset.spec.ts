import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// 7.8 — E2E: Password recovery flow (forgot + reset)
//
// The seeded e2e suite uses a mock GoTrue, so the full email delivery flow
// (inbucket -> click link -> callback exchange) cannot be tested here — that
// lives in the @auth-real suite. This test covers:
//
//   1. Forgot-password form: submit -> success message shown
//   2. Reset-password form: UI renders, password policy feedback works
//
// The reset-password page is accessed without a session (unauthenticated
// users pass through auth paths). The form renders correctly; when submitted
// without a valid recovery session, the Server Action returns
// `invalid_session` — which the form renders as an error message.
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

test.describe('@auth reset-password form', () => {
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

  test('shows invalid_session error when submitted without recovery session', async ({ page }) => {
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

    // Without a recovery session, the Server Action returns invalid_session
    // and the form displays the error message.
    const errorEl = page.getByTestId('reset-password-form-error');
    await expect(errorEl).toBeVisible({ timeout: 15_000 });
    await expect(errorEl).toContainText('Sessão de recuperação inválida');
  });
});
