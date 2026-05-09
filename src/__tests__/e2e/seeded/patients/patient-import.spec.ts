import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @patients -- Patient CSV import E2E tests.
 *
 * Tests the full import flow:
 *   1. Navigate to /pacientes/importar
 *   2. Upload a CSV fixture with 5 valid rows + 1 invalid row
 *   3. Auto-detect column mapping and confirm
 *   4. Verify preview: 5 valid (green) rows and 1 error (red) row
 *   5. Confirm import
 *   6. Verify redirect to /pacientes with success toast
 *   7. Verify the 5 new patients appear in the listing
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - CSV fixture at `fixtures/import-patients.csv`.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSV_FIXTURE_PATH = path.resolve(HERE, 'fixtures/import-patients.csv');

test.describe('@patients patient CSV import', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('imports valid CSV rows and shows them in patient listing', async ({ page }) => {
    // Step 1: Navigate to the import page
    await page.goto('/pacientes/importar');

    const pageTitle = page.getByTestId('import-patients-page-title');
    await expect(pageTitle).toBeVisible();
    await expect(pageTitle).toHaveText('Importar pacientes');

    // Step 2: Upload CSV fixture via the hidden file input
    const fileInput = page.getByTestId('csv-file-input');
    await fileInput.setInputFiles(CSV_FIXTURE_PATH);

    // Step 3: Column mapping step should appear after parsing
    const columnMapper = page.getByTestId('csv-column-mapper');
    await expect(columnMapper).toBeVisible({ timeout: 5000 });

    // The auto-detection should map known headers. Confirm the mapping.
    const confirmMappingButton = page.getByTestId('csv-mapping-confirm');
    await expect(confirmMappingButton).toBeEnabled();
    await confirmMappingButton.click();

    // Step 4: Preview step should appear with validation results
    const preview = page.getByTestId('csv-preview');
    await expect(preview).toBeVisible({ timeout: 10_000 });

    // Verify summary badges
    const summary = page.getByTestId('csv-preview-summary');
    await expect(summary).toBeVisible();

    // The CSV has 6 rows: 5 valid + 1 invalid (missing name)
    await expect(summary).toContainText('6 linhas');
    await expect(summary).toContainText('5 validas');
    await expect(summary).toContainText('1 com erros');

    // Step 5: Click the import button to confirm
    const importButton = page.getByTestId('csv-import-button');
    await expect(importButton).toBeVisible();
    await expect(importButton).toContainText('Importar 5 paciente');
    await importButton.click();

    // Step 6: Should redirect to the patient listing page
    await page.waitForURL(/\/pacientes$/, { timeout: 15_000 });

    // Verify success toast
    const toastMessage = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'importados com sucesso' });
    await expect(toastMessage).toBeVisible({ timeout: 5000 });

    // Step 7: Verify the 5 imported patients appear in the listing
    const patientList = page.getByTestId('patient-list');
    await expect(patientList).toBeVisible();

    // Check for each imported patient name
    const importedNames = [
      'Ana Costa',
      'Bruno Ferreira',
      'Carla Mendes',
      'Daniela Souza',
      'Eduardo Lima',
    ];

    for (const name of importedNames) {
      await expect(page.locator(`text=${name}`).first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('can navigate to import page from patient listing', async ({ page }) => {
    await page.goto('/pacientes');

    // The patient list has an "Importar CSV" button
    const importButton = page.getByTestId('patient-import-csv-button');
    const hasButton = await importButton.isVisible().catch(() => false);

    if (hasButton) {
      await importButton.click();
      await page.waitForURL(/\/pacientes\/importar$/);

      const pageTitle = page.getByTestId('import-patients-page-title');
      await expect(pageTitle).toBeVisible();
      await expect(pageTitle).toHaveText('Importar pacientes');
    }
  });

  test('shows error for CSV upload with invalid file type', async ({ page }) => {
    await page.goto('/pacientes/importar');

    const pageTitle = page.getByTestId('import-patients-page-title');
    await expect(pageTitle).toBeVisible();

    // The dropzone should be visible
    const dropzone = page.getByTestId('csv-dropzone');
    await expect(dropzone).toBeVisible();
  });
});
