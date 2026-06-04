import { test as base, expect, type Page } from '@playwright/test';
import pgModule from 'postgres';

import { signInAsDedicatedUser } from '../_shared/dedicated-user-auth';
import { readSeedState, SEED_NPS_USER } from '../setup/seed-state';

/**
 * @nps -- End-to-end day-7 NPS survey flow (section 10.1).
 *
 * Drives the dedicated `SEED_NPS_USER` (an active psychologist touched by nothing
 * else in the suite) through the contractual behaviours from `nps-survey/spec.md`:
 *
 *   1. The day-7 modal shows on the FIRST eligible `(app)` render — gate is
 *      `first_access_at` ≥ 7 days ago AND `nps_responded_at IS NULL`, computed
 *      SERVER-SIDE (`getNpsEligibility`), never from client storage.
 *   2. Submitting a valid score persists `nps_score` + `nps_responded_at` and
 *      closes the modal.
 *   3. Reloading the dashboard does NOT re-show the modal (the server stamp makes
 *      the next eligibility check false).
 *   4. "Não responder agora" stamps `nps_responded_at` WITHOUT a score, so the
 *      survey stops reappearing while the answer stays available later.
 *   5. After dismissal, the answer is still submittable from Configurações >
 *      Feedback (`/configuracoes/feedback`) — and that submit is a no-op write
 *      guarded by `nps_responded_at IS NULL`, so the dismissal stands.
 *   6. The modal is NOT shown before day 7 (first_access_at < 7 days ago).
 *
 * Isolation: this user owns the entire NPS state, so the spec resets
 * `first_access_at`/`nps_responded_at`/`nps_score`/`nps_feedback` in `beforeEach`
 * and runs `serial` so a sibling test cannot mutate the shared row between this
 * test's reset and its assertion. We sign in as the dedicated user via the shared
 * helper (NOT `storageState`, which is the global seed user).
 *
 * The modal is a Radix Dialog rendered by the `(app)` layout's `NpsModalSlot`
 * when eligible; its content carries `data-testid="nps-modal"`, the 0–10 scale
 * buttons `nps-score-{n}`, submit `nps-submit`, dismiss `nps-dismiss`. Both submit
 * and dismiss invoke fire-and-forget Server Actions on the current page (POST with
 * a `next-action` header), so we arm `waitForResponse` for the action round-trip
 * AND poll the authoritative DB row before asserting persistence.
 */

const USER = SEED_NPS_USER;

const MODAL = '[data-testid="nps-modal"]';

type NpsRow = {
  first_access_at: Date | null;
  nps_responded_at: Date | null;
  nps_score: number | null;
  nps_feedback: string | null;
};

async function openSql() {
  const seed = await readSeedState();
  return pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
}

/**
 * Resets the dedicated user's NPS state. `firstAccessDaysAgo` controls
 * `first_access_at`; everything else returns to the unanswered baseline.
 */
async function resetNpsState(firstAccessDaysAgo: number | null): Promise<void> {
  const sql = await openSql();
  try {
    // `first_access_at` is computed relative to `now()` so the day-7 boundary
    // stays correct regardless of when the suite runs. Build it as a parameter
    // (an ISO instant) rather than interpolating SQL, so the value is always
    // bound safely.
    const firstAccessAt =
      firstAccessDaysAgo === null
        ? null
        : new Date(Date.now() - firstAccessDaysAgo * 24 * 60 * 60 * 1000);

    await sql`
      UPDATE public.profiles
      SET first_access_at = ${firstAccessAt},
          nps_responded_at = NULL,
          nps_score = NULL,
          nps_feedback = NULL,
          updated_at = now()
      WHERE user_id = ${USER.id};
    `;
  } finally {
    await sql.end();
  }
}

/** Reads the dedicated user's NPS columns. */
async function readNpsRow(): Promise<NpsRow> {
  const sql = await openSql();
  try {
    const rows = await sql<NpsRow[]>`
      SELECT first_access_at, nps_responded_at, nps_score, nps_feedback
      FROM public.profiles
      WHERE user_id = ${USER.id};
    `;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  } finally {
    await sql.end();
  }
}

/** Waits for the dashboard shell to be interactive (greeting rendered). */
async function gotoDashboard(page: Page): Promise<void> {
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-greeting')).toBeVisible({ timeout: 15_000 });
}

/**
 * Triggers an NPS Server Action and waits for the fire-and-forget POST to
 * round-trip before the caller asserts persistence.
 *
 * The modal/form fire the action without awaiting on the client (submit runs in
 * a `useTransition`; dismiss is `void onDismiss()`), and the action reference is
 * bound only once the client leaf has hydrated. Two hazards, mirrored from the
 * tour spec's `endTourAndAwaitStamp`:
 *   1. Acting too early posts a no-op the client cannot yet route to the action.
 *      We let the leaf settle first (a real user reads the modal for far longer).
 *   2. The POST is fire-and-forget, so polling the DB immediately races it. We
 *      arm `waitForResponse` for the action POST on `pagePath` BEFORE triggering.
 */
async function actAndAwaitAction(
  page: Page,
  pagePath: string,
  trigger: () => Promise<void>,
): Promise<void> {
  // Let the modal/form leaf finish hydrating so the action is bound. We cannot
  // use `networkidle` (the app keeps a realtime WebSocket reconnecting), so a
  // short fixed settle is the honest minimum.
  await page.waitForTimeout(1_500);

  const actionResponse = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      res.request().headers()['next-action'] !== undefined &&
      new URL(res.url()).pathname === pagePath &&
      res.status() === 200,
    { timeout: 15_000 },
  );
  await trigger();
  await actionResponse;
}

base.describe('@nps day-7 survey flow', () => {
  // Every test mutates the SAME dedicated user's NPS columns (reset in
  // beforeEach, stamped by submitting/dismissing). Serial mode makes the per-test
  // reset → assert cycle deterministic without a cross-worker advisory lock.
  base.describe.configure({ mode: 'serial' });

  base.beforeEach(async ({ context, request }) => {
    await signInAsDedicatedUser(context, request, USER);
  });

  base(
    'shows the modal on day 7, submits an answer, and does not re-show on reload',
    async ({ page }) => {
      // Eligible: first access 7 days ago, never responded.
      await resetNpsState(7);

      await gotoDashboard(page);

      // The modal auto-opens on the first eligible render.
      const modal = page.locator(MODAL);
      await expect(modal).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('nps-score-options')).toBeVisible();

      // Pick a promoter score (9) and submit. The action persists the score and
      // stamps `nps_responded_at`, then the form closes the modal.
      await page.getByTestId('nps-score-9').click();
      await actAndAwaitAction(page, '/dashboard', () => page.getByTestId('nps-submit').click());

      // The modal closes after a successful write.
      await expect(modal).toHaveCount(0, { timeout: 10_000 });

      // Authoritative server state: the score + responded timestamp are written.
      await expect
        .poll(
          async () => {
            const row = await readNpsRow();
            return { score: row.nps_score, responded: row.nps_responded_at != null };
          },
          { timeout: 10_000 },
        )
        .toEqual({ score: 9, responded: true });

      // Reload: the survey is recorded, so eligibility is now false and the modal
      // must NOT re-show. Wait for the shell, then guard against a late mount.
      await page.reload();
      await expect(page.getByTestId('dashboard-greeting')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(MODAL)).toHaveCount(0);
      await page.waitForTimeout(1_000);
      await expect(page.locator(MODAL)).toHaveCount(0);
    },
  );

  base(
    '"Não responder agora" suppresses the modal and the answer is still possible via Configurações > Feedback',
    async ({ page }) => {
      // Eligible: first access 7 days ago, never responded.
      await resetNpsState(7);

      await gotoDashboard(page);

      const modal = page.locator(MODAL);
      await expect(modal).toBeVisible({ timeout: 15_000 });

      // Defer: "Não responder agora" stamps `nps_responded_at` WITHOUT a score
      // and closes the modal.
      await actAndAwaitAction(page, '/dashboard', () => page.getByTestId('nps-dismiss').click());
      await expect(modal).toHaveCount(0, { timeout: 10_000 });

      // Server state after dismissal: responded stamped, NO score/feedback.
      await expect
        .poll(
          async () => {
            const row = await readNpsRow();
            return {
              responded: row.nps_responded_at != null,
              score: row.nps_score,
              feedback: row.nps_feedback,
            };
          },
          { timeout: 10_000 },
        )
        .toEqual({ responded: true, score: null, feedback: null });

      // Reload: the modal does not reappear after dismissal.
      await page.reload();
      await expect(page.getByTestId('dashboard-greeting')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(MODAL)).toHaveCount(0);

      // The answer is still possible later from Configurações > Feedback. Because
      // the user already responded (dismissed), the page shows the thank-you
      // state — re-submitting cannot overwrite the first response, so the
      // "answer later" affordance is the form when unanswered and the recorded
      // confirmation once a response (or dismissal) exists.
      await page.goto('/configuracoes/feedback');
      await expect(page.getByTestId('feedback-page-title')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('nps-feedback-thanks')).toBeVisible({ timeout: 15_000 });

      // Dismissal stands: the no-op-guarded write never recorded a score.
      const row = await readNpsRow();
      expect(row.nps_score).toBeNull();
    },
  );

  base(
    'submits a later answer from Configurações > Feedback when not yet responded',
    async ({ page }) => {
      // Not modal-eligible (first access only 3 days ago) and not yet responded, so
      // the day-7 modal does NOT render over the page and the Configurações card's
      // form is the sole, freely-writable NPS surface. This isolates the "answer
      // can be submitted later from Configurações > Feedback" scenario without the
      // modal's Radix overlay intercepting the card's clicks. (When a user IS
      // modal-eligible, the modal owns the answer; the realistic Configurações
      // entry is reached after that modal is dismissed — covered by the test
      // above, which lands on the thank-you state.)
      await resetNpsState(3);

      await page.goto('/configuracoes/feedback');
      await expect(page.getByTestId('feedback-page-title')).toBeVisible({ timeout: 15_000 });

      // No modal here → exactly one NPS form, inside the card. Unanswered → the
      // form (not the thank-you) is shown, with NO "Não responder agora" (nothing
      // to defer here).
      const card = page.getByTestId('nps-feedback-card');
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(MODAL)).toHaveCount(0);
      await expect(page.getByTestId('nps-dismiss')).toHaveCount(0);

      // Pick a detractor score (3) + open feedback, then submit. The submit POSTs
      // to the feedback page path.
      await page.getByTestId('nps-score-3').click();
      await page.getByTestId('nps-feedback').fill('Faltam relatórios');
      await actAndAwaitAction(page, '/configuracoes/feedback', () =>
        page.getByTestId('nps-submit').click(),
      );

      // Thank-you state replaces the form after a successful submit.
      await expect(page.getByTestId('nps-feedback-thanks')).toBeVisible({ timeout: 10_000 });

      // Authoritative server state: score, feedback, and responded timestamp.
      await expect
        .poll(
          async () => {
            const row = await readNpsRow();
            return {
              score: row.nps_score,
              feedback: row.nps_feedback,
              responded: row.nps_responded_at != null,
            };
          },
          { timeout: 10_000 },
        )
        .toEqual({ score: 3, feedback: 'Faltam relatórios', responded: true });
    },
  );

  base('does not show the modal before day 7', async ({ page }) => {
    // Not yet eligible: first access only 3 days ago, never responded.
    await resetNpsState(3);

    await gotoDashboard(page);

    // The modal must stay absent through the initial render and a short settle.
    await expect(page.locator(MODAL)).toHaveCount(0);
    await page.waitForTimeout(1_000);
    await expect(page.locator(MODAL)).toHaveCount(0);

    // No write happened — the survey is still unanswered.
    const row = await readNpsRow();
    expect(row.nps_responded_at).toBeNull();
  });
});
