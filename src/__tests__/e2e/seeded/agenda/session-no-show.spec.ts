import { expect, test } from '@playwright/test';

import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

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
 *   - Seeded scheduled session (SEED_SESSIONS.forNoShow) at 15:00 BRT tomorrow.
 *   - storageState provides an authenticated psychologist.
 *
 * Note: The `forNoShow` session uses the same patient (Maria Silva) as
 * `cancellable`, but at a different time (15:00 vs 10:00 BRT). We filter
 * by "Agendada" badge and take the last scheduled chip (later time).
 */
test.describe('@agenda session no-show', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('marks a scheduled session as no-show and verifies badge', async ({ page }) => {
    const patientName = SEED_PATIENTS.activeWithPhone.fullName;

    // Navigate to the agenda page
    await page.goto('/agenda');
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();

    // Switch to day view and navigate to tomorrow
    await page.getByTestId('agenda-view-toggle').getByText('Dia').click();
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();

    // Find scheduled session chips for Maria Silva. There may be two
    // (cancellable at 10:00 and forNoShow at 15:00). Filter by "Agendada"
    // badge and pick the last one (later time = forNoShow at 15:00).
    // If the cancel test already ran (parallel), the cancellable session
    // will have "Cancelada" badge and only forNoShow will match.
    const scheduledChips = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ has: page.getByTestId('session-status-badge-scheduled') });
    await expect(scheduledChips.first()).toBeVisible({ timeout: 10000 });

    const targetChip = (await scheduledChips.count()) > 1 ? scheduledChips.last() : scheduledChips;
    await targetChip.click();

    const drawer = page.getByTestId('session-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Verify the status badge shows "Agendada" before marking no-show (scoped to drawer)
    await expect(drawer.getByTestId('session-status-badge-scheduled')).toBeVisible();

    // Click "Marcar como falta" action button
    await drawer.getByTestId('action-btn-mark_no_show').click();

    // Verify the success toast appeared
    await expect(page.getByText('Sessao marcada como falta')).toBeVisible({ timeout: 5000 });

    // The drawer closes after mutation. Wait for calendar refresh, then re-navigate.
    await page.waitForTimeout(1000);
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();

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
