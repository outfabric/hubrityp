import { expect, type Page, test } from '@playwright/test';
import type pgModule from 'postgres';

import {
  ONBOARDING_PROFILE_LOCK_KEY,
  openWizardSql,
  readWizardOnboardingState,
  resetWizardUser,
  signInAsWizardUser,
} from './_wizard-user';

/**
 * @onboarding -- End-to-end wizard flow (onboarding-wizard spec).
 *
 * Walks the dedicated `active` + onboarding-INCOMPLETE psychologist
 * (`SEED_ONBOARDING_WIZARD_USER`) through the full four-step MVP setup wizard
 * and proves the contractual behaviours from `onboarding-wizard/spec.md`:
 *
 *   - the four navigable steps render in order (`profile` → `location` →
 *     `patients` → `done`), each with a "Passo N de 4" progress indicator;
 *   - the wizard is RESUMABLE: after a full-page reload mid-flow the user
 *     lands back on their saved step (resume derives from the persisted
 *     `profiles.onboarding_step` + real domain data, never from client state);
 *   - skipping step 3 advances `onboarding_step` to the terminal `done`, which
 *     satisfies the soft gate, so the wizard's own `done` route is bounced to
 *     `/dashboard` by the middleware (the summary page is gated out) and the
 *     unfinished-setup banner is hidden;
 *   - steps that COLLECT input (1–3) never mention the post-MVP modules
 *     (WhatsApp, Receita Saúde, PIX/cobrança, recibos).
 *
 * The GLOBAL seed user is permanently onboarding-complete under the reworked
 * gating (it would be bounced off the wizard to /dashboard), so this spec uses
 * the dedicated wizard user, isolated from the many shared-seed specs.
 *
 * NOTE on the no-mention assertion: spec.md carries two requirements that
 * scope it. The general "each step page MUST NOT mention …" rule is asserted on
 * the three input steps. Step 4 ("Pronto") is the documented exception: the
 * SAME spec MANDATES an informational "O que vem em breve" section that LISTS
 * WhatsApp/PIX/Receita Saúde as future. Asserting their absence on step 4 would
 * contradict its own requirement, so the no-mention sweep is scoped to 1–3.
 */

const SETUP = (step: 'profile' | 'location' | 'patients' | 'done') => `/onboarding/setup/${step}`;

// Terms that must never appear on the input steps (1–3) of the wizard.
const FORBIDDEN_TERMS = ['WhatsApp', 'Receita Saúde', 'PIX', 'cobrança', 'recibo'] as const;

/**
 * Asserts the visible "Passo N de 4" eyebrow on the current wizard page.
 */
async function expectProgress(page: Page, position: number): Promise<void> {
  await expect(page.getByTestId('wizard-progress')).toContainText(`Passo ${position} de 4`);
}

/**
 * Asserts none of the post-MVP module terms appear in the page body. Scoped to
 * the input steps (1–3) — see the file-level NOTE.
 */
async function expectNoForbiddenTerms(page: Page): Promise<void> {
  const body = page.locator('body');
  for (const term of FORBIDDEN_TERMS) {
    await expect(body).not.toContainText(term);
  }
}

test.describe('@onboarding wizard-flow — full four-step walkthrough', () => {
  // Held per-test connection carrying the cross-worker advisory lock that makes
  // this spec mutually exclusive with the other onboarding wizard specs on the
  // dedicated `profiles.onboarding_step` row. See `ONBOARDING_PROFILE_LOCK_KEY`.
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

  test('completes all four steps in order, resumes after reload, and hides the banner on completion', async ({
    page,
  }) => {
    const sql = lockSql!;

    // ---- Step 1: profile ("Sobre você") -----------------------------------
    await page.goto(SETUP('profile'));
    await expect(page.getByTestId('setup-step-heading')).toHaveText('Sobre você');
    await expectProgress(page, 1);
    await expectNoForbiddenTerms(page);

    await page.getByTestId('step-profile-display-name').fill('Dra. Seed');
    await page.getByTestId('step-profile-submit').click();

    // Completing step 1 advances `onboarding_step` to the NEXT step (`location`)
    // server-side and the client navigates the user forward to step 2.
    await page.waitForURL(`**${SETUP('location')}`, { timeout: 10_000 });
    await expect
      .poll(async () => (await readWizardOnboardingState(sql)).onboardingStep)
      .toBe('location');

    // The display name typed in step 1 is persisted to `profiles.full_name`
    // (changed away from the reset baseline), not silently discarded.
    await expect
      .poll(async () => (await readWizardOnboardingState(sql)).fullName)
      .toBe('Dra. Seed');

    // ---- Step 2: location ("Local e agenda") -------------------------------
    await expect(page.getByTestId('setup-step-heading')).toHaveText('Local e agenda');
    await expectProgress(page, 2);
    await expectNoForbiddenTerms(page);

    await page.getByTestId('step-location-name').fill('Consultório Vila Madalena');
    await page.getByTestId('step-location-submit').click();

    // Completing step 2 flips `location_configured`, advances the persisted step
    // to the NEXT step (`patients`), and navigates the user to step 3.
    await page.waitForURL(`**${SETUP('patients')}`, { timeout: 10_000 });
    await expect
      .poll(async () => (await readWizardOnboardingState(sql)).onboardingStep)
      .toBe('patients');

    // ---- Resume proof: reload mid-flow returns to the saved resume point ---
    // The persisted step is `patients`; opening any EARLIER step (e.g. step 1)
    // must bounce the user FORWARD to their saved resume point rather than
    // letting them redo an earlier step (resume derives from server state, not
    // the URL).
    await page.goto(SETUP('profile'));
    await page.waitForURL(`**${SETUP('patients')}`, { timeout: 10_000 });
    expect(new URL(page.url()).pathname).toBe(SETUP('patients'));
    await expectProgress(page, 3);

    // ---- Step 3: patients ("Importe pacientes") — skip ---------------------
    await expect(page.getByTestId('setup-step-heading')).toHaveText('Importe pacientes');
    await expectProgress(page, 3);
    await expectNoForbiddenTerms(page);

    await page.getByTestId('step-patients-skip').click();

    // Skipping advances the persisted step to the terminal `done`. That value
    // satisfies the soft gate, so the wizard's `done` summary route is itself
    // bounced to `/dashboard` by the middleware (middleware-gating spec: an
    // active user with `onboarding_step = 'done'` passes to the dashboard and
    // wizard routes redirect there) — the user lands directly on the dashboard.
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe('/dashboard');
    await expect(page.getByTestId('dashboard-greeting')).toBeVisible();

    // DB: the cursor is terminal.
    const state = await readWizardOnboardingState(sql);
    expect(state.onboardingStep).toBe('done');

    // The unfinished-setup banner is gone now that onboarding is complete.
    await expect(page.getByTestId('unfinished-setup-banner')).toHaveCount(0);
  });
});
