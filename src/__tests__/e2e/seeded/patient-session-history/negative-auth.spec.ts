/**
 * Patient session-history — negative-auth E2E (PRD §13, section 10.2).
 *
 * Proves the gated `/pacientes/:id` surface (which hosts the session-history tab)
 * is NOT reachable without a session: an anonymous browser context is redirected
 * to `/login` by the Edge middleware before any patient or session data is ever
 * fetched or rendered. This is the negative test that pairs with the
 * happy-path coverage in `session-history.spec.ts`.
 */

import { expect, test } from '@playwright/test';

import { SEED_SESSION_HISTORY_USER } from '../setup/seed-state';

const PATIENT_ID = SEED_SESSION_HISTORY_USER.patients.withHistory.id;

test.describe('@patients patient session history (anonymous)', () => {
  // No `storageState` and no `signInAsDedicatedUser` — a fully anonymous context.
  test('anonymous /pacientes/:id redirects to /login', async ({ page }) => {
    await page.goto(`/pacientes/${PATIENT_ID}`);

    await page.waitForURL('**/login**', { timeout: 10_000 });

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    // The middleware preserves the original destination for the post-login return.
    expect(url.searchParams.get('redirectTo')).toBe(`/pacientes/${PATIENT_ID}`);
  });
});
