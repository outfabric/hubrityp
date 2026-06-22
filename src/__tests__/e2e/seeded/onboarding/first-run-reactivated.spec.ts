import { expect, test } from '@playwright/test';
import pgModule from 'postgres';

import { signInAsDedicatedUser } from '../_shared/dedicated-user-auth';
import { readSeedState, SEED_ONBOARDING_REACTIVATED_USER } from '../setup/seed-state';

/**
 * @onboarding -- Reactivated-account regression (change rework-onboarding-first-run,
 * task 6.3).
 *
 * A previously-cancelled psychologist brought back online whose onboarding is
 * INCOMPLETE (`onboarding_step = 'location'`) but who ALREADY owns a configured
 * location and an active patient (`SEED_ONBOARDING_REACTIVATED_USER`, seeded in
 * `global-setup.ts`).
 *
 * Proves the two data-aware guarantees from the onboarding-wizard spec:
 *   - the wizard FAST-FORWARDS past the location step (and patients step) whose
 *     real data already exists — the user is never asked to RE-CREATE a
 *     location; requesting `/onboarding/setup/location` syncs the cursor to the
 *     terminal `done` (which satisfies the soft gate, so the middleware sends
 *     the user on to `/dashboard`) and the location form is never rendered;
 *   - `configureLocationImpl` is idempotent — no duplicate location row is
 *     produced (the count stays exactly 1) even though the user passed through
 *     the location step server-side.
 *
 * This user is touched by NOTHING else; the spec only READS its location count
 * (no mutation that needs cross-spec synchronization), but it still re-asserts
 * the seeded baseline (one location) defensively in case a prior run left
 * residue on the reused container — `global-setup.ts` already resets it.
 */

const REACT_USER = SEED_ONBOARDING_REACTIVATED_USER;

async function openSql(): Promise<ReturnType<typeof pgModule>> {
  const seed = await readSeedState();
  return pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
}

async function countLocations(sql: ReturnType<typeof pgModule>): Promise<number> {
  const rows = await sql`
    SELECT count(*)::int AS n FROM public.locations WHERE user_id = ${REACT_USER.id};
  `;
  return rows[0]!.n as number;
}

/**
 * Restores the reactivated user to its incomplete baseline: cursor `'location'`,
 * completion cleared, exactly ONE pre-existing location + ONE active patient.
 * The spec mutates the row to `'done'` via `completeOnboarding`, so this reset
 * runs before each attempt (incl. Playwright retries) to stay deterministic on
 * the reused container.
 */
async function resetReactivatedUser(sql: ReturnType<typeof pgModule>): Promise<void> {
  await sql`
    UPDATE public.profiles
    SET onboarding_step = 'location',
        onboarding_completed_at = NULL,
        first_access_at = NULL,
        reactivated_at = now(),
        updated_at = now()
    WHERE user_id = ${REACT_USER.id};
  `;
  // Remove any extra locations a prior attempt's resume/idempotency path might
  // have produced, keeping the single seeded one.
  await sql`
    DELETE FROM public.locations
    WHERE user_id = ${REACT_USER.id} AND id <> ${REACT_USER.location.id};
  `;
  await sql`
    INSERT INTO public.locations (id, user_id, name, type, is_default)
    VALUES (${REACT_USER.location.id}, ${REACT_USER.id}, ${REACT_USER.location.name}, 'in_person', true)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_default = true;
  `;
  await sql`
    INSERT INTO public.patients (id, user_id, full_name, patient_type, status, archived_at)
    VALUES (${REACT_USER.patient.id}, ${REACT_USER.id}, ${REACT_USER.patient.fullName}, 'individual', 'active', NULL)
    ON CONFLICT (id) DO UPDATE SET status = 'active', archived_at = NULL;
  `;
}

test.describe('@onboarding reactivated account — no duplicate location, no re-create prompt', () => {
  test.beforeEach(async ({ context, request }) => {
    const sql = await openSql();
    try {
      await resetReactivatedUser(sql);
    } finally {
      await sql.end();
    }
    // The Edge profile shim must report active-but-INCOMPLETE (`'location'`) so
    // the middleware routes this user into the wizard rather than bouncing it
    // to /dashboard.
    await signInAsDedicatedUser(context, request, REACT_USER, {
      onboardingStep: 'location',
      onboardingCompletedAt: null,
      // Overlay live onboarding fields so completing from `done` lets the final
      // navigation reach /dashboard instead of looping back to the wizard.
      dynamic: true,
    });
  });

  test('fast-forwards past the location step and never creates a second location', async ({
    page,
  }) => {
    const sql = await openSql();
    try {
      // Baseline: exactly one pre-existing location (seeded in global-setup).
      expect(await countLocations(sql)).toBe(1);

      // The welcome screen greets a reactivated user with the "welcome back"
      // variant and points at step 1.
      await page.goto('/onboarding/welcome');
      await expect(page.getByTestId('onboarding-welcome-heading')).toBeVisible();
      await expect(page.getByTestId('onboarding-welcome-heading')).toContainText(
        'Bem-vindo de volta',
      );

      // Requesting the LOCATION step directly must NOT show the location form:
      // the data-aware resume resolver fast-forwards past every step whose real
      // data exists (profile name set, ≥1 location, ≥1 active patient) and
      // SYNCHRONIZES the cursor to the terminal `done`. Because `done` satisfies
      // the soft gate, the middleware then bounces the wizard's own `done` route
      // straight to `/dashboard` — so the user never sees the location form and
      // lands on the dashboard.
      await page.goto('/onboarding/setup/location');
      await page.waitForURL('**/dashboard', { timeout: 15_000 });
      expect(new URL(page.url()).pathname).toBe('/dashboard');
      await expect(page.getByTestId('dashboard-greeting')).toBeVisible();

      // The location creation form is never rendered for this user.
      await expect(page.getByTestId('step-location-form')).toHaveCount(0);

      // No duplicate location was created by the fast-forward / resume sync —
      // `configureLocationImpl`'s idempotency and the resume sync both leave the
      // single pre-existing location untouched.
      expect(await countLocations(sql)).toBe(1);

      // The cursor was synced to the terminal `done` by the resume resolver.
      const rows = await sql`
        SELECT onboarding_step FROM public.profiles WHERE user_id = ${REACT_USER.id};
      `;
      expect(rows[0]!.onboarding_step).toBe('done');
    } finally {
      await sql.end();
    }
  });
});
