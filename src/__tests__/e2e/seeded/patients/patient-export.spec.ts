import { expect, test } from '@playwright/test';

import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @patients -- Patient PDF export E2E tests.
 *
 * Tests the full export flow:
 *   1. Navigate to patient detail page
 *   2. Open the actions dropdown menu
 *   3. Click "Exportar PDF"
 *   4. Confirm in the export modal (without clinical data)
 *   5. Verify that a PDF download is triggered
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - Seeded patients exist in the database (global-setup.ts).
 */

test.describe('@patients patient PDF export', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('exports patient PDF without clinical data via actions menu', async ({ page }) => {
    // Navigate to a seeded patient detail page
    await page.goto(`/pacientes/${SEED_PATIENTS.activeWithPhone.id}`);
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);

    // Verify we are on the detail page
    const patientName = page.getByTestId('patient-name');
    await expect(patientName).toBeVisible();

    // Open the actions dropdown menu
    const actionsMenu = page.getByTestId('patient-actions-menu');
    await expect(actionsMenu).toBeVisible();
    await actionsMenu.click();

    // Click "Exportar PDF" menu item
    const exportItem = page.getByTestId('patient-action-export-pdf');
    await expect(exportItem).toBeVisible();
    await exportItem.click();

    // Export confirmation modal should be visible
    const modal = page.getByTestId('export-confirm-modal');
    await expect(modal).toBeVisible();

    // The clinical data checkbox should be unchecked by default
    const clinicalCheckbox = page.getByTestId('export-include-clinical-checkbox');
    await expect(clinicalCheckbox).toBeVisible();
    await expect(clinicalCheckbox).not.toBeChecked();

    // The secrecy warning should NOT be visible (since checkbox is unchecked)
    const secrecyWarning = page.getByTestId('export-secrecy-warning');
    await expect(secrecyWarning).not.toBeVisible();

    // Set up download listener BEFORE clicking confirm so we catch the download
    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });

    // Click the export confirm button
    const confirmButton = page.getByTestId('export-confirm-submit');
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // Verify that a download was triggered
    const download = await downloadPromise;
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/\.pdf$/);

    // Verify success toast
    const toastMessage = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'PDF exportado com sucesso' });
    await expect(toastMessage).toBeVisible({ timeout: 5000 });
  });

  test('shows secrecy warning when clinical data checkbox is checked', async ({ page }) => {
    await page.goto(`/pacientes/${SEED_PATIENTS.activeWithPhone.id}`);
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);

    // Open actions menu and click export
    const actionsMenu = page.getByTestId('patient-actions-menu');
    await actionsMenu.click();

    const exportItem = page.getByTestId('patient-action-export-pdf');
    await exportItem.click();

    // Modal should be visible
    const modal = page.getByTestId('export-confirm-modal');
    await expect(modal).toBeVisible();

    // Check the clinical data checkbox
    const clinicalCheckbox = page.getByTestId('export-include-clinical-checkbox');
    await clinicalCheckbox.click();

    // Secrecy warning should now be visible
    const secrecyWarning = page.getByTestId('export-secrecy-warning');
    await expect(secrecyWarning).toBeVisible();
    await expect(secrecyWarning).toContainText('dados clinicos sao sigilosos');
  });

  test('cancel button closes the export modal without downloading', async ({ page }) => {
    await page.goto(`/pacientes/${SEED_PATIENTS.activeWithPhone.id}`);
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);

    // Open actions menu and click export
    const actionsMenu = page.getByTestId('patient-actions-menu');
    await actionsMenu.click();

    const exportItem = page.getByTestId('patient-action-export-pdf');
    await exportItem.click();

    // Modal should be visible
    const modal = page.getByTestId('export-confirm-modal');
    await expect(modal).toBeVisible();

    // Click cancel
    const cancelButton = page.getByTestId('export-confirm-cancel');
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });
});
