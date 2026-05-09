import { expect, test } from '@playwright/test';
import { addDays, addWeeks, format } from 'date-fns';

import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @sessions -- Recurring session edit scope E2E test.
 *
 * Tests the recurring session edit scope flow:
 *   1. Create a weekly recurring session (4 occurrences)
 *   2. Navigate to week 2 and click session #2
 *   3. Click "Editar" in the detail drawer
 *   4. The EditScopeDialog appears with 3 options
 *   5. Select "Esta e todas as proximas"
 *   6. Change a field (notes) in the edit form
 *   7. Save and verify success
 *   8. Verify session #1 still shows the old state (no notes)
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - Patients are seeded in globalSetup (SEED_PATIENTS).
 */

test.describe('@sessions recurring session edit scope', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // Increase timeout — this test creates recurring sessions then navigates multiple weeks
  test.setTimeout(90_000);

  test('edits recurring session with "this_and_future" scope and verifies correct sessions updated', async ({
    page,
  }) => {
    // Use tomorrow to guarantee the date is always in the future
    const tomorrow = addDays(new Date(), 1);
    const tomorrowDay = format(tomorrow, 'd');
    const tomorrowDayOfWeek = tomorrow.getDay();

    // End date: 3 weeks after tomorrow (4 total sessions)
    const endDate = addWeeks(tomorrow, 3);

    // ---- Step 1: Create a weekly recurring session (16:00, 50 min) ----

    await page.goto('/agenda');
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();

    await page.getByTestId('schedule-button').click();
    await expect(page.getByTestId('session-form-modal')).toBeVisible();

    // Search and select patient
    const patientName = SEED_PATIENTS.activeMinimal.fullName;
    const patientSearch = page.getByTestId('session-form-patient-search');
    await patientSearch.fill(patientName);

    const patientResults = page.getByTestId('session-form-patient-results');
    await expect(patientResults).toBeVisible({ timeout: 5000 });

    const patientOption = page.getByTestId(`patient-option-${SEED_PATIENTS.activeMinimal.id}`);
    await expect(patientOption).toBeVisible({ timeout: 5000 });
    await patientOption.click();

    // Select tomorrow's date
    const dateTrigger = page.getByTestId('session-form-date-trigger');
    await dateTrigger.click();

    const calendarPopover = page.locator('[data-radix-popper-content-wrapper]').first();
    await expect(calendarPopover).toBeVisible();

    if (tomorrow.getMonth() !== new Date().getMonth()) {
      await calendarPopover.locator('button[name="next-month"]').click();
    }

    const dayButton = calendarPopover
      .locator('table button')
      .filter({ hasText: new RegExp(`^${tomorrowDay}$`) })
      .first();
    await dayButton.click();

    // Set start time: 16:00 (unique to avoid conflicts)
    const startTimeSelect = page.getByTestId('session-form-start-time');
    await startTimeSelect.click();
    await page.getByRole('option', { name: '16:00' }).click();

    // Duration: 50 min (default)
    const durationSelect = page.getByTestId('session-form-duration');
    await durationSelect.click();
    await page.getByRole('option', { name: '50 min' }).click();

    // Enable recurrence
    await page.getByTestId('recurrence-toggle').click();

    // Select "Semanal"
    await page.getByTestId('freq-weekly').click();

    // Select day-of-week matching tomorrow
    await page.getByTestId(`day-${tomorrowDayOfWeek}`).click();

    // Select "Data especifica" end condition
    await page.getByTestId('end-condition-date').click();

    // Open end date calendar and pick the end date
    await page.getByTestId('end-date-trigger').click();
    const endDateCalendar = page.locator('[data-radix-popper-content-wrapper]').last();
    await expect(endDateCalendar).toBeVisible();

    // Navigate to the correct month if needed
    const currentDate = new Date();
    let targetMonth = endDate.getMonth();
    let currentViewMonth = currentDate.getMonth();

    while (targetMonth !== currentViewMonth) {
      await endDateCalendar.locator('button[name="next-month"]').click();
      currentViewMonth = (currentViewMonth + 1) % 12;
    }

    const endDateDay = format(endDate, 'd');
    const endDayButton = endDateCalendar
      .locator('table button')
      .filter({ hasText: new RegExp(`^${endDateDay}$`) })
      .first();
    await endDayButton.click();

    // Submit
    await page.getByTestId('session-form-save').click();
    await expect(page.getByTestId('session-form-modal')).toBeHidden({ timeout: 15000 });
    await expect(page.getByText(/sessoes agendadas com sucesso/i)).toBeVisible({ timeout: 5000 });

    // ---- Step 2: Navigate to the second week and click session #2 ----

    // Navigate to tomorrow (week 1) first
    await page.getByTestId('agenda-nav-next').click();

    // Verify session #1 is visible
    const session1Chip = page.getByTestId('session-chip').filter({ hasText: patientName }).first();
    await expect(session1Chip).toBeVisible({ timeout: 10000 });

    // Navigate to week 2
    await page.getByTestId('agenda-nav-next').click();

    // Wait for the session #2 to appear
    const session2Chip = page.getByTestId('session-chip').filter({ hasText: patientName }).first();
    await expect(session2Chip).toBeVisible({ timeout: 10000 });

    // ---- Step 3: Click the session to open the detail drawer ----

    await session2Chip.click();

    const drawer = page.getByTestId('session-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Verify the drawer shows the correct patient name
    await expect(drawer.locator(`text=${patientName}`)).toBeVisible();

    // ---- Step 4: Click "Editar" — should show EditScopeDialog ----
    // Use dispatchEvent because the Sheet overlay can intercept Playwright's
    // standard click actionability check.

    const editButton = page.getByTestId('session-edit-button');
    await expect(editButton).toBeVisible();
    await editButton.dispatchEvent('click');

    // The edit scope dialog should appear because this is a recurring session
    const editScopeDialog = page.getByTestId('edit-scope-dialog');
    await expect(editScopeDialog).toBeVisible({ timeout: 5000 });

    // Verify all 3 scope options are visible
    await expect(page.getByTestId('scope-this')).toBeVisible();
    await expect(page.getByTestId('scope-this_and_future')).toBeVisible();
    await expect(page.getByTestId('scope-all')).toBeVisible();

    // ---- Step 5: Select "Esta e todas as proximas" ----

    await page.getByTestId('scope-this_and_future').click();

    // The edit scope dialog should close and the session form should open
    await expect(editScopeDialog).toBeHidden({ timeout: 5000 });
    await expect(page.getByTestId('session-form-modal')).toBeVisible({ timeout: 5000 });

    // ---- Step 6: Change the time from 16:00 to 18:00 ----

    const editStartTime = page.getByTestId('session-form-start-time');
    await editStartTime.click();
    await page.getByRole('option', { name: '18:00' }).click();

    // ---- Step 7: Save the edit ----

    await page.getByTestId('session-form-save').click();
    await expect(page.getByTestId('session-form-modal')).toBeHidden({ timeout: 15000 });

    // Verify success toast
    await expect(page.getByText(/atualizada com sucesso/i)).toBeVisible({ timeout: 5000 });

    // ---- Step 8: Verify session #2 now shows at the new time ----

    // After the edit, we should still be on week 2. Wait for calendar refresh.
    const updatedSession2 = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .first();
    await expect(updatedSession2).toBeVisible({ timeout: 10000 });

    // Click session #2 to verify its time in the detail drawer.
    await updatedSession2.dispatchEvent('click');
    const drawerAfterEdit = page.getByTestId('session-detail-drawer');
    await expect(drawerAfterEdit).toBeVisible({ timeout: 5000 });

    // The form picks "18:00" which the browser (UTC timezone) stores as 18:00 UTC.
    // The drawer converts to Sao Paulo time (UTC-3): 18:00 UTC = 15:00 BRT.
    await expect(drawerAfterEdit).toContainText('15:00');

    // Close the drawer
    await page.keyboard.press('Escape');
    await expect(drawerAfterEdit).toBeHidden({ timeout: 5000 });

    // ---- Step 9: Navigate back to week 1 and verify session #1 retains old time ----

    // Go back 1 week to week 1
    await page.getByTestId('agenda-nav-prev').click();

    const session1ChipAfter = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .first();
    await expect(session1ChipAfter).toBeVisible({ timeout: 10000 });

    await session1ChipAfter.dispatchEvent('click');
    const drawer1 = page.getByTestId('session-detail-drawer');
    await expect(drawer1).toBeVisible({ timeout: 5000 });

    // Session #1 should still show 13:00 BRT (16:00 UTC - 3h)
    await expect(drawer1).toContainText('13:00');
  });
});
