/**
 * Patient session-history tab — seeded E2E (PRD §13, section 10.1).
 *
 * Drives the dedicated `SEED_SESSION_HISTORY_USER` (a psychologist touched by no
 * other spec) so every count-, ordering- and pagination-sensitive assertion is
 * deterministic under `fullyParallel`. The user owns:
 *   - `withHistory` — 14 `done` (1 evolved, 1 couple) + 1 cancelled (patient) +
 *     1 no_show + 1 future `scheduled` → a 16-row history list (page size 12) and
 *     an 88% attendance rate.
 *   - `noHistory` — no sessions → empty state.
 *
 * Covers (10.1):
 *   - open the tab → summary strip (realized total + attendance rate) + grouped
 *     list (month dividers + cards),
 *   - apply the "Realizadas" status filter → list updates,
 *   - "Carregar mais" appends a page,
 *   - "Registrar" (done w/o evolution) and "Ver" (done w/ evolution) CTAs link to
 *     the correct evolution URLs,
 *   - couple session shows the "Sessão de casal" tag with NO partner data,
 *   - empty-state CTA goes to `/agenda`,
 *   - "Abrir na agenda" deep-links with `?focusSession=`.
 */

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { signInAsDedicatedUser } from '../_shared/dedicated-user-auth';
import { SEED_SESSION_HISTORY_USER } from '../setup/seed-state';

const USER = SEED_SESSION_HISTORY_USER;
const WITH_HISTORY = USER.patients.withHistory;
const NO_HISTORY = USER.patients.noHistory;
const PARTNER = USER.patients.partnerHidden;

/**
 * Opens a patient's detail page and switches to the session-history tab, waiting
 * for the container (data already loaded) to be visible. Returns nothing — the
 * page is left on the active sessions tab.
 */
async function openSessionHistoryTab(page: Page, patientId: string): Promise<void> {
  await page.goto(`/pacientes/${patientId}`);
  await expect(page.getByTestId('patient-detail-header')).toBeVisible();

  await page.getByTestId('patient-tab-sessions').click();
}

/**
 * Locator for the cards INSIDE the historical list only. The nearest-future
 * session is rendered as its own `session-history-card` in the separate
 * "Próxima sessão" section (always visible, outside the filter), so scoping to
 * the `session-history-list` container is what makes the historical counts
 * deterministic.
 */
function historyCards(page: Page) {
  return page.getByTestId('session-history-list').getByTestId('session-history-card');
}

test.describe('@patients patient session history', () => {
  test.beforeEach(async ({ context, request }) => {
    // Sign in as the dedicated session-history user (not the shared seed user).
    await signInAsDedicatedUser(context, request, USER);
  });

  test('opens the tab and shows the summary strip + grouped list', async ({ page }) => {
    await openSessionHistoryTab(page, WITH_HISTORY.id);

    const container = page.getByTestId('patient-session-history');
    await expect(container).toBeVisible();

    // Summary strip: realized total and attendance rate are both present.
    const summary = page.getByTestId('session-history-summary-strip');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(String(USER.counts.doneTotal));
    await expect(summary).toContainText(`${USER.counts.attendanceRate}%`);

    // The grouped historical list renders with at least one month divider.
    const list = page.getByTestId('session-history-list');
    await expect(list).toBeVisible();
    await expect(page.getByTestId('month-divider').first()).toBeVisible();

    // First page renders exactly `pageSize` historical cards (16 history rows
    // > 12). The future session's own card lives outside the list container.
    await expect(historyCards(page)).toHaveCount(USER.pageSize);
  });

  test('applies a status filter and updates the list', async ({ page }) => {
    await openSessionHistoryTab(page, WITH_HISTORY.id);
    await expect(page.getByTestId('patient-session-history')).toBeVisible();

    // Default view: the first page shows `pageSize` historical cards.
    await expect(historyCards(page)).toHaveCount(USER.pageSize);

    // "Canceladas" narrows the loaded list (client-side selector below the
    // hybrid threshold) to the single patient-cancelled session loaded on the
    // first page — proving the chip re-renders the list filtered by status.
    await page.getByRole('button', { name: 'Canceladas' }).click();

    await expect(historyCards(page)).toHaveCount(USER.counts.cancelledByPatient);
    // The cancelled card surfaces its cancellation details (RN-13.06).
    await expect(page.getByTestId('cancellation-details').first()).toBeVisible();

    // Switching back to "Todas" restores the full first page (no refetch needed,
    // the cache is shared across filters below the threshold).
    await page.getByRole('button', { name: 'Todas' }).click();
    await expect(historyCards(page)).toHaveCount(USER.pageSize);
  });

  test('"Carregar mais" appends the next page', async ({ page }) => {
    await openSessionHistoryTab(page, WITH_HISTORY.id);
    await expect(page.getByTestId('patient-session-history')).toBeVisible();

    const cards = historyCards(page);
    await expect(cards).toHaveCount(USER.pageSize);

    const loadMore = page.getByTestId('load-more-button');
    await expect(loadMore).toBeVisible();
    await loadMore.click();

    // The remaining 4 rows are appended; the button disappears once exhausted.
    await expect(cards).toHaveCount(USER.counts.historyTotal);
    await expect(loadMore).toHaveCount(0);
  });

  test('done sessions expose the correct "Registrar" / "Ver" evolution URLs', async ({ page }) => {
    await openSessionHistoryTab(page, WITH_HISTORY.id);
    await expect(page.getByTestId('patient-session-history')).toBeVisible();

    // Filter to "Realizadas" so every visible card is a `done` session.
    await page.getByRole('button', { name: 'Realizadas' }).click();
    await expect(page.getByTestId('session-history-card').first()).toBeVisible();

    // The evolved session shows "Evolução registrada" + a "Ver" link pointing at
    // the evolution detail URL.
    const verLink = page.getByRole('link', { name: 'Ver' }).first();
    await expect(verLink).toBeVisible();
    await expect(verLink).toHaveAttribute(
      'href',
      `/pacientes/${WITH_HISTORY.id}/prontuario/evolucoes/${USER.sessions.doneEvolved.evolutionId}`,
    );

    // The done-without-evolution sessions show "Registrar" linking to the new
    // evolution route, pre-filled with the session id.
    const registrarLink = page.getByRole('link', { name: 'Registrar' }).first();
    await expect(registrarLink).toBeVisible();
    const href = await registrarLink.getAttribute('href');
    expect(href).toMatch(
      new RegExp(
        `^/pacientes/${WITH_HISTORY.id}/prontuario/evolucoes/nova\\?sessionId=[0-9a-f-]+$`,
      ),
    );
  });

  test('couple session shows the "Sessão de casal" tag with no partner data', async ({ page }) => {
    await openSessionHistoryTab(page, WITH_HISTORY.id);
    await expect(page.getByTestId('patient-session-history')).toBeVisible();

    // The couple tag is present somewhere in the (paginated) list. Load every
    // page so the couple card is guaranteed rendered regardless of its position.
    const loadMore = page.getByTestId('load-more-button');
    while (await loadMore.isVisible().catch(() => false)) {
      await loadMore.click();
      await expect(loadMore).toHaveCount(0);
    }
    await expect(historyCards(page)).toHaveCount(USER.counts.historyTotal);

    await expect(page.getByTestId('tag-couple').first()).toBeVisible();

    // The partner's NAME must NEVER surface (couple-safe projection, LGPD-13.03).
    await expect(page.getByText(PARTNER.fullName)).toHaveCount(0);
  });

  test('"Abrir na agenda" deep-links to the focused future session', async ({ page }) => {
    await openSessionHistoryTab(page, WITH_HISTORY.id);
    await expect(page.getByTestId('patient-session-history')).toBeVisible();

    const openInAgenda = page.getByTestId('open-in-agenda');
    await expect(openInAgenda).toBeVisible();
    await expect(openInAgenda).toHaveAttribute(
      'href',
      `/agenda?focusSession=${USER.sessions.future.id}`,
    );

    await openInAgenda.click();

    await page.waitForURL(`**/agenda?focusSession=${USER.sessions.future.id}`);
    // The deep-link opens the focused session's detail drawer on arrival.
    await expect(page.getByTestId('session-detail-drawer')).toBeVisible();
  });

  test('empty state shows the schedule CTA pointing to /agenda', async ({ page }) => {
    await openSessionHistoryTab(page, NO_HISTORY.id);

    const empty = page.getByTestId('session-history-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('Nenhuma sessão registrada');

    const cta = page.getByTestId('schedule-first-session');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/agenda');

    await cta.click();
    await page.waitForURL('**/agenda');
    expect(new URL(page.url()).pathname).toBe('/agenda');
  });
});
