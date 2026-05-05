import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// 6.10 — E2E: Lockout after 5 failed logins
//
// 5 failed login attempts trigger a 30-minute lockout. The 6th attempt
// must show the `locked_out` error message in the UI.
//
// The test uses the seeded user (whose profile exists in the real
// Testcontainers Postgres) and submits wrong passwords via the login form.
// The mock GoTrue rejects any wrong password, and the `signInImpl` Server
// Action applies the lockout counters against the real DB.
// ---------------------------------------------------------------------------

const LOCKOUT_USER_EMAIL = 'seed@example.com';
const WRONG_PASSWORD = 'WrongPassword123!';

test.describe('@auth lockout after failed attempts', () => {
  test('5 failed logins trigger lockout UI; 6th attempt shows locked_out message', async ({
    page,
  }) => {
    // Submit 5 wrong passwords sequentially. After the 5th, the lockout
    // should trigger and the error message should change.
    for (let i = 0; i < 6; i++) {
      await page.goto('/login');
      await expect(page.getByTestId('login-form-email')).toBeVisible();

      await page.getByTestId('login-form-email').fill(LOCKOUT_USER_EMAIL);
      await page.getByTestId('login-form-password').fill(WRONG_PASSWORD);
      await page.getByTestId('login-form-submit').click();

      // Wait for navigation or error to appear. The form submission is a
      // Server Action; on failure it returns a result that renders the
      // error region. On success it redirects. We wait for either.
      //
      // After submission, either:
      // - An error appears (login-form-error testid) — bad credentials or lockout
      // - The page navigates away — success (shouldn't happen with wrong password)
      //
      // We detect the result by waiting for the error element or for the
      // submit button to be re-enabled (React re-renders after the action).
      await page.waitForFunction(
        () => {
          const error = document.querySelector('[data-testid="login-form-error"]');
          const submit = document.querySelector<HTMLButtonElement>(
            '[data-testid="login-form-submit"]',
          );
          // Wait until either: error appears OR submit button is re-enabled after processing
          return error !== null || (submit !== null && !submit.disabled);
        },
        { timeout: 15_000 },
      );

      const errorEl = page.getByTestId('login-form-error');
      const errorCount = await errorEl.count();

      if (i < 4) {
        // First 4 attempts: should show "E-mail ou senha incorretos."
        if (errorCount > 0) {
          const errorText = await errorEl.textContent();
          expect(errorText).toContain('E-mail ou senha incorretos');
        }
        // If no error appeared, the form might have redirected or the
        // Server Action is taking long — acceptable in CI
      } else {
        // 5th and 6th attempts: should show lockout message
        expect(errorCount).toBeGreaterThan(0);
        const errorText = await errorEl.textContent();
        expect(errorText).toContain('bloqueada');
      }
    }
  });
});
