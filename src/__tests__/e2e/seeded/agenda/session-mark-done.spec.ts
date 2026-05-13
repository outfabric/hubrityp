import { tomorrowInBrt } from '../_shared/brt-date';
import { expect, test } from '../setup/db-fixture';
import { SEED_PATIENTS, SEED_SESSIONS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @agenda -- Mark session as done E2E test (section 17.2).
 *
 * Flow:
 *   1. Navigate to /agenda and switch to day view on "tomorrow"
 *   2. Click the seeded confirmed session to open the detail drawer
 *   3. Click "Marcar como realizada" action button
 *   4. Verify the session badge changes to "Realizada"
 *   5. Verify the history shows "Marcada como realizada em [date]"
 *
 * Prerequisites:
 *   - Seeded confirmed session (SEED_SESSIONS.confirmedForDone) at 11:00 BRT tomorrow.
 *   - storageState provides an authenticated psychologist.
 */
test.describe('@agenda mark session as done', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async ({ db }) => {
    await db.resetSession(SEED_SESSIONS.confirmedForDone.id, {
      status: 'confirmed',
      confirmedAt: new Date(),
    });
  });

  test('marks a confirmed session as done and verifies badge + history', async ({ page }) => {
    const patientName = SEED_PATIENTS.activeMinimal.fullName;

    // Navigate to the agenda page
    await page.goto('/agenda');
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();

    // Switch to day view and navigate to tomorrow.
    // Wait for the period title to reflect tomorrow's date before asserting
    // on session chips — avoids a race where FullCalendar hasn't re-rendered yet.
    const tomorrowDay = String(tomorrowInBrt().getDate());
    await page.getByTestId('agenda-view-toggle').getByText('Dia').click();
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();
    await expect(page.getByTestId('agenda-period-title')).toContainText(
      new RegExp(`\\b${tomorrowDay}\\b`),
      { timeout: 10000 },
    );

    // Find the seeded confirmed session chip (patient: Joao Santos).
    // There are two Joao Santos sessions: confirmedForDone (confirmed, 11:00)
    // and lockedDone (done, 16:00). Filter by the "Confirmada" badge.
    const confirmedChips = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ has: page.getByTestId('session-status-badge-confirmed') });
    await expect(confirmedChips.first()).toBeVisible({ timeout: 10000 });
    await confirmedChips.first().click();

    const drawer = page.getByTestId('session-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Verify the status badge shows "Confirmada" before marking done (scoped to drawer)
    await expect(drawer.getByTestId('session-status-badge-confirmed')).toBeVisible();

    // Click "Marcar como realizada" action button
    await drawer.getByTestId('action-btn-mark_done').click();

    // Verify the success toast appeared
    await expect(page.getByText('Sessao marcada como realizada')).toBeVisible({ timeout: 5000 });

    // The drawer closes after mutation. Wait for calendar refresh, then re-navigate.
    await page.waitForTimeout(1000);
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();
    await expect(page.getByTestId('agenda-period-title')).toContainText(
      new RegExp(`\\b${tomorrowDay}\\b`),
      { timeout: 10000 },
    );

    // Find the session chip again — now it should have "Realizada" badge.
    // The confirmedForDone session is at 11:00 BRT, so it appears first among
    // the Joao Santos chips. Use the done badge to identify it.
    const doneChips = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ has: page.getByTestId('session-status-badge-done') });
    // There may now be two done chips (confirmedForDone turned done + lockedDone).
    // Pick the first one (earlier time = 11:00 = the one we just marked done).
    await expect(doneChips.first()).toBeVisible({ timeout: 10000 });
    await doneChips.first().click();

    // Re-open the detail drawer
    const reopenedDrawer = page.getByTestId('session-detail-drawer');
    await expect(reopenedDrawer).toBeVisible({ timeout: 5000 });

    // Verify the status badge now shows "Realizada" (scoped to drawer)
    await expect(reopenedDrawer.getByTestId('session-status-badge-done')).toBeVisible();

    // Verify the history section shows the "Marcada como realizada" entry
    const historyList = reopenedDrawer.getByTestId('session-history-list');
    await expect(historyList).toBeVisible({ timeout: 5000 });
    await expect(historyList).toContainText('Marcada como realizada em');
  });
});
