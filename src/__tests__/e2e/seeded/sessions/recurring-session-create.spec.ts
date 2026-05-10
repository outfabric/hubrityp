import { expect, test } from '@playwright/test';
import { addWeeks, format } from 'date-fns';

import { nowInBrt, tomorrowInBrt } from '../_shared/brt-date';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @sessions -- Recurring session creation E2E test.
 *
 * Tests the full recurring session scheduling flow:
 *   1. Navigate to /agenda
 *   2. Click "+ Agendar" button
 *   3. Search and select a patient
 *   4. Pick tomorrow's date and a time (15:00)
 *   5. Check "Sessao recorrente"
 *   6. Select "Semanal" frequency
 *   7. Select a day-of-week matching tomorrow
 *   8. Select "Data especifica" end condition with date 4 weeks out
 *   9. Submit
 *  10. Navigate the calendar to verify 4 sessions on consecutive weeks
 *  11. Verify each session shows the Repeat icon indicator
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - Patients are seeded in globalSetup (SEED_PATIENTS).
 */

test.describe('@sessions recurring session creation', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // Increase timeout — this test creates recurring sessions and navigates 4 weeks
  test.setTimeout(60_000);

  test('creates a weekly recurring session for 4 weeks and verifies all sessions appear', async ({
    page,
  }) => {
    // Use tomorrow in BRT to guarantee the date is always in the future
    // and aligned with the browser's timezone (America/Sao_Paulo).
    const tomorrow = tomorrowInBrt();
    const tomorrowDay = format(tomorrow, 'd');
    const tomorrowDayOfWeek = tomorrow.getDay(); // 0=Sun ... 6=Sat

    // End date: 3 weeks after tomorrow (so start + 3 = 4 total weekly occurrences)
    const endDate = addWeeks(tomorrow, 3);

    // Navigate to the agenda page
    await page.goto('/agenda');
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();
    await expect(page.getByTestId('agenda-page-title')).toHaveText('Agenda');

    // Click the "+ Agendar" button to open the session form modal
    await page.getByTestId('schedule-button').click();
    await expect(page.getByTestId('session-form-modal')).toBeVisible();

    // Search for the seeded patient by name
    const patientName = SEED_PATIENTS.activeWithPhone.fullName;
    const patientSearch = page.getByTestId('session-form-patient-search');
    await expect(patientSearch).toBeVisible();
    await patientSearch.fill(patientName);

    // Wait for search results to appear
    const patientResults = page.getByTestId('session-form-patient-results');
    await expect(patientResults).toBeVisible({ timeout: 5000 });

    // Select the patient from the dropdown
    const patientOption = page.getByTestId(`patient-option-${SEED_PATIENTS.activeWithPhone.id}`);
    await expect(patientOption).toBeVisible({ timeout: 10000 });
    await patientOption.click();

    // Select tomorrow's date in the calendar popover
    const dateTrigger = page.getByTestId('session-form-date-trigger');
    await expect(dateTrigger).toBeVisible();
    await dateTrigger.click();

    const calendarPopover = page.locator('[data-radix-popper-content-wrapper]').first();
    await expect(calendarPopover).toBeVisible();

    // If tomorrow is in the next month (in BRT), navigate forward
    if (tomorrow.getMonth() !== nowInBrt().getMonth()) {
      await calendarPopover.locator('button[name="next-month"]').click();
    }

    const dayButton = calendarPopover
      .locator('table button')
      .filter({ hasText: new RegExp(`^${tomorrowDay}$`) })
      .first();
    await dayButton.click();

    // Select start time: 15:00 (unique to avoid conflicts with other parallel tests)
    const startTimeSelect = page.getByTestId('session-form-start-time');
    await startTimeSelect.click();
    await page.getByRole('option', { name: '15:00' }).click();

    // Select duration: 50 min
    const durationSelect = page.getByTestId('session-form-duration');
    await durationSelect.click();
    await page.getByRole('option', { name: '50 min' }).click();

    // Check "Sessao recorrente" to reveal recurrence options
    const recurrenceToggle = page.getByTestId('recurrence-toggle');
    await expect(recurrenceToggle).toBeVisible();
    await recurrenceToggle.click();

    // Wait for the recurrence section to expand
    const recurrenceSection = page.getByTestId('recurrence-section');
    await expect(recurrenceSection).toBeVisible();

    // Select "Semanal" frequency
    const weeklyRadio = page.getByTestId('freq-weekly');
    await expect(weeklyRadio).toBeVisible();
    await weeklyRadio.click();

    // Select the day-of-week matching tomorrow so the recurrence aligns
    const dayToggle = page.getByTestId(`day-${tomorrowDayOfWeek}`);
    await expect(dayToggle).toBeVisible();
    await dayToggle.click();

    // Select "Data especifica" end condition
    const endDateRadio = page.getByTestId('end-condition-date');
    await expect(endDateRadio).toBeVisible();
    await endDateRadio.click();

    // Wait for the date picker to appear
    const endDatePicker = page.getByTestId('end-date-picker');
    await expect(endDatePicker).toBeVisible();

    // Open the end date calendar popover
    const endDateTrigger = page.getByTestId('end-date-trigger');
    await expect(endDateTrigger).toBeVisible();
    await endDateTrigger.click();

    // Navigate to the correct month in the end date calendar
    // The end date popover is the SECOND radix popper content wrapper
    const endDateCalendarPopover = page.locator('[data-radix-popper-content-wrapper]').last();
    await expect(endDateCalendarPopover).toBeVisible();

    // Navigate forward if the end date is in a different month than the current view.
    // Use BRT "now" so the month comparison matches the browser calendar.
    let targetMonth = endDate.getMonth();
    let currentViewMonth = nowInBrt().getMonth();

    // Navigate forward month by month if needed
    while (targetMonth !== currentViewMonth) {
      await endDateCalendarPopover.locator('button[name="next-month"]').click();
      currentViewMonth = (currentViewMonth + 1) % 12;
    }

    // Click the end date day
    const endDateDay = format(endDate, 'd');
    const endDayButton = endDateCalendarPopover
      .locator('table button')
      .filter({ hasText: new RegExp(`^${endDateDay}$`) })
      .first();
    await endDayButton.click();

    // Click "Salvar" to create the recurring session series
    await page.getByTestId('session-form-save').click();

    // Wait for the modal to close (success path)
    await expect(page.getByTestId('session-form-modal')).toBeHidden({ timeout: 15000 });

    // Verify a success toast appeared mentioning multiple sessions
    await expect(page.getByText(/sessoes agendadas com sucesso/i)).toBeVisible({ timeout: 5000 });

    // Navigate to tomorrow's date. Switch to day view, click "Hoje" to
    // land on today (BRT), then click "next" once to advance one day.
    await page.getByTestId('agenda-view-toggle').getByText('Dia').click();
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();

    // Verify the first session appears on the calendar with the recurring indicator.
    // Use `.filter({ has: ... })` to select the chip that has the recurring icon,
    // avoiding false matches from non-recurring sessions created by parallel tests.
    const firstSessionChip = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ has: page.getByTestId('recurring-indicator') })
      .first();
    await expect(firstSessionChip).toBeVisible({ timeout: 10000 });

    // Switch to week view for navigating through subsequent weeks.
    // We're currently on "tomorrow" in day view, so switching to week view
    // shows the week containing tomorrow. Each "next" then advances by 1 week.
    await page.getByTestId('agenda-view-toggle').getByText('Semana').click();

    // Navigate through the next 3 weeks to verify sessions appear on each
    for (let week = 1; week < 4; week++) {
      await page.getByTestId('agenda-nav-next').click();

      // Wait for the calendar to refresh and show sessions for the new week.
      // Filter for the recurring indicator to avoid picking a non-recurring chip.
      const weekSessionChip = page
        .getByTestId('session-chip')
        .filter({ hasText: patientName })
        .filter({ has: page.getByTestId('recurring-indicator') })
        .first();
      await expect(weekSessionChip).toBeVisible({ timeout: 10000 });
    }
  });
});
