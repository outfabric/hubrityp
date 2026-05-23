import { expect, test } from '@playwright/test';

import { SEED_PATIENTS } from '../setup/seed-state';

/**
 * @middleware -- Negative-auth test for app routes.
 *
 * Verifies that unauthenticated navigation to /pacientes/[id]/prontuario
 * redirects to /login with a redirectTo query parameter. This validates that
 * the middleware's classifyPath() correctly gates the prontuario route under
 * the 'app' PathClass (via the /pacientes prefix).
 *
 * NO storageState — the browser is completely anonymous.
 * This test MUST NOT use `test.use({ storageState: ... })`.
 */

test.describe('@middleware prontuario auth gate (negative-auth)', () => {
  // No storageState — unauthenticated browser context

  test('unauthenticated request to /pacientes/[id]/prontuario redirects to /login', async ({
    page,
  }) => {
    const patientId = SEED_PATIENTS.activeWithPhone.id;
    const targetPath = `/pacientes/${patientId}/prontuario`;

    // Navigate to the prontuario page without any auth cookies
    const response = await page.goto(targetPath);

    // The middleware should redirect to /login (302 or equivalent client redirect)
    // Wait for the URL to settle on /login
    await page.waitForURL('**/login**', { timeout: 10_000 });

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');

    // The redirectTo query parameter should preserve the original destination
    // so the user is redirected back after login
    const redirectTo = url.searchParams.get('redirectTo');
    expect(redirectTo).toBe(targetPath);

    // Response should not be an error (it's a redirect, not a 500)
    expect(response?.status()).toBeLessThan(500);
  });

  test('unauthenticated request to /pacientes/[id]/prontuario/evolucoes redirects to /login', async ({
    page,
  }) => {
    const patientId = SEED_PATIENTS.activeWithPhone.id;
    const targetPath = `/pacientes/${patientId}/prontuario/evolucoes`;

    await page.goto(targetPath);

    await page.waitForURL('**/login**', { timeout: 10_000 });

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('redirectTo')).toBe(targetPath);
  });

  test('unauthenticated request to /pacientes/[id]/prontuario/evolucoes/nova redirects to /login', async ({
    page,
  }) => {
    const patientId = SEED_PATIENTS.activeWithPhone.id;
    const targetPath = `/pacientes/${patientId}/prontuario/evolucoes/nova`;

    await page.goto(targetPath);

    await page.waitForURL('**/login**', { timeout: 10_000 });

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('redirectTo')).toBe(targetPath);
  });

  test('unauthenticated request to /sessao/[id]/video redirects to /login', async ({ page }) => {
    const targetPath = '/sessao/00000000-0000-4000-8000-000000000099/video';

    await page.goto(targetPath);

    await page.waitForURL('**/login**', { timeout: 10_000 });

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('redirectTo')).toBe(targetPath);
  });
});
