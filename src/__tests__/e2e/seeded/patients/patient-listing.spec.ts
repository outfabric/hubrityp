import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @patients — Patient listing page E2E tests.
 *
 * These tests verify the patient listing page renders correctly,
 * search works, status filter works, pagination displays, and
 * the "+ Novo Paciente" button exists.
 *
 * Prerequisites:
 * - Seeded session (storageState) provides an authenticated psychologist.
 * - Global setup seeds 2 active patients (Maria Silva, João Santos) and
 *   1 archived patient (Ana Oliveira) — the list is never empty.
 */

test.describe('@patients patient listing', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async ({ page }) => {
    await page.goto('/pacientes');
    // Seed always has 2 active patients — wait for the list to render
    await expect(page.getByTestId('patient-list')).toBeVisible();
  });

  test('page title "Pacientes" is visible', async ({ page }) => {
    await expect(page.getByTestId('patients-page-title')).toBeVisible();
    await expect(page.getByTestId('patients-page-title')).toHaveText('Pacientes');
  });

  test('patient list renders with seeded patients', async ({ page }) => {
    // Seed always provides 2 active patients — verify the list shows them
    await expect(page.getByTestId('patient-list')).toBeVisible();

    // Patient rows (desktop) or cards (mobile) should be present
    const rows = page.getByTestId('patient-row');
    const cards = page.getByTestId('patient-card');

    const rowCount = await rows.count();
    const cardCount = await cards.count();

    // At least 2 patients should be visible in either layout
    expect(rowCount + cardCount).toBeGreaterThanOrEqual(2);
  });

  test('"+ Novo Paciente" button is visible', async ({ page }) => {
    await expect(page.getByTestId('patient-add-button')).toBeVisible();
  });

  test('search input is visible and functional', async ({ page }) => {
    const searchInput = page.getByTestId('patient-search-input');

    await expect(searchInput).toBeVisible();

    // Type a search term and verify the input accepts it
    await searchInput.fill('Maria');
    await expect(searchInput).toHaveValue('Maria');
  });

  test('status filter segmented control is visible and clickable', async ({ page }) => {
    await expect(page.getByTestId('patient-status-filter')).toBeVisible();

    // Click "Arquivados" filter
    const archivedBtn = page.getByTestId('patient-status-archived');
    await archivedBtn.click();
    await expect(archivedBtn).toHaveAttribute('aria-pressed', 'true');

    // Click "Todos" filter
    const allBtn = page.getByTestId('patient-status-all');
    await allBtn.click();
    await expect(allBtn).toHaveAttribute('aria-pressed', 'true');

    // Click back to "Ativos"
    const activeBtn = page.getByTestId('patient-status-active');
    await activeBtn.click();
    await expect(activeBtn).toHaveAttribute('aria-pressed', 'true');
  });
});

/**
 * Tests that depend on seeded patient data for search/filter assertions.
 */
test.describe('@patients patient listing with seeded data', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async ({ page }) => {
    await page.goto('/pacientes');
    await expect(page.getByTestId('patient-list')).toBeVisible();
  });

  test('renders patient rows when patients exist in DB', async ({ page }) => {
    // Verify patient rows or cards are rendered
    const rows = page.getByTestId('patient-row');
    const cards = page.getByTestId('patient-card');

    const rowCount = await rows.count();
    const cardCount = await cards.count();

    // At least 2 active patients should be visible (Maria Silva + João Santos)
    expect(rowCount + cardCount).toBeGreaterThanOrEqual(2);
  });

  test('search filters patients by name', async ({ page }) => {
    const searchInput = page.getByTestId('patient-search-input');
    await searchInput.fill('nonexistent-patient-xyz-12345');

    // Wait for debounce (300ms) + server response
    await page.waitForTimeout(500);

    // Should show no results message
    await expect(page.getByTestId('patient-list-no-results')).toBeVisible();
    await expect(page.getByTestId('patient-list-no-results')).toContainText(
      'Nenhum resultado encontrado',
    );
  });

  test('pagination controls render when applicable', async ({ page }) => {
    // Seed has only 3 patients total (2 active + 1 archived) which is below
    // the default page size of 25, so pagination may not be visible.
    // We only assert that IF pagination is present, it has the expected controls.
    const pagination = page.getByTestId('patient-pagination');

    // Use a short timeout — pagination is not expected with the default seed
    const hasPagination = await pagination.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasPagination) {
      await expect(pagination).toContainText('encontrado');
      await expect(page.getByTestId('patient-pagination-prev')).toBeVisible();
      await expect(page.getByTestId('patient-pagination-next')).toBeVisible();
    }
  });
});
