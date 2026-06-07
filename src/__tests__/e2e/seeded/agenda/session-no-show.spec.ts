import { tomorrowInBrt } from '../_shared/brt-date';
import { expect, test } from '../setup/db-fixture';
import { SEED_PATIENTS, SEED_SESSIONS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @agenda -- Mark session as no-show E2E test (section 18.1).
 *
 * Flow:
 *   1. Navigate to /agenda and switch to day view on "tomorrow"
 *   2. Click the seeded scheduled session to open the detail drawer
 *   3. Click "Marcar como falta" action button
 *   4. Verify the session badge changes to "Falta" (warning)
 *   5. Verify no cancellation fields are shown in the detail
 *
 * Prerequisites:
 *   - Seeded scheduled session (SEED_SESSIONS.forNoShow) at 09:00 BRT tomorrow.
 *   - storageState provides an authenticated psychologist.
 *
 * Note: The `forNoShow` session uses the same patient (Maria Silva) as
 * `cancellable`, but at a different time (09:00 vs 10:00 BRT). We filter
 * by "Agendada" badge and time text to pick the correct chip.
 */
test.describe('@agenda session no-show', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async ({ db }) => {
    await db.resetSession(SEED_SESSIONS.forNoShow.id, { status: 'scheduled' });
  });

  test('marks a scheduled session as no-show and verifies badge', async ({ page }) => {
    const patientName = SEED_PATIENTS.activeWithPhone.fullName;

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

    // Find the forNoShow session chip for Maria Silva at 09:00.
    // Filter by patient name, "Agendada" badge, and time text to
    // disambiguate from the cancellable session at 10:00.
    const targetChip = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ hasText: /(?<!\d)9:00/ })
      .filter({ has: page.getByTestId('session-status-badge-scheduled') });
    await expect(targetChip).toBeVisible({ timeout: 10000 });
    await targetChip.click();

    const drawer = page.getByTestId('session-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Verify the status badge shows "Agendada" before marking no-show (scoped to drawer)
    await expect(drawer.getByTestId('session-status-badge-scheduled')).toBeVisible();

    // Click "Marcar como falta" action button
    await drawer.getByTestId('action-btn-mark_no_show').click();

    // Verify the success toast appeared
    await expect(page.getByText('Sessão marcada como falta')).toBeVisible({ timeout: 5000 });

    // The drawer closes after mutation. Wait for calendar refresh, then re-navigate.
    await page.waitForTimeout(1000);
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();
    await expect(page.getByTestId('agenda-period-title')).toContainText(
      new RegExp(`\\b${tomorrowDay}\\b`),
      { timeout: 10000 },
    );

    // Find the session chip again — now it should have "Falta" badge.
    const noShowChip = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ has: page.getByTestId('session-status-badge-no_show') });
    await expect(noShowChip).toBeVisible({ timeout: 10000 });
    await noShowChip.click();

    // Re-open the detail drawer
    const reopenedDrawer = page.getByTestId('session-detail-drawer');
    await expect(reopenedDrawer).toBeVisible({ timeout: 5000 });

    // Verify the status badge now shows "Falta" (warning variant, scoped to drawer)
    await expect(reopenedDrawer.getByTestId('session-status-badge-no_show')).toBeVisible();

    // Verify no cancellation-related fields are shown in the detail.
    // The cancel dialog should NOT be open, and the cancel action button
    // should NOT be available for no_show sessions (only "Cobrar falta" is).
    await expect(page.getByTestId('cancel-session-dialog')).toBeHidden();
    await expect(reopenedDrawer.getByTestId('action-btn-cancel')).toBeHidden();
  });
});
