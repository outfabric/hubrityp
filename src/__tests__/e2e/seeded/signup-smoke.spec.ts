import { expect, test } from '@playwright/test';

// `@signup` smoke. The deeper happy-path / failure-path E2E coverage lands
// with sections 8.3-8.5 (E2E suite for full signup → verify-email → CRP
// approve → dashboard). This file pins only:
//
//   1. `/signup` is publicly reachable for an anonymous user, returns 200,
//      and renders the cadastro form with every documented data-testid.
//   2. From `/login`, an anonymous user can click the "Criar conta" link and
//      land on `/signup` (self-serve cross-link from section 5.4).
//
// Both tests inherit the project's empty default storageState so the request
// hits middleware as a fully anonymous user.

test.describe('@auth @signup smoke', () => {
  test('anonymous user reaches /signup and the form renders with every testid', async ({
    page,
  }) => {
    const response = await page.goto('/signup');

    expect(response?.status()).toBe(200);

    // Every data-testid from `specs/authentication/spec.md` "Form fields use
    // stable test ids" scenario.
    for (const id of [
      'signup-form-full-name',
      'signup-form-email',
      'signup-form-password',
      'signup-form-password-confirm',
      'signup-form-crp-number',
      'signup-form-crp-uf',
      'signup-form-terms',
      'signup-form-privacy',
      'signup-form-sensitive-data',
      'signup-form-submit',
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
  });

  test('"Criar conta" link on /login navigates to /signup', async ({ page }) => {
    await page.goto('/login');

    const link = page.getByTestId('login-form-signup-link');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/signup');

    await link.click();
    await page.waitForURL('**/signup');

    const url = new URL(page.url());
    expect(url.pathname).toBe('/signup');
    await expect(page.getByTestId('signup-form-email')).toBeVisible();
  });
});
