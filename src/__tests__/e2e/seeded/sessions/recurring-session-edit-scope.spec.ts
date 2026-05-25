import { expect, test } from '@playwright/test';
import { addWeeks } from 'date-fns';

import { isoDate, nowInBrt, tomorrowInBrt } from '../_shared/brt-date';
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
 *   6. Change a field (time) in the edit form
 *   7. Save and verify success
 *   8. Verify session #1 still shows the old state
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - Patients are seeded in globalSetup (SEED_PATIENTS).
 *
 * Note: Uses activeWithPhone instead of activeMinimal because a parallel test
 * (patient-edit-archive) may archive activeMinimal, making it unfindable in
 * the active patient search.
 */

test.describe('@sessions recurring session edit scope', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // Increase timeout — this test creates recurring sessions then navigates multiple weeks
  test.setTimeout(90_000);

  test('edits recurring session with "this_and_future" scope and verifies correct sessions updated', async ({
    page,
  }) => {
    // Use tomorrow in BRT to guarantee the date is always in the future
    // and aligned with the browser's timezone (America/Sao_Paulo).
    const tomorrow = tomorrowInBrt();
    const tomorrowIso = isoDate(tomorrow);
    const tomorrowDayOfWeek = tomorrow.getDay();

    // End date: 3 weeks after tomorrow (4 total sessions)
    const endDate = addWeeks(tomorrow, 3);

    // Use activeWithPhone — it's only renamed (not archived) by parallel tests,
    // so it remains findable via the active patient search.
    const targetPatient = SEED_PATIENTS.activeWithPhone;

    // ---- Step 1: Create a weekly recurring session (16:00, 50 min) ----

    await page.goto('/agenda');
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();

    await page.getByTestId('schedule-button').click();
    await expect(page.getByTestId('session-form-modal')).toBeVisible();

    // Search and select patient
    const patientSearch = page.getByTestId('session-form-patient-search');
    await patientSearch.fill(targetPatient.fullName);

    const patientResults = page.getByTestId('session-form-patient-results');
    await expect(patientResults).toBeVisible({ timeout: 5000 });

    const patientOption = page.getByTestId(`patient-option-${targetPatient.id}`);
    await expect(patientOption).toBeVisible({ timeout: 10000 });
    await patientOption.click();

    // Read the actual displayed name (may differ from seed if renamed by parallel test)
    const displayedPatientName =
      (await page.getByTestId('session-form-patient-search').inputValue()) ||
      targetPatient.fullName;

    // Select tomorrow's date
    const dateTrigger = page.getByTestId('session-form-date-trigger');
    await dateTrigger.click();

    const calendarPopover = page.locator('[data-radix-popper-content-wrapper]').first();
    await expect(calendarPopover).toBeVisible();

    if (tomorrow.getMonth() !== nowInBrt().getMonth()) {
      await calendarPopover.locator('button[name="next-month"]').click();
    }

    // Click the day button for tomorrow using the data-day attribute to avoid
    // the outside-day ambiguity (showOutsideDays shows adjacent-month days
    // with matching day numbers).
    const dayButton = calendarPopover.locator(`td[data-day="${tomorrowIso}"] button`);
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

    // Wait for the end date picker section to render before clicking the trigger
    const endDatePicker = page.getByTestId('end-date-picker');
    await expect(endDatePicker).toBeVisible();

    // Open end date calendar and pick the end date
    const endDateTrigger = page.getByTestId('end-date-trigger');
    await expect(endDateTrigger).toBeVisible();
    await endDateTrigger.click();
    const endDateCalendar = page.locator('[data-radix-popper-content-wrapper]').last();
    await expect(endDateCalendar).toBeVisible();

    // Navigate to the correct month if needed.
    // Use BRT "now" so the month comparison matches the browser calendar.
    let targetMonth = endDate.getMonth();
    let currentViewMonth = nowInBrt().getMonth();

    while (targetMonth !== currentViewMonth) {
      await endDateCalendar.locator('button[name="next-month"]').click();
      currentViewMonth = (currentViewMonth + 1) % 12;
    }

    // Click the end date day using the data-day attribute to avoid
    // the outside-day ambiguity.
    const endDayButton = endDateCalendar.locator(`td[data-day="${isoDate(endDate)}"] button`);
    await endDayButton.click();

    // Submit — handle potential conflict warning on test retries.
    // When the test retries after a partial run, sessions from the previous
    // attempt are still in the DB, so the server may return a conflict
    // warning instead of immediately creating. If the conflict alert appears,
    // click "Agendar mesmo assim" to force through it.
    await page.getByTestId('session-form-save').click();

    const conflictAlert = page.getByTestId('session-form-conflict-alert');
    const modalHidden = page.getByTestId('session-form-modal');

    // Wait for either: modal closes (success) or conflict alert appears
    await Promise.race([
      expect(modalHidden)
        .toBeHidden({ timeout: 15000 })
        .catch(() => {}),
      expect(conflictAlert)
        .toBeVisible({ timeout: 15000 })
        .catch(() => {}),
    ]);

    // If the conflict alert appeared, force through it
    if (await conflictAlert.isVisible().catch(() => false)) {
      await page.getByTestId('session-form-force-conflict').click();
    }

    await expect(page.getByTestId('session-form-modal')).toBeHidden({ timeout: 15000 });
    await expect(page.getByText(/sessoes agendadas com sucesso/i)).toBeVisible({ timeout: 5000 });

    // ---- Step 2: Navigate to the second week and click session #2 ----

    // Navigate to tomorrow's date. Switch to day view, click "Hoje" to
    // land on today (BRT), then click "next" once to advance one day.
    // Switch back to week view for the rest of the test.
    await page.getByTestId('agenda-view-toggle').getByText('Dia').click();
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();
    await page.getByTestId('agenda-view-toggle').getByText('Semana').click();

    // Use the displayed patient name for filtering session chips (resilient to renames)
    const patientName = displayedPatientName;

    // Verify session #1 is visible — filter by time text (16:00), patient name,
    // and recurring indicator to distinguish from parallel test sessions.
    const session1Chip = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ hasText: '16:00' })
      .filter({ has: page.getByTestId('recurring-indicator') })
      .first();
    await expect(session1Chip).toBeVisible({ timeout: 10000 });

    // Navigate to week 2
    await page.getByTestId('agenda-nav-next').click();

    // Wait for the session #2 to appear (also at 16:00 before the edit)
    const session2Chip = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ hasText: '16:00' })
      .filter({ has: page.getByTestId('recurring-indicator') })
      .first();
    await expect(session2Chip).toBeVisible({ timeout: 10000 });

    // ---- Step 3: Click the session to open the detail drawer ----

    await session2Chip.click();

    const drawer = page.getByTestId('session-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Verify the drawer shows the correct patient name
    await expect(drawer).toContainText(patientName);

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
    // Session #2 was updated from 16:00 to 18:00. Filter by the new time
    // and recurring indicator to avoid picking a parallel test's session.
    const updatedSession2 = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ hasText: '18:00' })
      .filter({ has: page.getByTestId('recurring-indicator') })
      .first();
    await expect(updatedSession2).toBeVisible({ timeout: 10000 });

    // Click session #2 to verify its time in the detail drawer.
    // Wait briefly for FullCalendar to attach event handlers to the
    // freshly rendered chip after the edit + calendar refresh.
    await page.waitForTimeout(500);

    // Use dispatchEvent because FullCalendar's eventClick handler may not
    // fire with Playwright's standard click on freshly mounted events.
    await updatedSession2.dispatchEvent('click');

    const drawerAfterEdit = page.getByTestId('session-detail-drawer');

    // Fall back to clicking the parent FullCalendar event wrapper if
    // dispatchEvent didn't trigger the eventClick handler.
    const drawerOpenedAfterEdit = await drawerAfterEdit.isVisible().catch(() => false);
    if (!drawerOpenedAfterEdit) {
      await updatedSession2.locator('..').click({ force: true });
    }

    await expect(drawerAfterEdit).toBeVisible({ timeout: 10000 });

    // The form picks "18:00" in the browser (BRT timezone). buildIsoDatetime
    // converts 18:00 BRT → 21:00 UTC for storage. The drawer converts back
    // to Sao Paulo time: 21:00 UTC = 18:00 BRT.
    await expect(drawerAfterEdit).toContainText('18:00');

    // Close the drawer
    await page.keyboard.press('Escape');
    await expect(drawerAfterEdit).toBeHidden({ timeout: 5000 });

    // ---- Step 9: Navigate back to week 1 and verify session #1 retains old time ----

    // Go back 1 week to week 1
    await page.getByTestId('agenda-nav-prev').click();

    // Filter for THIS test's recurring session chip by matching the time text
    // (16:00) in addition to the patient name and recurring indicator. This
    // avoids picking a recurring session from recurring-session-create.spec.ts
    // which uses 15:00 for the same patient.
    const session1ChipAfter = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ hasText: '16:00' })
      .filter({ has: page.getByTestId('recurring-indicator') })
      .first();
    await expect(session1ChipAfter).toBeVisible({ timeout: 10000 });

    // Wait briefly for FullCalendar to fully re-render events after navigation.
    // The `handleDatesSet` fetch and React reconciliation need a moment to
    // attach the eventClick handler to the freshly rendered event elements.
    await page.waitForTimeout(500);

    // Re-locate the chip after the brief wait to ensure we reference the
    // final rendered element (FullCalendar may re-mount events on navigation).
    const session1ChipFinal = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ hasText: '16:00' })
      .filter({ has: page.getByTestId('recurring-indicator') })
      .first();
    await expect(session1ChipFinal).toBeVisible({ timeout: 5000 });

    // Click via dispatchEvent because Playwright's standard click sometimes
    // doesn't trigger FullCalendar's eventClick on freshly mounted events.
    await session1ChipFinal.dispatchEvent('click');

    // If dispatchEvent didn't open the drawer (FC event container may need
    // the click on the `<a>` wrapper), fall back to clicking the wrapper.
    const drawer1 = page.getByTestId('session-detail-drawer');
    const drawerOpened = await drawer1.isVisible().catch(() => false);
    if (!drawerOpened) {
      // Try clicking the parent FullCalendar event element
      await session1ChipFinal.locator('..').click({ force: true });
    }
    await expect(drawer1).toBeVisible({ timeout: 10000 });

    // Session #1 was created at 16:00 BRT (stored as 19:00 UTC). The drawer
    // converts back to Sao Paulo time: 19:00 UTC = 16:00 BRT.
    await expect(drawer1).toContainText('16:00');
  });
});
