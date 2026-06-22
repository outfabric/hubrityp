// Shared harness for the first-run onboarding-wizard E2E specs.
//
// Under the reworked middleware gating an `active` user with INCOMPLETE
// onboarding is funneled into `/onboarding/welcome`. The GLOBAL seed user is
// permanently onboarding-COMPLETE (so the many `/dashboard` specs sharing its
// storageState reach the app), so the wizard is driven by the DEDICATED
// `SEED_ONBOARDING_WIZARD_USER` instead — seeded active-but-incomplete in
// `global-setup.ts`.
//
// Several specs (`welcome.spec.ts`, `wizard-flow.spec.ts`,
// `first-run-happy-path.spec.ts`, `first-run-skip.spec.ts`) mutate this single
// user's `onboarding_step` row and run under `fullyParallel`, so they
// synchronize on a cross-worker Postgres advisory lock for the duration of
// their DB-mutating + navigation section — exactly the pattern the previous
// shared-seed wizard specs used, now keyed to the dedicated row.

import type { BrowserContext, APIRequestContext } from '@playwright/test';
import pgModule from 'postgres';

import { signInAsDedicatedUser } from '../_shared/dedicated-user-auth';
import {
  ONBOARDING_PROFILE_LOCK_KEY,
  readSeedState,
  SEED_ONBOARDING_WIZARD_USER,
} from '../setup/seed-state';

/**
 * Signs the browser context in as the dedicated onboarding-wizard user with the
 * Edge profile shim reporting active-but-INCOMPLETE onboarding (`'welcome'`), so
 * the middleware routes it INTO the wizard. Must be awaited before any
 * navigation in a test using this user.
 */
export async function signInAsWizardUser(
  context: BrowserContext,
  request: APIRequestContext,
): Promise<void> {
  await signInAsDedicatedUser(context, request, SEED_ONBOARDING_WIZARD_USER, {
    onboardingStep: 'welcome',
    onboardingCompletedAt: null,
    // Overlay live onboarding fields so a skip/complete write lets the next
    // navigation reach /dashboard instead of looping back to the wizard.
    dynamic: true,
  });
}

/**
 * Opens a short-lived pg connection to the seeded Testcontainers Postgres.
 * Callers own the lifecycle via the returned `sql`; always `await sql.end()`.
 */
export async function openWizardSql(): Promise<ReturnType<typeof pgModule>> {
  const seed = await readSeedState();
  return pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
}

/** The dedicated wizard user's pristine display name (set by `global-setup.ts`). */
export const WIZARD_USER_FULL_NAME = SEED_ONBOARDING_WIZARD_USER.fullName;

/** First name derived from the dedicated wizard user's full name. */
export const WIZARD_USER_FIRST_NAME = SEED_ONBOARDING_WIZARD_USER.fullName.split(/\s+/)[0]!;

/**
 * Resets the dedicated wizard user to a pristine "not started" onboarding state
 * (incomplete cursor + cleared completion/first-access) and wipes its domain
 * data + checklist cache, so resume / completion / skip / first-access
 * assertions are deterministic across retries and the reused container.
 *
 * `fullName` controls the profile-step probe: the data-aware resume resolver
 * treats a NON-EMPTY `profiles.full_name` as "profile step already satisfied"
 * and fast-forwards past it (matching production — a freshly-validated user who
 * already has a display name does not re-enter step 1). Pass `''` (the default)
 * to make the profile step PENDING so the wizard begins at step 1; pass a real
 * name to exercise the welcome greeting / fast-forward.
 *
 * The caller MUST hold the advisory lock for the duration of the reset + the
 * navigation that follows.
 */
export async function resetWizardUser(
  sql: ReturnType<typeof pgModule>,
  options: { fullName?: string } = {},
): Promise<void> {
  const id = SEED_ONBOARDING_WIZARD_USER.id;
  const fullName = options.fullName ?? '';
  await sql`DELETE FROM public.consent_terms WHERE user_id = ${id}`;
  await sql`DELETE FROM public.sessions WHERE user_id = ${id}`;
  await sql`DELETE FROM public.patients WHERE user_id = ${id}`;
  await sql`DELETE FROM public.locations WHERE user_id = ${id}`;
  await sql`DELETE FROM public.onboarding_checklist WHERE user_id = ${id}`;
  await sql`
    UPDATE public.profiles
    SET onboarding_step = 'welcome',
        onboarding_completed_at = NULL,
        first_access_at = NULL,
        full_name = ${fullName},
        updated_at = now()
    WHERE user_id = ${id};
  `;
}

/**
 * Reads the persisted onboarding state for the dedicated wizard user.
 */
export async function readWizardOnboardingState(sql: ReturnType<typeof pgModule>): Promise<{
  onboardingStep: string;
  onboardingCompletedAt: Date | null;
  firstAccessAt: Date | null;
  fullName: string;
}> {
  const rows = await sql`
    SELECT onboarding_step, onboarding_completed_at, first_access_at, full_name
    FROM public.profiles
    WHERE user_id = ${SEED_ONBOARDING_WIZARD_USER.id};
  `;
  const row = rows[0]!;
  return {
    onboardingStep: row.onboarding_step as string,
    onboardingCompletedAt: row.onboarding_completed_at as Date | null,
    firstAccessAt: row.first_access_at as Date | null,
    fullName: row.full_name as string,
  };
}

export { ONBOARDING_PROFILE_LOCK_KEY };
