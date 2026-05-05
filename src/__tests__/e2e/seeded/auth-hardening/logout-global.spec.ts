import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

// ---------------------------------------------------------------------------
// 6.12 — E2E: Global logout
//
// Two browser pages share the same session. Logging out on page A causes
// page B to be redirected to /login on its next navigation/request.
//
// This test uses the seeded storageState for both pages. After logout on A,
// B's next request hits the middleware, which calls `getUser()` against the
// mock GoTrue. Since the mock's logout is a simple 204 (no server-side
// revocation), the mock still accepts the token. In a real Supabase setup,
// `scope: 'global'` would revoke all sessions server-side.
//
// For the E2E mock scenario, we verify the client-side contract:
// - Page A logs out and lands on /login
// - Page B, on its next navigation, lands on /login (because the cookies
//   were cleared by the signOut Server Action via `setAll`)
// ---------------------------------------------------------------------------

test.describe('@auth global logout', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('logout on page A causes page B to redirect to /login on next request', async ({
    browser,
  }) => {
    // Create a shared browser context with the seeded session
    const context = await browser.newContext({
      storageState: STORAGE_STATE_PATH,
    });

    const pageA = await context.newPage();
    const pageB = await context.newPage();

    // Both pages access the dashboard successfully
    await pageA.goto('/dashboard');
    await expect(pageA.getByTestId('dashboard-greeting')).toBeVisible();

    await pageB.goto('/dashboard');
    await expect(pageB.getByTestId('dashboard-greeting')).toBeVisible();

    // Logout on page A
    await pageA.getByTestId('dashboard-logout').click();
    await pageA.waitForURL('**/login');
    expect(new URL(pageA.url()).pathname).toBe('/login');

    // Page B: navigate to dashboard — should be redirected to /login
    // because the session cookies were cleared when page A logged out
    // (the Server Action clears cookies via the response headers, which
    // the browser applies to the shared context).
    await pageB.goto('/dashboard');
    await pageB.waitForURL('**/login**', { timeout: 10_000 });
    expect(new URL(pageB.url()).pathname).toBe('/login');

    await context.close();
  });
});
