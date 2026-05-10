import { expect, test } from '@playwright/test';

import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @agenda -- Session cancellation E2E test (section 17.1).
 *
 * Flow:
 *   1. Navigate to /agenda and switch to day view on "tomorrow"
 *   2. Click the seeded scheduled session to open the detail drawer
 *   3. Click "Cancelar sessao" action button
 *   4. Fill the cancellation dialog (reason, who cancelled, charge switch)
 *   5. Submit
 *   6. Verify the session badge changes to "Cancelada"
 *   7. Verify the history section shows the cancellation entry
 *
 * Prerequisites:
 *   - Seeded scheduled session (SEED_SESSIONS.cancellable) at 10:00 BRT tomorrow.
 *   - storageState provides an authenticated psychologist.
 */
test.describe('@agenda session cancellation', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('cancels a scheduled session via dialog and verifies badge + history', async ({ page }) => {
    const patientName = SEED_PATIENTS.activeWithPhone.fullName;

    // Navigate to the agenda page
    await page.goto('/agenda');
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();

    // Switch to day view and navigate to tomorrow (where seeded sessions live)
    await page.getByTestId('agenda-view-toggle').getByText('Dia').click();
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();

    // Find the cancellable session chip for Maria Silva at 19:00.
    // Filter by patient name, time text, and "Agendada" badge to
    // disambiguate from the forNoShow session at 09:00.
    const cancellableChip = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ hasText: '19:00' })
      .filter({ has: page.getByTestId('session-status-badge-scheduled') });
    await expect(cancellableChip).toBeVisible({ timeout: 10000 });
    await cancellableChip.click();

    const drawer = page.getByTestId('session-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Verify the status badge shows "Agendada" before cancellation (scoped to drawer)
    await expect(drawer.getByTestId('session-status-badge-scheduled')).toBeVisible();

    // Click the "Cancelar sessao" action button
    await drawer.getByTestId('action-btn-cancel').click();

    // The cancellation dialog should appear
    const cancelDialog = page.getByTestId('cancel-session-dialog');
    await expect(cancelDialog).toBeVisible({ timeout: 5000 });

    // Fill the cancellation form:
    // 1. Select reason: "Paciente cancelou"
    await page.getByTestId('cancel-reason-select').click();
    await page.getByRole('option', { name: 'Paciente cancelou' }).click();

    // 2. Select who cancelled: "Paciente"
    const cancelledByRadio = page.getByTestId('cancel-cancelled-by');
    await cancelledByRadio.getByLabel('Paciente').click();

    // 3. Enable charge cancellation
    await page.getByTestId('cancel-charge-switch').click();

    // Submit the cancellation form
    await page.getByTestId('cancel-dialog-confirm').click();

    // Wait for the dialog to close (success path)
    await expect(cancelDialog).toBeHidden({ timeout: 10000 });

    // Verify the toast appeared (cancellation uses toast.error with "Sessao cancelada")
    await expect(page.getByText('Sessao cancelada')).toBeVisible({ timeout: 5000 });

    // The drawer closes after mutation (onSessionMutated closes it).
    // Wait for the calendar to re-fetch, then re-navigate to tomorrow.
    await page.waitForTimeout(1000);
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();

    // Find the cancelled session chip (renders with opacity-50 but still visible).
    // Filter by the "Cancelada" badge to find the correct one.
    const cancelledChip = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ has: page.getByTestId('session-status-badge-cancelled') });
    await expect(cancelledChip).toBeVisible({ timeout: 10000 });
    await cancelledChip.click();

    // Re-open the detail drawer
    const reopenedDrawer = page.getByTestId('session-detail-drawer');
    await expect(reopenedDrawer).toBeVisible({ timeout: 5000 });

    // Verify the status badge now shows "Cancelada" (scoped to drawer)
    await expect(reopenedDrawer.getByTestId('session-status-badge-cancelled')).toBeVisible();

    // Verify the history section shows a cancellation entry
    const historyList = reopenedDrawer.getByTestId('session-history-list');
    await expect(historyList).toBeVisible({ timeout: 5000 });
    await expect(historyList).toContainText('Cancelada');
  });
});
