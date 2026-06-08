import { test as base, expect } from '@playwright/test';

import { signInAsDedicatedUser } from '../_shared/dedicated-user-auth';
import { test } from '../setup/db-fixture';
import { SEED_OVERDUE_EVOLUTIONS_USER } from '../setup/seed-state';

/**
 * @agenda -- Overdue-evolutions list E2E coverage (section 6, PRD §9 / §12).
 *
 * Exercises the `/agenda?filtro=sem-evolucao` list-mode destination end to end:
 *   6.1 Dashboard "Ver" (sessões sem evolução) → list (not the calendar); items
 *       oldest-first; chip count matches the dashboard pendência count.
 *   6.2 "Registrar evolução" href is
 *       `/pacientes/{patientId}/prontuario/evolucoes/nova?sessionId={sessionId}`
 *       and opens that session's evolution-create page.
 *   6.3 Resolve flow: register an evolution for a listed session → return to the
 *       list → that row is gone and the count decremented (RF-12.10).
 *   6.4 Remove chip → URL drops `filtro`, calendar returns; unknown `?filtro=xyz`
 *       → calendar, no error (RF-12.16); empty set → "Tudo em dia. 🎉" positive
 *       state with a link to the full agenda.
 *   6.5 Negative-auth: anonymous `/agenda?filtro=sem-evolucao` → `/login`.
 *
 * All authenticated cases drive a DEDICATED user (SEED_OVERDUE_EVOLUTIONS_USER)
 * that owns exactly three overdue-without-evolution sessions plus two excluded
 * controls (one inside the 7-day window, one already evolved). Using a dedicated
 * user keeps the count/ordering deterministic under `fullyParallel` and lets the
 * resolve test create/delete an evolution without touching shared seed data.
 */

const USER = SEED_OVERDUE_EVOLUTIONS_USER;
const PATIENT = USER.patient;
const SESSIONS = USER.sessions;

const LIST_URL = '/agenda?filtro=sem-evolucao';

// ---------------------------------------------------------------------------
// Authenticated cases — dedicated overdue-evolutions user
// ---------------------------------------------------------------------------

test.describe('@agenda overdue-evolutions list (authenticated)', () => {
  // Every test mutates the SAME dedicated user's clinical rows (the resolve test
  // inserts/deletes an evolution). The seeded suite runs `fullyParallel`, but
  // these all run on one worker; serial mode + a per-test reset keeps the
  // overdue set deterministic without a cross-worker lock.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context, request, db }) => {
    // Guarantee a clean overdue set on the reused container: the only evolution
    // for this user should be the seeded control on `oldDoneEvolved`. Drop any
    // evolution a previous resolve run left on the three overdue sessions so the
    // anti-join keeps counting them.
    await db.sql`
      DELETE FROM public.evolutions
      WHERE user_id = ${USER.id}
        AND session_id IN (
          ${SESSIONS.overdueOldest.id},
          ${SESSIONS.overdueMiddle.id},
          ${SESSIONS.overdueNewest.id}
        );
    `;

    await signInAsDedicatedUser(context, request, USER);
  });

  test('dashboard "Ver" opens the list (not the calendar), oldest-first, count matches', async ({
    page,
  }) => {
    // Read the dashboard pendência count for this user — the list header count
    // must match it structurally (RF-12.18).
    await page.goto('/dashboard');
    const overdueRow = page.getByTestId('dashboard-pendencias-row-overdue-evolutions');
    await expect(overdueRow).toBeVisible();
    await expect(overdueRow).toContainText('3');
    await expect(overdueRow).toContainText('sessões sem evolução');

    // Follow the row's "Ver" deep-link.
    await page.getByTestId('dashboard-pendencias-link-overdue-evolutions').click();
    await page.waitForURL('**/agenda?filtro=sem-evolucao');

    // The LIST renders, NOT the calendar (the calendar toolbar's
    // `schedule-button` must be absent in list mode).
    const list = page.getByTestId('overdue-evolutions-list');
    await expect(list).toBeVisible();
    await expect(page.getByTestId('schedule-button')).toHaveCount(0);

    // Header count and chip count both equal the dashboard count (3).
    await expect(list).toContainText('Sessões sem evolução');
    await expect(list).toContainText('(3)');
    await expect(page.getByTestId('overdue-evolutions-filter-chip')).toContainText('Sem evolução');
    await expect(page.getByTestId('overdue-evolutions-filter-chip')).toContainText('3');

    // Three rows, oldest-first. The 30-day row carries "há 30 dias", etc.
    const rows = page.getByTestId('overdue-evolution-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('há 30 dias');
    await expect(rows.nth(1)).toContainText('há 20 dias');
    await expect(rows.nth(2)).toContainText('há 10 dias');

    // The excluded controls never surface (recent + already-evolved).
    await expect(list).not.toContainText('há 2 dias');
    await expect(list).not.toContainText('há 25 dias');
  });

  test('"Registrar evolução" CTA links to the session-scoped create page and opens it', async ({
    page,
  }) => {
    await page.goto(LIST_URL);

    // The newest overdue row is the third row; assert its CTA href is the
    // session-scoped evolution-create URL (RF-12.08).
    const ctas = page.getByTestId('overdue-evolution-cta');
    await expect(ctas).toHaveCount(3);

    const expectedHref = `/pacientes/${PATIENT.id}/prontuario/evolucoes/nova?sessionId=${SESSIONS.overdueNewest.id}`;
    await expect(ctas.nth(2)).toHaveAttribute('href', expectedHref);

    // Following it opens that session's evolution-create page.
    await ctas.nth(2).click();
    await page.waitForURL(`**${expectedHref}`);
    await expect(page.getByTestId('nova-evolucao-page-title')).toHaveText('Nova evolução');
  });

  test('resolving a listed session removes its row and decrements the count', async ({
    page,
    db,
  }) => {
    await page.goto(LIST_URL);
    await expect(page.getByTestId('overdue-evolution-row')).toHaveCount(3);

    // Register an evolution for the newest overdue session. Driving the full
    // auto-save editor is covered by prontuario/evolution-crud.spec.ts; here we
    // assert the LIST's resolve-and-decrement contract (RF-12.10), so we create
    // the evolution directly against this user's own rows (the same write the
    // create action performs) and return to the list.
    await db.sql`
      INSERT INTO public.evolutions (user_id, patient_id, session_id, template_type, content)
      VALUES (
        ${USER.id},
        ${PATIENT.id},
        ${SESSIONS.overdueNewest.id},
        'livre',
        ${'{"text":"Evolucao registrada pelo fluxo de resolucao"}'}::jsonb
      );
    `;

    // Return to the list. The page is a Server Component reading the live
    // overdue set, so a fresh navigation re-queries: the resolved row is gone
    // and the count is now 2.
    await page.goto(LIST_URL);

    const rows = page.getByTestId('overdue-evolution-row');
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('overdue-evolutions-list')).toContainText('(2)');
    await expect(page.getByTestId('overdue-evolutions-filter-chip')).toContainText('2');

    // The resolved (newest) session's CTA no longer appears.
    const resolvedHref = `/pacientes/${PATIENT.id}/prontuario/evolucoes/nova?sessionId=${SESSIONS.overdueNewest.id}`;
    await expect(
      page.locator(`[data-testid="overdue-evolution-cta"][href="${resolvedHref}"]`),
    ).toHaveCount(0);

    // The two older sessions remain.
    await expect(rows.nth(0)).toContainText('há 30 dias');
    await expect(rows.nth(1)).toContainText('há 20 dias');
  });

  test('removing the chip drops `filtro` and brings the calendar back', async ({ page }) => {
    await page.goto(LIST_URL);
    await expect(page.getByTestId('overdue-evolutions-list')).toBeVisible();

    await page.getByTestId('overdue-evolutions-filter-remove').click();

    // URL drops the `filtro` param entirely → bare /agenda.
    await page.waitForURL((url) => url.pathname === '/agenda' && !url.search.includes('filtro'));
    expect(new URL(page.url()).searchParams.get('filtro')).toBeNull();

    // The calendar (default view) returns: its toolbar button renders, the list
    // is gone. The calendar is a dynamic(ssr:false) component, so allow it to
    // mount.
    await expect(page.getByTestId('schedule-button')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('overdue-evolutions-list')).toHaveCount(0);
  });

  test('an unknown `?filtro=xyz` falls back to the calendar without error', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/agenda?filtro=xyz');

    // The page title always renders; an unrecognized filter is treated as the
    // default (calendar) view (RF-12.16) — the list must NOT render.
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();
    await expect(page.getByTestId('schedule-button')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('overdue-evolutions-list')).toHaveCount(0);

    // No client-side runtime error surfaced from the unknown param.
    expect(pageErrors).toEqual([]);
  });

  test('an empty overdue set shows the positive "Tudo em dia. 🎉" state', async ({ page, db }) => {
    // Resolve all three overdue sessions for this user so the set is empty. We
    // restore them in afterEach (the beforeEach DELETE also covers retries).
    await db.sql`
      INSERT INTO public.evolutions (user_id, patient_id, session_id, template_type, content)
      VALUES
        (${USER.id}, ${PATIENT.id}, ${SESSIONS.overdueOldest.id}, 'livre', ${'{"text":"x"}'}::jsonb),
        (${USER.id}, ${PATIENT.id}, ${SESSIONS.overdueMiddle.id}, 'livre', ${'{"text":"x"}'}::jsonb),
        (${USER.id}, ${PATIENT.id}, ${SESSIONS.overdueNewest.id}, 'livre', ${'{"text":"x"}'}::jsonb);
    `;

    await page.goto(LIST_URL);

    const empty = page.getByTestId('overdue-evolutions-empty-state');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('Tudo em dia. 🎉');

    // The positive state links to the full agenda, never the calendar unexplained.
    const viewAgenda = page.getByTestId('overdue-evolutions-view-agenda');
    await expect(viewAgenda).toBeVisible();
    // The button is wrapped by a Next.js <Link> rendering <a href="/agenda">.
    await expect(empty.locator('a[href="/agenda"]')).toBeVisible();

    // No rows, no chip in the empty state.
    await expect(page.getByTestId('overdue-evolution-row')).toHaveCount(0);
    await expect(page.getByTestId('overdue-evolutions-filter-chip')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Negative-auth — anonymous access (case 6.5)
// ---------------------------------------------------------------------------

base.describe('@agenda overdue-evolutions list (anonymous)', () => {
  // No storageState — a fully anonymous browser context.
  base('anonymous /agenda?filtro=sem-evolucao redirects to /login', async ({ page }) => {
    await page.goto(LIST_URL);

    await page.waitForURL('**/login**', { timeout: 10_000 });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    // The middleware preserves the original destination (path + query) for the
    // post-login return.
    expect(url.searchParams.get('redirectTo')).toBe('/agenda?filtro=sem-evolucao');
  });
});
