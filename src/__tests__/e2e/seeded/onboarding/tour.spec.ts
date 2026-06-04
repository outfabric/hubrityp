import { test as base, expect, type Page } from '@playwright/test';
import pgModule from 'postgres';

import { signInAsDedicatedUser } from '../_shared/dedicated-user-auth';
import { readSeedState, SEED_ONBOARDING_TOUR_USER } from '../setup/seed-state';

/**
 * @onboarding -- Guided product tour (section 4.2).
 *
 * Drives the dedicated `SEED_ONBOARDING_TOUR_USER` (an active psychologist that
 * owns one patient + one session, so the dashboard renders the four operational
 * sections and ALL five `data-tour-anchor` surfaces are present) through the
 * contractual behaviours from `onboarding-tour/spec.md` + PRD 11 §5.5:
 *
 *   - the first `/dashboard` open auto-runs the tour (gate: `tour_completed_at`
 *     is NULL), highlighting the five surfaces in order;
 *   - "Pular tour" (the popover close control) dismisses the tour from any step;
 *   - finishing/skipping stamps `tour_completed_at`, after which the tour does
 *     NOT auto-run again on a fresh dashboard load;
 *   - "Refazer tour" replays the tour on demand even after completion
 *     (via `/dashboard?tour=replay`, the cross-page replay path);
 *   - NO post-MVP surface (WhatsApp / Receita Saúde / PIX / cobrança / recibo)
 *     appears in ANY tooltip — the tour must only point at shipped controls.
 *
 * Isolation: this user is touched by NOTHING else in the suite, so the spec can
 * deterministically reset `tour_completed_at` in `beforeEach` and run
 * `fullyParallel` without an advisory lock — a sibling spec cannot stamp this
 * user's row between the reset and the assertion. We sign in as the dedicated
 * user via the shared helper (NOT `storageState`, which is the global seed user).
 *
 * The tour is a Driver.js overlay: its popover lives in `.driver-popover`, the
 * title/description in `.driver-popover-title` / `.driver-popover-description`,
 * the close ("Pular tour") control in `.driver-popover-close-btn`, and the next
 * control in `.driver-popover-next-btn` (the final step's "Concluir" is the
 * next-btn slot with `doneBtnText`). These class names are Driver.js public
 * theming contracts.
 */

const USER = SEED_ONBOARDING_TOUR_USER;

const POPOVER = '.driver-popover';
const POPOVER_TITLE = '.driver-popover-title';
const POPOVER_DESC = '.driver-popover-description';
const POPOVER_CLOSE = '.driver-popover-close-btn';
const POPOVER_NEXT = '.driver-popover-next-btn';

// The five tour step titles, in PRD 11 §5.5 order. Asserting the title sequence
// proves the tour highlights the five surfaces in order without coupling to the
// (Driver.js-managed) highlight box.
const STEP_TITLES = [
  'Menu principal',
  'Hoje',
  'Pendências',
  'Novo paciente',
  'Nova sessão',
] as const;

// Post-MVP surfaces that must never appear in any tooltip — those controls do
// not exist in the shipped product, so pointing at them would mislead the user.
const FORBIDDEN_TERMS = ['WhatsApp', 'Receita Saúde', 'PIX', 'cobrança', 'recibo'] as const;

async function openSql() {
  const seed = await readSeedState();
  return pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
}

/** Resets the dedicated user's tour gate to "never completed" (NULL). */
async function resetTourCompletion(): Promise<void> {
  const sql = await openSql();
  try {
    await sql`
      UPDATE public.profiles
      SET tour_completed_at = NULL, updated_at = now()
      WHERE user_id = ${USER.id};
    `;
  } finally {
    await sql.end();
  }
}

/** Reads the dedicated user's `tour_completed_at`. */
async function readTourCompletedAt(): Promise<Date | null> {
  const sql = await openSql();
  try {
    const rows = await sql`
      SELECT tour_completed_at FROM public.profiles WHERE user_id = ${USER.id};
    `;
    expect(rows).toHaveLength(1);
    return rows[0]!.tour_completed_at as Date | null;
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
 * Ends the tour and waits for the `completeTour` Server Action to round-trip.
 *
 * The tour leaf stamps `tour_completed_at` via a fire-and-forget call in
 * Driver.js's `onDestroyed` (`void completeTour().catch()`), so the POST is
 * issued AFTER the popover is already gone. Two timing hazards must be handled:
 *
 *   1. The dashboard is a Server Component tree with a `dynamic(ssr:false)` tour
 *      leaf; the `completeTour` Server Action reference is bound only once that
 *      leaf has hydrated. Ending the tour in the very first moments fires a POST
 *      the client cannot yet route to the action (it resolves to a no-op), so we
 *      first wait for the network to go idle — a real user reads the tooltip for
 *      far longer than this before acting, so it does not weaken the assertion.
 *   2. The stamp POST is fire-and-forget, so polling the DB immediately races it.
 *      We arm a `waitForResponse` for the Server Action POST (a POST to the
 *      dashboard route carrying the `next-action` header) BEFORE triggering the
 *      destroy, then await it.
 *
 * @param trigger the interaction that ends the tour (click "Concluir" or the
 *   "Pular tour"/close control).
 */
async function endTourAndAwaitStamp(page: Page, trigger: () => Promise<void>): Promise<void> {
  // Let the tour leaf finish hydrating so the `completeTour` action is bound
  // before we end the tour. We cannot use `networkidle` here: the app keeps a
  // realtime WebSocket reconnecting in the background, so the network never
  // truly idles. A short fixed settle is the honest minimum — a real user reads
  // the tooltip for far longer before acting, and empirically the action binds
  // well within this window.
  await page.waitForTimeout(1_500);

  const actionResponse = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      res.request().headers()['next-action'] !== undefined &&
      new URL(res.url()).pathname === '/dashboard' &&
      res.status() === 200,
    { timeout: 15_000 },
  );
  await trigger();
  await expect(page.locator(POPOVER)).toHaveCount(0, { timeout: 10_000 });
  await actionResponse;
}

base.describe('@onboarding tour — guided dashboard walkthrough', () => {
  // Every test mutates the SAME dedicated user's `tour_completed_at` (reset to
  // NULL in beforeEach, stamped by completing/skipping the tour). Under the
  // suite's `fullyParallel` execution, one test's reset could land between
  // another's stamp and its assertion, or a late Driver.js `onDestroyed` →
  // `completeTour` could stamp during a sibling's "does not auto-run" check.
  // Serial mode makes the per-test reset → assert cycle deterministic without a
  // cross-worker advisory lock (all tests run on the same worker).
  base.describe.configure({ mode: 'serial' });

  base.beforeEach(async ({ context, request }) => {
    await resetTourCompletion();
    await signInAsDedicatedUser(context, request, USER);
  });

  base('auto-runs the five-step tour in order on the first dashboard open', async ({ page }) => {
    await gotoDashboard(page);

    // The auto-run fires on mount because `tour_completed_at` is NULL.
    const popover = page.locator(POPOVER);
    await expect(popover).toBeVisible({ timeout: 15_000 });

    // The "Pular tour" close control is present and labeled on EVERY step.
    // Driver.js 1.4.0 ignores `closeBtnText`, so the leaf relabels the button
    // (text + accessible name) via `onPopoverRender`; assert the pt-BR label so
    // a regression back to the bare "×"/"Close" default is caught.
    await expect(page.locator(POPOVER_CLOSE)).toBeVisible();
    await expect(page.locator(POPOVER_CLOSE)).toHaveText('Pular tour');
    await expect(page.locator(POPOVER_CLOSE)).toHaveAttribute('aria-label', 'Pular tour');

    // Walk the five steps in order, asserting each title, then advance. The
    // tooltip copy must be MVP-only on every step.
    for (let i = 0; i < STEP_TITLES.length; i++) {
      await expect(page.locator(POPOVER_TITLE)).toHaveText(STEP_TITLES[i]!, { timeout: 10_000 });
      await expect(page.locator(POPOVER_CLOSE)).toBeVisible();
      await expect(page.locator(POPOVER_CLOSE)).toHaveText('Pular tour');

      const tooltip = `${await page.locator(POPOVER_TITLE).innerText()}\n${await page
        .locator(POPOVER_DESC)
        .innerText()}`;
      for (const term of FORBIDDEN_TERMS) {
        expect(tooltip).not.toContain(term);
      }

      if (i < STEP_TITLES.length - 1) {
        await page.locator(POPOVER_NEXT).click();
      }
    }

    // The final "next" slot is the "Concluir" (done) button; clicking it ends
    // the tour → Driver fires onDestroyed → completeTour stamps the gate.
    await endTourAndAwaitStamp(page, () => page.locator(POPOVER_NEXT).click());

    await expect.poll(async () => await readTourCompletedAt()).not.toBeNull();
  });

  base('"Pular tour" dismisses the tour and stamps completion', async ({ page }) => {
    await gotoDashboard(page);

    const popover = page.locator(POPOVER);
    await expect(popover).toBeVisible({ timeout: 15_000 });
    // Dismiss from the very first step.
    await expect(page.locator(POPOVER_TITLE)).toHaveText(STEP_TITLES[0]);

    // Skipping is a completion: the gate is stamped so it never auto-runs again.
    await endTourAndAwaitStamp(page, () => page.locator(POPOVER_CLOSE).click());

    await expect.poll(async () => await readTourCompletedAt()).not.toBeNull();
  });

  base('does not auto-run again once completed', async ({ page }) => {
    // First open auto-runs; skip it to stamp the gate.
    await gotoDashboard(page);
    await expect(page.locator(POPOVER)).toBeVisible({ timeout: 15_000 });
    await endTourAndAwaitStamp(page, () => page.locator(POPOVER_CLOSE).click());
    await expect.poll(async () => await readTourCompletedAt()).not.toBeNull();

    // A fresh dashboard load with the gate stamped must NOT auto-run the tour.
    // Reload, wait for the shell, then assert the popover stays absent through a
    // short settle window (the auto-run effect, if it fired, would mount it
    // synchronously on mount).
    await page.reload();
    await expect(page.getByTestId('dashboard-greeting')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(POPOVER)).toHaveCount(0);
    // Guard against a late mount: still absent after a brief wait.
    await page.waitForTimeout(1_000);
    await expect(page.locator(POPOVER)).toHaveCount(0);
  });

  base('"Refazer tour" replays the tour after completion', async ({ page }) => {
    // Complete (skip) the tour first so the gate is stamped.
    await gotoDashboard(page);
    await expect(page.locator(POPOVER)).toBeVisible({ timeout: 15_000 });
    await endTourAndAwaitStamp(page, () => page.locator(POPOVER_CLOSE).click());
    await expect.poll(async () => await readTourCompletedAt()).not.toBeNull();

    // The "Refazer tour" control under Configurações → Ajuda navigates to
    // /dashboard?tour=replay; the dashboard tour leaf reads the flag and starts
    // the tour past the completion gate. Exercise that cross-page replay path.
    await page.goto('/dashboard?tour=replay');
    await expect(page.getByTestId('dashboard-greeting')).toBeVisible({ timeout: 15_000 });

    const popover = page.locator(POPOVER);
    await expect(popover).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(POPOVER_TITLE)).toHaveText(STEP_TITLES[0]);

    // The replay leaf strips the flag from the URL so a refresh does not loop.
    await expect.poll(() => new URL(page.url()).search).toBe('');
  });

  base('the "Refazer tour" control lives under Configurações → Ajuda', async ({ page }) => {
    // The control itself is a plain link to /dashboard?tour=replay (works
    // without client JS); assert it is present and correctly targeted.
    await page.goto('/configuracoes/ajuda/primeiros-passos');
    await expect(page.getByTestId('settings-primeiros-passos-page')).toBeVisible({
      timeout: 10_000,
    });

    const refazer = page.getByTestId('ajuda-refazer-tour');
    await expect(refazer).toBeVisible();
    await expect(refazer).toHaveAttribute('href', '/dashboard?tour=replay');
  });
});
