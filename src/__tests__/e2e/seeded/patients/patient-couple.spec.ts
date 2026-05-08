import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @patients -- Couple patient creation E2E tests.
 *
 * Tests the full creation flow for a couple patient:
 *   1. Navigate to /pacientes/novo
 *   2. Fill step 1 (name, type = "Casal")
 *   3. Verify partner section appears
 *   4. Fill partner data (fullName required)
 *   5. Advance to step 2, skip it
 *   6. Verify redirect to patient detail page
 *   7. Navigate to listing and verify both partners appear
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 */

test.describe('@patients couple patient creation', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('creates a couple patient with partner data and redirects to detail', async ({ page }) => {
    // Navigate to the creation page
    await page.goto('/pacientes/novo');

    // Step 1 form should be visible
    await expect(page.getByTestId('patient-form-step1')).toBeVisible();

    // Fill full name (partner A)
    await page.getByTestId('patient-form-fullname').fill('Carlos Oliveira');

    // Select patient type "Casal" (value: couple)
    await page.getByTestId('patient-form-type').click();
    await page.getByRole('option', { name: 'Casal' }).click();

    // Partner section should now be visible
    await expect(page.getByTestId('partner-section')).toBeVisible();

    // Fill partner B data
    await page.getByTestId('partner-fullname').fill('Fernanda Oliveira');
    await page.getByTestId('partner-phone').fill('11988776655');

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

  test('shows validation error when trying to advance without partner name for couple', async ({
    page,
  }) => {
    await page.goto('/pacientes/novo');

    // Fill required fields for partner A
    await page.getByTestId('patient-form-fullname').fill('Roberto Costa');

    // Select "Casal"
    await page.getByTestId('patient-form-type').click();
    await page.getByRole('option', { name: 'Casal' }).click();

    // Partner section visible but empty
    await expect(page.getByTestId('partner-section')).toBeVisible();

    // Try to advance — should fail because partner fullName is empty
    await page.getByTestId('patient-form-next').click();

    // Should still be on step 1
    await expect(page.getByTestId('patient-form-step1')).toBeVisible();

    // Should show partner validation error
    const errorMessages = page.locator('[role="alert"]');
    await expect(errorMessages.first()).toBeVisible();
  });

  test('verifies both couple partners appear in listing after creation', async ({ page }) => {
    // Create a couple first
    await page.goto('/pacientes/novo');

    await page.getByTestId('patient-form-fullname').fill('Diego Santos');
    await page.getByTestId('patient-form-type').click();
    await page.getByRole('option', { name: 'Casal' }).click();

    await page.getByTestId('partner-fullname').fill('Bianca Santos');

    await page.getByTestId('patient-form-next').click();
    await expect(page.getByTestId('patient-form-step2')).toBeVisible();

    await page.getByTestId('patient-form-skip').click();
    await page.waitForURL(/\/pacientes\/[a-f0-9-]+/, { timeout: 15000 });

    // Navigate to listing
    await page.goto('/pacientes');

    // Both names should appear in the listing
    await expect(page.getByText('Diego Santos')).toBeVisible();
    await expect(page.getByText('Bianca Santos')).toBeVisible();
  });
});
