import { tomorrowInBrt } from '../_shared/brt-date';
import { expect, test } from '../setup/db-fixture';
import { SEED_PATIENTS, SEED_SESSIONS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @agenda -- Edit lock for done sessions E2E test (section 18.2).
 *
 * Flow:
 *   1. Navigate to /agenda and switch to day view on "tomorrow"
 *   2. Click the seeded done session (updated_at 8 days ago) to open the detail drawer
 *   3. Verify that action buttons are replaced by the lock alert
 *      "Sessão bloqueada para edição após 7 dias"
 *   4. Verify no edit or status-change buttons are visible
 *
 * Prerequisites:
 *   - Seeded done session (SEED_SESSIONS.lockedDone) with updated_at 8 days ago.
 *   - storageState provides an authenticated psychologist.
 */
test.describe('@agenda session edit lock', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async ({ db }) => {
    await db.resetSession(SEED_SESSIONS.lockedDone.id, {
      status: 'done',
      updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
  });

  test('shows lock alert for done session older than 7 days', async ({ page }) => {
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

    // Find the seeded done session chip (patient: Joao Santos).
    // There may be two chips for Joao Santos (confirmedForDone and lockedDone).
    // The lockedDone session has status "done", so filter by the done badge.
    const sessionChips = page.getByTestId('session-chip').filter({ hasText: patientName });
    await expect(sessionChips.first()).toBeVisible({ timeout: 10000 });

    // Find the chip with a "Realizada" badge (done status) at 20:00.
    // The time filter disambiguates from other João Santos done chips
    // that may appear when session-mark-done runs in parallel.
    const doneChip = sessionChips.filter({ hasText: '20:00' }).filter({
      has: page.getByTestId('session-status-badge-done'),
    });
    await expect(doneChip).toBeVisible({ timeout: 5000 });
    await doneChip.click();

    const drawer = page.getByTestId('session-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Verify the status badge shows "Realizada" — scoped to the drawer to
    // avoid strict-mode collision with the badge inside the calendar chip.
    await expect(drawer.getByTestId('session-status-badge-done')).toBeVisible();

    // Verify the lock alert is displayed instead of action buttons
    const lockAlert = drawer.getByTestId('session-locked-alert');
    await expect(lockAlert).toBeVisible();
    await expect(lockAlert).toContainText('Sessão bloqueada para edição após 7 dias');

    // Verify that no status-change action buttons are visible.
    // When locked, SessionActionButtons renders the Alert instead of buttons.
    await expect(drawer.getByTestId('session-action-buttons')).toBeHidden();

    // Verify specific action buttons are NOT present
    await expect(drawer.getByTestId('action-btn-mark_done')).toBeHidden();
    await expect(drawer.getByTestId('action-btn-cancel')).toBeHidden();
    await expect(drawer.getByTestId('action-btn-mark_no_show')).toBeHidden();
    await expect(drawer.getByTestId('action-btn-confirm')).toBeHidden();
  });
});
