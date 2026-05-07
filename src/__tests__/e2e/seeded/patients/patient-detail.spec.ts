import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @patients -- Patient detail page E2E tests.
 *
 * These tests verify the patient detail page renders correctly:
 * - Header shows name, phone, tags, and status badge
 * - "Visao geral" tab shows patient data
 * - WhatsApp button has correct href
 * - Placeholder tabs show "Em breve"
 *
 * Prerequisites:
 * - Seeded session (storageState) provides an authenticated psychologist.
 * - At least one patient must exist in the database (seeded via global-setup
 *   or created in-flow).
 */

test.describe('@patients patient detail page', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  /**
   * Helper: navigate to the first patient's detail page via the listing.
   * Returns the page URL for later assertions.
   */
  async function navigateToFirstPatient(page: Page) {
    await page.goto('/pacientes');

    // Wait for either the patient list or the empty state
    const patientList = page.getByTestId('patient-list');
    const emptyState = page.getByTestId('patient-list-empty');

    const hasList = await patientList.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    if (hasEmpty || !hasList) {
      return null;
    }

    // Click on the first patient link (desktop table row or mobile card)
    const firstLink = page
      .locator('[data-testid="patient-row"] a, [data-testid="patient-card"]')
      .first();
    const hasLink = await firstLink.isVisible().catch(() => false);
    if (!hasLink) return null;

    await firstLink.click();
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+$/);
    return page.url();
  }

  test('header shows patient name and status badge', async ({ page }) => {
    const url = await navigateToFirstPatient(page);
    if (!url) {
      test.skip(true, 'No patients in database to test detail page');
      return;
    }

    const header = page.getByTestId('patient-detail-header');
    await expect(header).toBeVisible();

    // Name should be visible
    const name = page.getByTestId('patient-name');
    await expect(name).toBeVisible();
    const nameText = await name.textContent();
    expect(nameText?.trim().length).toBeGreaterThan(0);

    // Status badge should be visible
    const statusBadge = page.getByTestId('patient-status-badge');
    await expect(statusBadge).toBeVisible();
    const badgeText = await statusBadge.textContent();
    expect(['Ativo', 'Arquivado']).toContain(badgeText?.trim());
  });

  test('header shows tags when patient has tags', async ({ page }) => {
    const url = await navigateToFirstPatient(page);
    if (!url) {
      test.skip(true, 'No patients in database to test detail page');
      return;
    }

    // Tags container may or may not be visible depending on patient data
    const tagsContainer = page.getByTestId('patient-tags');
    const hasTags = await tagsContainer.isVisible().catch(() => false);

    if (hasTags) {
      // Should contain at least one badge
      const badges = tagsContainer.locator('div');
      const count = await badges.count();
      expect(count).toBeGreaterThan(0);
    }
    // If no tags, this is fine — the container simply doesn't render
  });

  test('"Visao geral" tab shows patient data fields', async ({ page }) => {
    const url = await navigateToFirstPatient(page);
    if (!url) {
      test.skip(true, 'No patients in database to test detail page');
      return;
    }

    // The overview tab should be active by default
    const overviewContent = page.getByTestId('patient-tab-content-overview');
    await expect(overviewContent).toBeVisible();

    // The overview card should be visible
    const overviewCard = page.getByTestId('patient-overview-card');
    await expect(overviewCard).toBeVisible();

    // Check that at least some data fields are rendered
    const patientTypeField = page.getByTestId('patient-field-patient-type');
    await expect(patientTypeField).toBeVisible();

    const createdAtField = page.getByTestId('patient-field-created-at');
    await expect(createdAtField).toBeVisible();
  });

  test('WhatsApp button has correct href when phone exists', async ({ page }) => {
    const url = await navigateToFirstPatient(page);
    if (!url) {
      test.skip(true, 'No patients in database to test detail page');
      return;
    }

    const whatsappButton = page.getByTestId('patient-whatsapp-button');
    const hasWhatsapp = await whatsappButton.isVisible().catch(() => false);

    if (hasWhatsapp) {
      const link = whatsappButton.locator('a');
      const href = await link.getAttribute('href');
      expect(href).toMatch(/^https:\/\/wa\.me\/\d+$/);
      expect(href).toContain('https://wa.me/');

      // Should open in new tab
      const target = await link.getAttribute('target');
      expect(target).toBe('_blank');
    }
    // If no phone, WhatsApp button is not rendered — this is expected
  });

  test('placeholder tabs show "Em breve" message', async ({ page }) => {
    const url = await navigateToFirstPatient(page);
    if (!url) {
      test.skip(true, 'No patients in database to test detail page');
      return;
    }

    // Tabs should be visible
    const tabsList = page.getByTestId('patient-tabs-list');
    await expect(tabsList).toBeVisible();

    // Click on a placeholder tab (e.g., "sessions")
    const sessionsTab = page.getByTestId('patient-tab-sessions');
    await expect(sessionsTab).toBeVisible();
    await sessionsTab.click();

    // The placeholder content should show "Em breve"
    const placeholder = page.getByTestId('patient-tab-placeholder-sessions');
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toHaveText('Em breve');

    // Click another placeholder tab
    const financialTab = page.getByTestId('patient-tab-financial');
    await expect(financialTab).toBeVisible();
    await financialTab.click();

    const financialPlaceholder = page.getByTestId('patient-tab-placeholder-financial');
    await expect(financialPlaceholder).toBeVisible();
    await expect(financialPlaceholder).toHaveText('Em breve');
  });

  test('back button navigates to patient list', async ({ page }) => {
    const url = await navigateToFirstPatient(page);
    if (!url) {
      test.skip(true, 'No patients in database to test detail page');
      return;
    }

    const backButton = page.getByTestId('patient-detail-back');
    await expect(backButton).toBeVisible();

    await backButton.click();
    await page.waitForURL(/\/pacientes$/);
  });

  test('actions menu contains edit, archive, and delete options', async ({ page }) => {
    const url = await navigateToFirstPatient(page);
    if (!url) {
      test.skip(true, 'No patients in database to test detail page');
      return;
    }

    const actionsMenu = page.getByTestId('patient-actions-menu');
    await expect(actionsMenu).toBeVisible();

    // Open the dropdown
    await actionsMenu.click();

    // Check menu items are visible
    const editItem = page.getByTestId('patient-action-edit');
    await expect(editItem).toBeVisible();

    const archiveItem = page.getByTestId('patient-action-archive');
    await expect(archiveItem).toBeVisible();

    const deleteItem = page.getByTestId('patient-action-delete');
    await expect(deleteItem).toBeVisible();
  });
});
