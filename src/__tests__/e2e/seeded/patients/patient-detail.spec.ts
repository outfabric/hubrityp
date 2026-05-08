import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

test.describe('@patients patient detail page', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  async function navigateToFirstPatient(page: Page) {
    await page.goto('/pacientes');

    const patientList = page.getByTestId('patient-list');
    await expect(patientList).toBeVisible();

    const firstLink = page
      .locator('[data-testid="patient-row"] a, [data-testid="patient-card"]')
      .first();
    await expect(firstLink).toBeVisible();

    await firstLink.click();
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);
  }

  test('header shows patient name and status badge', async ({ page }) => {
    await navigateToFirstPatient(page);

    const header = page.getByTestId('patient-detail-header');
    await expect(header).toBeVisible();

    const name = page.getByTestId('patient-name');
    await expect(name).toBeVisible();
    const nameText = await name.textContent();
    expect(nameText?.trim().length).toBeGreaterThan(0);

    const statusBadge = page.getByTestId('patient-status-badge');
    await expect(statusBadge).toBeVisible();
    const badgeText = await statusBadge.textContent();
    expect(['Ativo', 'Arquivado']).toContain(badgeText?.trim());
  });

  test('header shows tags when patient has tags', async ({ page }) => {
    await navigateToFirstPatient(page);

    const tagsContainer = page.getByTestId('patient-tags');
    const hasTags = await tagsContainer.isVisible().catch(() => false);

    if (hasTags) {
      const badges = tagsContainer.locator('div');
      const count = await badges.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('"Visao geral" tab shows patient data fields', async ({ page }) => {
    await navigateToFirstPatient(page);

    const overviewContent = page.getByTestId('patient-tab-content-overview');
    await expect(overviewContent).toBeVisible();

    const overviewCard = page.getByTestId('patient-overview-card');
    await expect(overviewCard).toBeVisible();

    const patientTypeField = page.getByTestId('patient-field-patient-type');
    await expect(patientTypeField).toBeVisible();

    const createdAtField = page.getByTestId('patient-field-created-at');
    await expect(createdAtField).toBeVisible();
  });

  test('WhatsApp button has correct href when phone exists', async ({ page }) => {
    await navigateToFirstPatient(page);

    const whatsappButton = page.getByTestId('patient-whatsapp-button');
    const hasWhatsapp = await whatsappButton.isVisible().catch(() => false);

    if (hasWhatsapp) {
      const link = whatsappButton.locator('a');
      const href = await link.getAttribute('href');
      expect(href).toMatch(/^https:\/\/wa\.me\/\d+$/);
      expect(href).toContain('https://wa.me/');

      const target = await link.getAttribute('target');
      expect(target).toBe('_blank');
    }
  });

  test('placeholder tabs show "Em breve" message', async ({ page }) => {
    await navigateToFirstPatient(page);

    const tabsList = page.getByTestId('patient-tabs-list');
    await expect(tabsList).toBeVisible();

    const sessionsTab = page.getByTestId('patient-tab-sessions');
    await expect(sessionsTab).toBeVisible();
    await sessionsTab.click();

    const placeholder = page.getByTestId('patient-tab-placeholder-sessions');
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toHaveText('Em breve');

    const financialTab = page.getByTestId('patient-tab-financial');
    await expect(financialTab).toBeVisible();
    await financialTab.click();

    const financialPlaceholder = page.getByTestId('patient-tab-placeholder-financial');
    await expect(financialPlaceholder).toBeVisible();
    await expect(financialPlaceholder).toHaveText('Em breve');
  });

  test('back button navigates to patient list', async ({ page }) => {
    await navigateToFirstPatient(page);

    const backButton = page.getByTestId('patient-detail-back');
    await expect(backButton).toBeVisible();

    await backButton.click();
    await page.waitForURL(/\/pacientes$/);
  });

  test('actions menu contains edit, archive, and delete options', async ({ page }) => {
    await navigateToFirstPatient(page);

    const actionsMenu = page.getByTestId('patient-actions-menu');
    await expect(actionsMenu).toBeVisible();

    await actionsMenu.click();

    const editItem = page.getByTestId('patient-action-edit');
    await expect(editItem).toBeVisible();

    const archiveItem = page.getByTestId('patient-action-archive');
    await expect(archiveItem).toBeVisible();

    const deleteItem = page.getByTestId('patient-action-delete');
    await expect(deleteItem).toBeVisible();
  });
});
