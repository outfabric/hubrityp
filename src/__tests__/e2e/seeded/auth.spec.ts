import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from './setup/seed-state';

// Default `@auth` e2e suite: simulated cookie via storageState + a tiny
// in-process mock GoTrue. The full real-GoTrue flow lives in `@auth-real`
// (wave 3) under `e2e-auth-real/`. The three scenarios pinned here come
// straight from `specs/authentication/spec.md` — middleware gating,
// dashboard render with a session, and logout.

test.describe('@auth simulated suite', () => {
  test('anonymous /dashboard redirects to /login with redirectTo=%2Fdashboard', async ({
    page,
  }) => {
    // No storageState on this test — it inherits the project's empty
    // default, so the request hits middleware as a fully anonymous user.
    const response = await page.goto('/dashboard');

    // Playwright follows redirects by default; the final response is the
    // login page at /login. We assert two signals in parallel: the URL
    // landed on /login with the correct query, and the request actually
    // returned 200 (not, e.g., a 5xx the browser silently rendered).
    expect(response?.status()).toBe(200);

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('redirectTo')).toBe('/dashboard');

    // The login form must be rendered — not the dashboard greeting. We
    // assert against the testid contract that the login page carries.
    await expect(page.getByTestId('login-form-email')).toBeVisible();
    await expect(page.getByTestId('dashboard-greeting')).toHaveCount(0);
  });

  test.describe('with the seeded session', () => {
    test.use({ storageState: STORAGE_STATE_PATH });

    test('authenticated /dashboard renders the greeting for the seeded user', async ({ page }) => {
      const response = await page.goto('/dashboard');

      expect(response?.status()).toBe(200);
      // The dashboard server component reads the user from
      // `supabase.auth.getUser()`, which the mock GoTrue answers with the
      // seeded `seed@example.com` identity.
      const greeting = page.getByTestId('dashboard-greeting');
      await expect(greeting).toBeVisible();
      await expect(greeting).toHaveText('Olá, seed@example.com');
    });

    test('clicking logout clears the session and redirects to /login', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page.getByTestId('dashboard-greeting')).toBeVisible();

      // The logout button posts to the `signOut` Server Action, which
      // clears the session cookies and redirects to /login.
      await page.getByTestId('dashboard-logout').click();

      // After logout we land on /login with NO redirectTo — the action
      // calls `redirect('/login')` unconditionally.
      await page.waitForURL('**/login');
      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');
      expect(url.search).toBe('');

      // Sanity check: the dashboard greeting is no longer in the DOM.
      await expect(page.getByTestId('dashboard-greeting')).toHaveCount(0);
      await expect(page.getByTestId('login-form-email')).toBeVisible();
    });
  });
});
