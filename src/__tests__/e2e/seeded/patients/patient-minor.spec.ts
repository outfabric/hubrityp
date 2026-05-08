import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @patients -- Minor patient creation with guardian E2E tests.
 *
 * Tests the full creation flow for a child/adolescent patient:
 *   1. Navigate to /pacientes/novo
 *   2. Fill step 1 (name, type = "Crianca")
 *   3. Verify guardian section appears
 *   4. Add a guardian with all required fields
 *   5. Advance to step 2, skip it
 *   6. Verify redirect to the patient detail page
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 */

test.describe('@patients minor patient creation with guardian', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('creates a child patient with 1 guardian and redirects to detail', async ({ page }) => {
    // Navigate to the creation page
    await page.goto('/pacientes/novo');

    // Step 1 form should be visible
    await expect(page.getByTestId('patient-form-step1')).toBeVisible();

    // Fill full name
    await page.getByTestId('patient-form-fullname').fill('Lucas Mendes');

    // Select patient type "Crianca" (value: child)
    await page.getByTestId('patient-form-type').click();
    await page.getByRole('option', { name: 'Criança' }).click();

    // Guardian section should now be visible
    await expect(page.getByTestId('guardians-section')).toBeVisible();

    // Click "Adicionar responsavel" to add the first guardian
    await page.getByTestId('add-guardian-btn').click();

    // Guardian card should appear
    await expect(page.getByTestId('guardian-card-0')).toBeVisible();

    // Fill guardian fields
    await page.getByTestId('guardian-0-fullname').fill('Ana Mendes');
    await page.getByTestId('guardian-0-relationship').fill('Mae');
    await page.getByTestId('guardian-0-phone').fill('11999887766');

    // Click "Proximo" to advance to step 2
    await page.getByTestId('patient-form-next').click();

    // Step 2 form should now be visible
    await expect(page.getByTestId('patient-form-step2')).toBeVisible();

    // Skip step 2
    await page.getByTestId('patient-form-skip').click();

    // Wait for navigation — should redirect to /pacientes/<id>
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+/, { timeout: 15000 });

    // Verify we are on a patient detail page
    const url = page.url();
    expect(url).toMatch(/\/pacientes\/[a-f0-9-]+/);
  });

  test('shows validation error when trying to advance without guardian for child', async ({
    page,
  }) => {
    await page.goto('/pacientes/novo');

    // Fill required fields
    await page.getByTestId('patient-form-fullname').fill('Pedro Silva');

    // Select "Crianca"
    await page.getByTestId('patient-form-type').click();
    await page.getByRole('option', { name: 'Criança' }).click();

    // Guardian section visible but no guardian added
    await expect(page.getByTestId('guardians-section')).toBeVisible();

    // Try to advance — should fail with validation error
    await page.getByTestId('patient-form-next').click();

    // Should still be on step 1
    await expect(page.getByTestId('patient-form-step1')).toBeVisible();

    // Should show guardian validation error
    const errorMessages = page.locator('[role="alert"]');
    await expect(errorMessages.first()).toBeVisible();
  });

  test('add guardian button is disabled at 2 guardians', async ({ page }) => {
    await page.goto('/pacientes/novo');

    // Fill name and select child type
    await page.getByTestId('patient-form-fullname').fill('Maria Crianca');
    await page.getByTestId('patient-form-type').click();
    await page.getByRole('option', { name: 'Criança' }).click();

    // Add first guardian
    await page.getByTestId('add-guardian-btn').click();
    await expect(page.getByTestId('guardian-card-0')).toBeVisible();

    // Add second guardian
    await page.getByTestId('add-guardian-btn').click();
    await expect(page.getByTestId('guardian-card-1')).toBeVisible();

    // Add button should be disabled
    await expect(page.getByTestId('add-guardian-btn')).toBeDisabled();
  });
});
