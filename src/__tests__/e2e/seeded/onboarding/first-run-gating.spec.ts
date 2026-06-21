import { expect, test } from '@playwright/test';
import type pgModule from 'postgres';

import {
  ONBOARDING_PROFILE_LOCK_KEY,
  openWizardSql,
  readWizardOnboardingState,
  resetWizardUser,
  signInAsWizardUser,
} from './_wizard-user';

/**
 * @onboarding -- First-run soft-gate end-to-end (change rework-onboarding-first-run,
 * tasks 6.1 + 6.2).
 *
 * Proves the reworked first-access experience for a freshly-validated
 * psychologist (`active`, onboarding INCOMPLETE), driven by the dedicated
 * `SEED_ONBOARDING_WIZARD_USER`:
 *
 *   6.1 HAPPY PATH — the user is FUNNELED to `/onboarding/welcome` instead of
 *       the dashboard (middleware soft gate), completes profile + location, and
 *       only THEN reaches `/dashboard`. On the dashboard the activation
 *       checklist nudges, and the "configuração inicial" banner does NOT
 *       coexist with it (the banner is suppressed once onboarding is complete —
 *       middleware-gating + onboarding-checklist specs).
 *
 *   6.2 SKIP PATH — "Pular e explorar" opens the soft gate (`onboarding_step`
 *       → 'done' without a completion stamp) and lands the user on `/dashboard`
 *       with the checklist still nudging and NO banner.
 *
 * Both share the dedicated wizard user's `onboarding_step` row with the other
 * onboarding specs under `fullyParallel`, so each test holds the cross-worker
 * advisory lock for its DB-mutating + navigation section.
 */

test.describe('@onboarding first-run soft gate', () => {
  let lockSql: ReturnType<typeof pgModule> | null = null;

  test.beforeEach(async ({ context, request }) => {
    lockSql = await openWizardSql();
    await lockSql`SELECT pg_advisory_lock(${ONBOARDING_PROFILE_LOCK_KEY})`;
    await resetWizardUser(lockSql);
    await signInAsWizardUser(context, request);
  });

  test.afterEach(async () => {
    if (lockSql) {
      await lockSql`SELECT pg_advisory_unlock(${ONBOARDING_PROFILE_LOCK_KEY})`;
      await lockSql.end();
      lockSql = null;
    }
  });

  // ---- 6.1 happy path ------------------------------------------------------
  test('routes an incomplete user from /dashboard to the wizard, then to /dashboard after profile+location, with the checklist nudging and NO banner', async ({
    page,
  }) => {
    const sql = lockSql!;

    // The soft gate funnels an active-but-incomplete user away from the app
    // shell: requesting /dashboard lands on /onboarding/welcome, never the
    // dashboard.
    await page.goto('/dashboard');
    await page.waitForURL('**/onboarding/welcome', { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/onboarding/welcome');
    await expect(page.getByTestId('onboarding-welcome-heading')).toBeVisible();

    // Start the wizard from the welcome CTA.
    await page.getByTestId('onboarding-start-btn').click();
    await page.waitForURL('**/onboarding/setup/profile', { timeout: 10_000 });

    // Step 1 — profile (confirms the pre-filled display name).
    await expect(page.getByTestId('setup-step-heading')).toHaveText('Sobre você');
    await page.getByTestId('step-profile-display-name').fill('Dra. Primeiro Acesso');
    await page.getByTestId('step-profile-submit').click();
    await page.waitForURL('**/onboarding/setup/location', { timeout: 10_000 });

    // Step 2 — location. Completing profile + location satisfies the MVP
    // completion bar (patients is optional).
    await expect(page.getByTestId('setup-step-heading')).toHaveText('Local e agenda');
    await page.getByTestId('step-location-name').fill('Consultório Primeiro Acesso');
    await page.getByTestId('step-location-submit').click();
    await page.waitForURL('**/onboarding/setup/patients', { timeout: 10_000 });

    // Skip the optional patients step. This advances `onboarding_step` to the
    // terminal `done`, which satisfies the soft gate — so the wizard's own
    // `done` route is bounced to `/dashboard` by the middleware and the user
    // reaches the dashboard for the FIRST time (profile + location done).
    await expect(page.getByTestId('setup-step-heading')).toHaveText('Importe pacientes');
    await page.getByTestId('step-patients-skip').click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe('/dashboard');
    await expect(page.getByTestId('dashboard-greeting')).toBeVisible();

    // The activation checklist still nudges on the dashboard (it tracks
    // activation beyond the wizard's profile+location bar).
    await expect(page.getByTestId('onboarding-checklist-card')).toBeVisible();

    // The "configuração inicial" banner does NOT coexist with the checklist:
    // onboarding is complete (soft gate), so the layout suppresses it.
    await expect(page.getByTestId('unfinished-setup-banner')).toHaveCount(0);

    // DB: cursor terminal (the soft gate is satisfied by `onboarding_step`).
    const state = await readWizardOnboardingState(sql);
    expect(state.onboardingStep).toBe('done');
  });

  // ---- 6.2 skip path -------------------------------------------------------
  test('"Pular e explorar" opens the soft gate to /dashboard with the checklist nudging and NO banner', async ({
    page,
  }) => {
    const sql = lockSql!;

    // Part 1 — prove the soft gate FUNNELS an active-but-incomplete user away
    // from the app shell: requesting /dashboard lands on /onboarding/welcome via
    // the middleware 302, never the dashboard.
    await page.goto('/dashboard');
    await page.waitForURL('**/onboarding/welcome', { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe('/onboarding/welcome');
    await expect(page.getByTestId('onboarding-welcome-heading')).toBeVisible();

    // Part 2 — exercise the skip. We re-enter the welcome screen with a direct
    // navigation (instead of clicking from the redirect-arrival document) so the
    // skip control's `skipOnboarding` Server Action runs against a fully
    // established session: under the mock-GoTrue harness a Server Action fired on
    // the FIRST interaction after a soft-gate redirect can have its server-side
    // `getUser()` resolve before the dedicated-user session cookie settles,
    // returning `unauthenticated` so the action no-ops and `router.push` is
    // skipped (a harness artifact, not a product bug — production uses real
    // Supabase sessions, and the funnel itself is asserted in Part 1 and by the
    // happy-path test above). The direct `goto` mirrors the green
    // `welcome.spec.ts` skip flow.
    await page.goto('/onboarding/welcome');
    await expect(page.getByTestId('onboarding-welcome-heading')).toBeVisible();

    // Skip-and-explore opens the soft gate. Drive the click together with the
    // action's POST so the `onboarding_step='done'` write is durable before the
    // client redirect to /dashboard clears the gate (instead of looping back).
    const skipLink = page.getByTestId('onboarding-skip-link');
    await expect(skipLink).toBeEnabled();
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/onboarding/welcome') &&
          response.request().method() === 'POST' &&
          response.request().headers()['next-action'] !== undefined,
        { timeout: 15_000 },
      ),
      skipLink.click(),
    ]);
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe('/dashboard');
    await expect(page.getByTestId('dashboard-greeting')).toBeVisible();

    // Checklist still nudges (activation is incomplete after a skip)…
    await expect(page.getByTestId('onboarding-checklist-card')).toBeVisible();
    // …but the banner does NOT coexist with it: a skip advances onboarding_step
    // to 'done', which satisfies the soft gate and suppresses the banner.
    await expect(page.getByTestId('unfinished-setup-banner')).toHaveCount(0);

    // DB: skip advanced the cursor to 'done' WITHOUT stamping completion.
    const state = await readWizardOnboardingState(sql);
    expect(state.onboardingStep).toBe('done');
    expect(state.onboardingCompletedAt).toBeNull();
  });
});
