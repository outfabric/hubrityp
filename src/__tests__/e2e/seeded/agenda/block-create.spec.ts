import { expect, test } from '@playwright/test';
import { format } from 'date-fns';

import { nowInBrt, tomorrowInBrt } from '../_shared/brt-date';
import { STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @agenda -- Time block creation E2E tests.
 *
 * Tests the full blocking slot creation flow:
 *   1. Navigate to /agenda
 *   2. Click "Bloquear horario" button
 *   3. Fill the title "Almoco"
 *   4. Pick tomorrow's date and time (12:00)
 *   5. Select duration (60 min)
 *   6. Click "Bloquear"
 *   7. Navigate to tomorrow's date on the calendar
 *   8. Verify the block appears on the calendar grid with Lock icon
 *      and dashed border styling
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 */

test.describe('@agenda block creation', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('creates a blocking slot via modal and verifies it on the calendar', async ({ page }) => {
    // Use tomorrow in BRT to guarantee the date is always in the future
    // and aligned with the browser's timezone (America/Sao_Paulo).
    const tomorrow = tomorrowInBrt();
    const tomorrowDay = format(tomorrow, 'd');

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

    // Select tomorrow's date in the calendar popover.
    // The modal defaults to today; we open the popover and pick tomorrow
    // to ensure the block is always in the future.
    const dateTrigger = page.getByTestId('block-form-date-trigger');
    await expect(dateTrigger).toBeVisible();
    await dateTrigger.click();

    // The Calendar component passes data-testid to DayPicker's root.
    // We scope the day button search to the popover content to avoid
    // matching the nav bar calendar or tab buttons.
    const calendarPopover = page.locator('[data-radix-popper-content-wrapper]').first();
    await expect(calendarPopover).toBeVisible();

    // If tomorrow is in the next month, navigate forward.
    if (tomorrow.getMonth() !== nowInBrt().getMonth()) {
      await calendarPopover.locator('button[name="next-month"]').click();
    }

    // Click the day button for tomorrow. In react-day-picker v9, each day
    // cell renders a <button> inside a <td>. We match by the text content
    // (the day number) scoped within the calendar grid.
    const dayButton = calendarPopover
      .locator('table button')
      .filter({ hasText: new RegExp(`^${tomorrowDay}$`) })
      .first();
    await dayButton.click();

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

    // Navigate to tomorrow's date. Switch to day view, click "Hoje" to
    // land on today (BRT), then click "next" once to advance one day.
    // This avoids the week-view "next" which jumps a full week and may
    // skip past tomorrow depending on the current day-of-week.
    await page.getByTestId('agenda-view-toggle').getByText('Dia').click();
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();

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
