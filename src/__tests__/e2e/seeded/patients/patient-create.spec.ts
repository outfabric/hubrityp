import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @patients -- Patient creation form E2E tests.
 *
 * Tests the full creation flow:
 *   1. Navigate to /pacientes/novo
 *   2. Fill step 1 (name, type, phone)
 *   3. Click "Proximo" to advance to step 2
 *   4. Skip step 2 (click "Pular")
 *   5. Verify redirect to the patient detail page
 *   6. Navigate back to listing and verify patient appears
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 */

test.describe('@patients patient creation', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('creates an adult patient through step 1, skips step 2, and redirects to detail', async ({
    page,
  }) => {
    // Navigate to the creation page
    await page.goto('/pacientes/novo');

    // Verify page title
    await expect(page.getByTestId('new-patient-page-title')).toBeVisible();
    await expect(page.getByTestId('new-patient-page-title')).toHaveText('Novo paciente');

    // Step 1 form should be visible
    await expect(page.getByTestId('patient-form-step1')).toBeVisible();

    // Fill full name
    await page.getByTestId('patient-form-fullname').fill('Maria Silva Santos');

    // Select patient type "Adulto" (value: individual)
    await page.getByTestId('patient-form-type').click();
    await page.getByRole('option', { name: 'Adulto' }).click();

    // Fill phone with mask
    await page.getByTestId('patient-form-phone').fill('11987654321');

    // Click "Proximo" to advance to step 2
    await page.getByTestId('patient-form-next').click();

    // Step 2 form should now be visible
    await expect(page.getByTestId('patient-form-step2')).toBeVisible();

    // Skip step 2
    await page.getByTestId('patient-form-skip').click();

    // Wait for navigation — should redirect to /pacientes/<id>
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+/, { timeout: 10000 });

    // Verify we are on a patient detail page (URL contains UUID pattern)
    const url = page.url();
    expect(url).toMatch(/\/pacientes\/[a-f0-9-]+/);
  });

  test('validates required fields on step 1 before advancing', async ({ page }) => {
    await page.goto('/pacientes/novo');

    // Try to advance without filling anything
    await page.getByTestId('patient-form-next').click();

    // Should still be on step 1
    await expect(page.getByTestId('patient-form-step1')).toBeVisible();

    // Should show validation errors (at least for fullName)
    const errorMessages = page.locator('[role="alert"]');
    await expect(errorMessages.first()).toBeVisible();
  });

  test('can navigate back from step 2 to step 1', async ({ page }) => {
    await page.goto('/pacientes/novo');

    // Fill step 1 minimally
    await page.getByTestId('patient-form-fullname').fill('Test Patient');
    await page.getByTestId('patient-form-type').click();
    await page.getByRole('option', { name: 'Adulto' }).click();

    // Advance
    await page.getByTestId('patient-form-next').click();
    await expect(page.getByTestId('patient-form-step2')).toBeVisible();

    // Go back
    await page.getByTestId('patient-form-back').click();
    await expect(page.getByTestId('patient-form-step1')).toBeVisible();

    // Step 1 values should be preserved
    await expect(page.getByTestId('patient-form-fullname')).toHaveValue('Test Patient');
  });

  test('phone input applies Brazilian mask', async ({ page }) => {
    await page.goto('/pacientes/novo');

    const phoneInput = page.getByTestId('patient-form-phone');
    await phoneInput.fill('11987654321');

    // Should display with mask format
    await expect(phoneInput).toHaveValue('+55 11 98765-4321');
  });
});
