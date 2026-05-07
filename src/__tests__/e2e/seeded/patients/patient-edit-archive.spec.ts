import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @patients -- Patient edit, archive, and unarchive E2E tests.
 *
 * Tests:
 *   1. Edit a patient (change name), verify toast "Paciente atualizado"
 *   2. Archive a patient via confirmation modal, verify it leaves the default list
 *   3. Unarchive the patient via the detail page action
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - At least one patient must exist in the database.
 */

test.describe('@patients patient edit and archive', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  /**
   * Helper: navigate to the first patient's detail page via the listing.
   */
  async function navigateToFirstPatient(page: Page): Promise<string | null> {
    await page.goto('/pacientes');

    const patientList = page.getByTestId('patient-list');
    const emptyState = page.getByTestId('patient-list-empty');

    const hasList = await patientList.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    if (hasEmpty || !hasList) {
      return null;
    }

    // Click on the first patient link
    const firstLink = page
      .locator('[data-testid="patient-row"] a, [data-testid="patient-card"]')
      .first();
    const hasLink = await firstLink.isVisible().catch(() => false);
    if (!hasLink) return null;

    await firstLink.click();
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);
    return page.url();
  }

  test('edits patient name and shows success toast', async ({ page }) => {
    const url = await navigateToFirstPatient(page);
    if (!url) {
      test.skip(true, 'No patients in database to test edit');
      return;
    }

    // Open actions menu and click Edit
    const actionsMenu = page.getByTestId('patient-actions-menu');
    await actionsMenu.click();

    const editItem = page.getByTestId('patient-action-edit');
    await editItem.click();

    // Wait for edit page
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+\/editar$/);
    await expect(page.getByTestId('edit-patient-page-title')).toHaveText('Editar paciente');

    // Verify form is pre-filled with the patient name
    const nameInput = page.getByTestId('patient-form-fullname');
    await expect(nameInput).toBeVisible();
    const currentName = await nameInput.inputValue();
    expect(currentName.length).toBeGreaterThan(0);

    // Change the name
    const newName = `${currentName} Editado`;
    await nameInput.fill(newName);

    // Click "Proximo" to go to step 2
    const nextButton = page.getByTestId('patient-form-next');
    await nextButton.click();

    // Click "Salvar" on step 2
    const saveButton = page.getByTestId('patient-form-save');
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // Wait for redirect back to detail page
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);

    // Verify the toast appeared
    const toastMessage = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'Paciente atualizado' });
    await expect(toastMessage).toBeVisible({ timeout: 5000 });

    // Verify the name was updated
    const updatedName = page.getByTestId('patient-name');
    await expect(updatedName).toHaveText(newName);
  });

  test('archives patient via confirmation modal', async ({ page }) => {
    const url = await navigateToFirstPatient(page);
    if (!url) {
      test.skip(true, 'No patients in database to test archive');
      return;
    }

    // Ensure patient is currently active
    const statusBadge = page.getByTestId('patient-status-badge');
    const status = await statusBadge.textContent();
    if (status?.trim() !== 'Ativo') {
      test.skip(true, 'First patient is not active — cannot test archive');
      return;
    }

    // Get patient name for verification
    const patientName = await page.getByTestId('patient-name').textContent();

    // Open actions menu and click "Arquivar"
    const actionsMenu = page.getByTestId('patient-actions-menu');
    await actionsMenu.click();

    const archiveItem = page.getByTestId('patient-action-archive');
    await expect(archiveItem).toHaveText('Arquivar');
    await archiveItem.click();

    // Verify the archive confirmation modal appears
    const modal = page.getByTestId('archive-confirm-modal');
    await expect(modal).toBeVisible();

    // Click "Arquivar" to confirm
    const confirmButton = page.getByTestId('archive-confirm-submit');
    await confirmButton.click();

    // Wait for modal to close and status to update
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Status badge should change to "Arquivado"
    await expect(statusBadge).toHaveText('Arquivado', { timeout: 5000 });

    // Navigate to listing and verify patient is not in default (active) list
    await page.goto('/pacientes');
    const patientList = page.getByTestId('patient-list');
    const hasList = await patientList.isVisible().catch(() => false);

    if (hasList && patientName) {
      // The archived patient should not appear in the active list
      const patientInList = page.locator(`text=${patientName.trim()}`);
      const visible = await patientInList.isVisible().catch(() => false);
      // If the listing filters by status=active, the patient should not be visible
      // (This depends on whether listing defaults to active only)
      expect(visible).toBe(false);
    }
  });

  test('unarchives patient via detail page action', async ({ page }) => {
    // Navigate to listing — we need to find an archived patient
    await page.goto('/pacientes');

    // Try navigating to the first patient (which we archived in the previous test)
    // In a real scenario, we'd filter for archived patients. For now, navigate
    // directly to the previously archived patient.
    const url = await navigateToFirstPatient(page);
    if (!url) {
      test.skip(true, 'No patients available for unarchive test');
      return;
    }

    // Check if this patient is archived
    const statusBadge = page.getByTestId('patient-status-badge');
    const status = await statusBadge.textContent();
    if (status?.trim() !== 'Arquivado') {
      test.skip(true, 'First patient is not archived — cannot test unarchive');
      return;
    }

    // Open actions menu — should show "Desarquivar"
    const actionsMenu = page.getByTestId('patient-actions-menu');
    await actionsMenu.click();

    const archiveItem = page.getByTestId('patient-action-archive');
    await expect(archiveItem).toHaveText('Desarquivar');
    await archiveItem.click();

    // Verify the archive confirmation modal appears (same modal, unarchive action)
    const modal = page.getByTestId('archive-confirm-modal');
    await expect(modal).toBeVisible();

    // Click confirm
    const confirmButton = page.getByTestId('archive-confirm-submit');
    await confirmButton.click();

    // Wait for modal to close
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Status should change back to "Ativo"
    await expect(statusBadge).toHaveText('Ativo', { timeout: 5000 });
  });
});
