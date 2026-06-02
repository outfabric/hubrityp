import { expect, type Page, test } from '@playwright/test';
import pgModule from 'postgres';

import {
  ONBOARDING_PROFILE_LOCK_KEY,
  readSeedState,
  STORAGE_STATE_PATH,
} from '../setup/seed-state';

/**
 * @onboarding -- End-to-end wizard flow (section 10).
 *
 * Walks the seeded `active` psychologist through the full four-step MVP setup
 * wizard and proves the contractual behaviours from
 * `onboarding-wizard/spec.md`:
 *
 *   - the four navigable steps render in order (`profile` → `location` →
 *     `patients` → `done`), each with a "Passo N de 4" progress indicator;
 *   - the wizard is RESUMABLE: after a full-page reload mid-flow the user
 *     lands back on their saved step (resume derives from the persisted
 *     `profiles.onboarding_step`, never from client state);
 *   - skipping step 3 still reaches step 4;
 *   - completing from step 4 routes to `/dashboard`, stamps
 *     `onboarding_completed_at`, and hides the unfinished-setup banner;
 *   - steps that COLLECT input (1–3) never mention the post-MVP modules
 *     (WhatsApp, Receita Saúde, PIX/cobrança, recibos).
 *
 * NOTE on the no-mention assertion: spec.md carries two requirements that
 * scope it. The general "each step page MUST NOT mention …" rule (lines 27–28)
 * is asserted on the three input steps. Step 4 ("Pronto") is the documented
 * exception: the SAME spec (line 94) MANDATES an informational
 * "O que vem em breve" section that LISTS WhatsApp/PIX/Receita Saúde as future
 * (without enabling them). Asserting their absence on step 4 would contradict
 * its own requirement, so the no-mention sweep here is scoped to steps 1–3 —
 * the surfaces where the constraint is meaningful and the implementation is
 * actually clean.
 */

const SETUP = (step: 'profile' | 'location' | 'patients' | 'done') => `/onboarding/setup/${step}`;

// Terms that must never appear on the input steps (1–3) of the wizard.
const FORBIDDEN_TERMS = ['WhatsApp', 'Receita Saúde', 'PIX', 'cobrança', 'recibo'] as const;

/**
 * Opens a short-lived pg connection to the seeded Testcontainers Postgres.
 * Callers own the lifecycle via the returned `sql`; always `await sql.end()`.
 */
async function openSeedSql() {
  const seed = await readSeedState();
  const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
  return { seed, sql };
}

/**
 * Resets the seeded profile to a pristine "not started" onboarding state and
 * clears the owner's checklist row. Run before each test so resume/completion
 * assertions are deterministic across retries and the reused container
 * (Testcontainers `.withReuse()` persists rows between runs).
 */
async function resetOnboarding(): Promise<void> {
  const { seed, sql } = await openSeedSql();
  try {
    await sql`
      UPDATE public.profiles
      SET onboarding_step = 'welcome',
          onboarding_completed_at = NULL,
          full_name = ${RESET_FULL_NAME},
          updated_at = now()
      WHERE user_id = ${seed.userId};
    `;
    await sql`DELETE FROM public.onboarding_checklist WHERE user_id = ${seed.userId};`;
  } finally {
    await sql.end();
  }
}

// Deterministic baseline so the step-1 persistence assertion can prove the
// display name actually changed (and was not just already equal by chance).
const RESET_FULL_NAME = 'Seed Baseline';

/**
 * Reads the persisted onboarding state for the seeded owner.
 */
async function readOnboardingState(): Promise<{
  onboardingStep: string;
  onboardingCompletedAt: Date | null;
  fullName: string;
}> {
  const { seed, sql } = await openSeedSql();
  try {
    const rows = await sql`
      SELECT onboarding_step, onboarding_completed_at, full_name
      FROM public.profiles
      WHERE user_id = ${seed.userId};
    `;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    return {
      onboardingStep: row.onboarding_step as string,
      onboardingCompletedAt: row.onboarding_completed_at as Date | null,
      fullName: row.full_name as string,
    };
  } finally {
    await sql.end();
  }
}

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
  test.use({ storageState: STORAGE_STATE_PATH });

  // Held per-test connection carrying the cross-worker advisory lock that makes
  // this spec mutually exclusive with `welcome.spec.ts` on the shared seeded
  // `profiles.onboarding_step` row. See `ONBOARDING_PROFILE_LOCK_KEY`.
  let lockSql: ReturnType<typeof pgModule> | null = null;

  test.beforeEach(async () => {
    const seed = await readSeedState();
    lockSql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    await lockSql`SELECT pg_advisory_lock(${ONBOARDING_PROFILE_LOCK_KEY})`;
    await resetOnboarding();
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
    // ---- Step 1: profile ("Sobre você") -----------------------------------
    await page.goto(SETUP('profile'));
    await expect(page.getByTestId('setup-step-heading')).toHaveText('Sobre você');
    await expectProgress(page, 1);
    await expectNoForbiddenTerms(page);

    await page.getByTestId('step-profile-display-name').fill('Dra. Seed');
    await page.getByTestId('step-profile-submit').click();

    // Completing step 1 advances `onboarding_step` to the NEXT step
    // (`location`) server-side and the client navigates the user forward to
    // step 2 — no manual `goto` needed.
    await page.waitForURL(`**${SETUP('location')}`, { timeout: 10_000 });
    await expect.poll(async () => (await readOnboardingState()).onboardingStep).toBe('location');

    // The display name typed in step 1 is persisted to `profiles.full_name`
    // (changed away from the reset baseline), not silently discarded.
    await expect.poll(async () => (await readOnboardingState()).fullName).toBe('Dra. Seed');

    // ---- Step 2: location ("Local e agenda") -------------------------------
    await expect(page.getByTestId('setup-step-heading')).toHaveText('Local e agenda');
    await expectProgress(page, 2);
    await expectNoForbiddenTerms(page);

    await page.getByTestId('step-location-name').fill('Consultório Vila Madalena');
    await page.getByTestId('step-location-submit').click();

    // Completing step 2 flips `location_configured`, advances the persisted
    // step to the NEXT step (`patients`), and navigates the user to step 3.
    await page.waitForURL(`**${SETUP('patients')}`, { timeout: 10_000 });
    await expect.poll(async () => (await readOnboardingState()).onboardingStep).toBe('patients');

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

    // Skipping advances the persisted step to the terminal `done` WITHOUT
    // importing any patient data (the checklist `first_patient_added` flag
    // stays false) and navigates the user to step 4.
    await page.waitForURL(`**${SETUP('done')}`, { timeout: 10_000 });
    await expect.poll(async () => (await readOnboardingState()).onboardingStep).toBe('done');

    // ---- Step 4: done ("Tudo pronto") --------------------------------------
    await expect(page.getByTestId('setup-step-heading')).toHaveText('Tudo pronto');
    await expectProgress(page, 4);
    await expect(page.getByTestId('step-done')).toBeVisible();

    // Completion via the secondary CTA routes to /dashboard and stamps
    // `onboarding_completed_at`.
    await page.getByTestId('step-done-cta-dashboard').click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe('/dashboard');
    await expect(page.getByTestId('dashboard-greeting')).toBeVisible();

    // DB: completion stamped, step terminal.
    const state = await readOnboardingState();
    expect(state.onboardingStep).toBe('done');
    expect(state.onboardingCompletedAt).not.toBeNull();

    // The unfinished-setup banner is gone now that onboarding is complete.
    await expect(page.getByTestId('unfinished-setup-banner')).toHaveCount(0);
  });

  test('the unfinished-setup banner is visible on the dashboard before completion', async ({
    page,
  }) => {
    // Sanity baseline for the completion assertion above: with onboarding NOT
    // finished (reset in beforeEach), the banner DOES show on the dashboard.
    await page.goto('/dashboard');
    await expect(page.getByTestId('dashboard-greeting')).toBeVisible();
    await expect(page.getByTestId('unfinished-setup-banner')).toBeVisible();
    await expect(page.getByTestId('unfinished-setup-banner-link')).toHaveAttribute(
      'href',
      // Pristine state (`welcome`) resumes at the first step.
      SETUP('profile'),
    );
  });
});
