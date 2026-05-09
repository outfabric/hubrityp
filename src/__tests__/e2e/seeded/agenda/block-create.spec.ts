import { expect, test } from '@playwright/test';

import { STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @agenda -- Time block creation E2E tests.
 *
 * Tests the full blocking slot creation flow:
 *   1. Navigate to /agenda
 *   2. Click "Bloquear horario" button
 *   3. Fill the title "Almoco"
 *   4. Pick a date and time (12:00)
 *   5. Select duration (60 min)
 *   6. Click "Bloquear"
 *   7. Verify the block appears on the calendar grid with Lock icon
 *     and dashed border styling
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 */

test.describe('@agenda block creation', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('creates a blocking slot via modal and verifies it on the calendar', async ({ page }) => {
    // Navigate to the agenda page
    await page.goto('/agenda');

    // Verify the page loaded
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();

    // Click the "Bloquear horario" button
    await page.getByTestId('block-time-button').click();

    // The block form modal should appear
    await expect(page.getByTestId('block-form-modal')).toBeVisible();

    // Fill the title
    const titleInput = page.getByTestId('block-form-title');
    await expect(titleInput).toBeVisible();
    await titleInput.fill('Almoco');

    // The date should be pre-selected to today. Click the trigger to verify
    // and ensure today is selected.
    const dateTrigger = page.getByTestId('block-form-date-trigger');
    await expect(dateTrigger).toBeVisible();
    // The date trigger should already show today's date. We click it to open
    // the calendar and select today explicitly.
    await dateTrigger.click();
    const calendar = page.getByTestId('block-form-calendar');
    if (await calendar.isVisible().catch(() => false)) {
      const todayButton = page.locator('.rdp-today button, button[aria-selected="true"]').first();
      if (await todayButton.isVisible().catch(() => false)) {
        await todayButton.click();
      }
    }

    // Select start time: 12:00
    const startTimeSelect = page.getByTestId('block-form-start-time');
    await startTimeSelect.click();
    await page.getByRole('option', { name: '12:00' }).click();

    // Select duration: 60 min (default is already 60, but set explicitly)
    const durationSelect = page.getByTestId('block-form-duration');
    await durationSelect.click();
    await page.getByRole('option', { name: '60 min' }).click();

    // Verify the computed end time
    const endTime = page.getByTestId('block-form-end-time');
    await expect(endTime).toContainText('13:00');

    // Click "Bloquear" to create the blocking slot
    await page.getByTestId('block-form-save').click();

    // Wait for the modal to close
    await expect(page.getByTestId('block-form-modal')).toBeHidden({ timeout: 10000 });

    // Verify a success toast appeared
    await expect(page.getByText('Horario bloqueado com sucesso.')).toBeVisible({ timeout: 5000 });

    // Verify the block appears on the calendar.
    // Blocking slots use data-testid="session-chip-blocking" in day/week view.
    const blockChip = page
      .getByTestId('session-chip-blocking')
      .filter({ hasText: 'Almoco' })
      .first();
    await expect(blockChip).toBeVisible({ timeout: 10000 });

    // Verify the block chip has a Lock icon (the Lock SVG inside)
    const lockIcon = blockChip.locator('svg');
    await expect(lockIcon).toBeVisible();

    // Verify the dashed border styling (the component uses `border-dashed` class)
    await expect(blockChip).toHaveClass(/border-dashed/);

    // Verify the title text is displayed
    await expect(blockChip).toContainText('Almoco');
  });
});
