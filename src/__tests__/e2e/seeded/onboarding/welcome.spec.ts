import { expect, test } from '@playwright/test';
import pgModule from 'postgres';

import { readSeedState, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @onboarding -- Welcome page (section 4).
 *
 * Covers the three contractual scenarios from
 * `onboarding-wizard/spec.md` §"Welcome screen greets the verified psychologist":
 *
 *   1. (negative-auth) an anonymous visit to /onboarding/welcome is redirected
 *      to /login?redirectTo=%2Fonboarding%2Fwelcome by the middleware;
 *   2. a seeded `active` user sees the personalized greeting + primary CTA;
 *   3. "Pular e explorar por conta própria" runs `skipOnboarding`, advancing
 *      `onboarding_step` to 'done' and navigating to /dashboard.
 *
 * The seed user's `full_name` is "Seed User" (see setup/global-setup.ts), so the
 * derived first name is "Seed".
 */

const WELCOME_PATH = '/onboarding/welcome';

test.describe('@onboarding welcome — anonymous gate (negative-auth)', () => {
  // No storageState — fully anonymous browser context. This test MUST NOT use
  // `test.use({ storageState: ... })`.

  test('anonymous /onboarding/welcome redirects to /login with redirectTo', async ({ page }) => {
    const response = await page.goto(WELCOME_PATH);

    await page.waitForURL('**/login**', { timeout: 10_000 });

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('redirectTo')).toBe(WELCOME_PATH);

    // The login form is rendered — not the welcome greeting.
    await expect(page.getByTestId('onboarding-welcome-heading')).toHaveCount(0);
    // Sanity: a redirect, not a 5xx the browser silently rendered.
    expect(response?.status()).toBeLessThan(500);
  });
});

test.describe('@onboarding welcome — seeded active user', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // The skip flow mutates the seeded profile's `onboarding_step` to 'done'.
  // Reset to 'welcome' before each test so the page renders and the assertion
  // is deterministic across retries and reused Testcontainers.
  test.beforeEach(async () => {
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      await sql`
        UPDATE public.profiles
        SET onboarding_step = 'welcome',
            updated_at      = now()
        WHERE user_id = ${seed.userId};
      `;
    } finally {
      await sql.end();
    }
  });

  test('renders the personalized greeting and the primary CTA', async ({ page }) => {
    const response = await page.goto(WELCOME_PATH);

    expect(response?.status()).toBe(200);

    const heading = page.getByTestId('onboarding-welcome-heading');
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('Olá, Seed! Tudo pronto para começar.');

    // Primary CTA links to step 1 of the wizard.
    const startBtn = page.getByTestId('onboarding-start-btn');
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toHaveText('Começar configuração (5 min)');
    await expect(startBtn).toHaveAttribute('href', '/onboarding/setup/profile');

    // Secondary skip link is present.
    await expect(page.getByTestId('onboarding-skip-link')).toBeVisible();
  });

  test('"Pular e explorar" routes to /dashboard and marks onboarding done', async ({ page }) => {
    await page.goto(WELCOME_PATH);
    await expect(page.getByTestId('onboarding-welcome-heading')).toBeVisible();

    await page.getByTestId('onboarding-skip-link').click();

    // The client leaf navigates to /dashboard after the action resolves.
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/dashboard');
    await expect(page.getByTestId('dashboard-greeting')).toBeVisible();

    // DB: the seeded profile's onboarding_step was advanced to 'done' WITHOUT
    // stamping completion (skip ≠ complete).
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      const rows = await sql`
        SELECT onboarding_step, onboarding_completed_at
        FROM public.profiles
        WHERE user_id = ${seed.userId};
      `;
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.onboarding_step).toBe('done');
      expect(row.onboarding_completed_at).toBeNull();
    } finally {
      await sql.end();
    }
  });
});
