import { expect, test } from '@playwright/test';

import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

test.describe('@patients patient edit and archive', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('edits patient name and shows success toast', async ({ page }) => {
    await page.goto(`/pacientes/${SEED_PATIENTS.activeWithPhone.id}`);
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);

    const actionsMenu = page.getByTestId('patient-actions-menu');
    await actionsMenu.click();

    const editItem = page.getByTestId('patient-action-edit');
    await editItem.click();

    await page.waitForURL(/\/pacientes\/[a-f0-9-]+\/editar$/);
    await expect(page.getByTestId('edit-patient-page-title')).toHaveText('Editar paciente');

    const nameInput = page.getByTestId('patient-form-fullname');
    await expect(nameInput).toBeVisible();
    const currentName = await nameInput.inputValue();
    expect(currentName.length).toBeGreaterThan(0);

    const newName = `${currentName} Editado`;
    await nameInput.fill(newName);

    const nextButton = page.getByTestId('patient-form-next');
    await nextButton.click();

    const saveButton = page.getByTestId('patient-form-save');
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);

    const toastMessage = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'Paciente atualizado' });
    await expect(toastMessage).toBeVisible({ timeout: 5000 });

    const updatedName = page.getByTestId('patient-name');
    await expect(updatedName).toHaveText(newName);
  });

  test('archives patient via confirmation modal', async ({ page }) => {
    await page.goto(`/pacientes/${SEED_PATIENTS.activeMinimal.id}`);
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);

    const statusBadge = page.getByTestId('patient-status-badge');
    await expect(statusBadge).toHaveText('Ativo');

    const patientName = await page.getByTestId('patient-name').textContent();

    const actionsMenu = page.getByTestId('patient-actions-menu');
    await actionsMenu.click();

    const archiveItem = page.getByTestId('patient-action-archive');
    await expect(archiveItem).toHaveText('Arquivar');
    await archiveItem.click();

    const modal = page.getByTestId('archive-confirm-modal');
    await expect(modal).toBeVisible();

    const confirmButton = page.getByTestId('archive-confirm-submit');
    await confirmButton.click();

    await expect(modal).not.toBeVisible({ timeout: 5000 });

    await expect(statusBadge).toHaveText('Arquivado', { timeout: 5000 });

    await page.goto('/pacientes');
    const patientList = page.getByTestId('patient-list');
    const hasList = await patientList.isVisible().catch(() => false);

    if (hasList && patientName) {
      const patientInList = page.locator(`text=${patientName.trim()}`);
      const visible = await patientInList.isVisible().catch(() => false);
      expect(visible).toBe(false);
    }
  });

  test('unarchives patient via detail page action', async ({ page }) => {
    await page.goto(`/pacientes/${SEED_PATIENTS.archived.id}`);
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);

    const statusBadge = page.getByTestId('patient-status-badge');
    await expect(statusBadge).toHaveText('Arquivado');

    const actionsMenu = page.getByTestId('patient-actions-menu');
    await actionsMenu.click();

    const archiveItem = page.getByTestId('patient-action-archive');
    await expect(archiveItem).toHaveText('Desarquivar');
    await archiveItem.click();

    const modal = page.getByTestId('archive-confirm-modal');
    await expect(modal).toBeVisible();

    const confirmButton = page.getByTestId('archive-confirm-submit');
    await confirmButton.click();

    await expect(modal).not.toBeVisible({ timeout: 5000 });

    await expect(statusBadge).toHaveText('Ativo', { timeout: 5000 });
  });
});
