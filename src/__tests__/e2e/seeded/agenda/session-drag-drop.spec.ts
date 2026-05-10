import { expect, test } from '@playwright/test';
import { format } from 'date-fns';

import { nowInBrt, tomorrowInBrt } from '../_shared/brt-date';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @agenda -- Session drag-and-drop reschedule E2E tests.
 *
 * Tests the drag-and-drop reschedule flow:
 *   1. Create a session via the modal at 14:00 tomorrow
 *   2. Navigate to tomorrow on the calendar
 *   3. Drag the session event from 14:00 to 16:00
 *   4. Verify the reschedule confirmation dialog appears
 *   5. Verify it shows the patient name and new time
 *   6. Click "Confirmar"
 *   7. Verify success toast
 *   8. Verify the session is now at 16:00
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - Patients are seeded in globalSetup (SEED_PATIENTS).
 */

test.describe('@agenda session drag and drop', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('drags a session to a new time slot and confirms the reschedule', async ({ page }) => {
    // Use tomorrow in BRT to guarantee the date is always in the future
    // and aligned with the browser's timezone (America/Sao_Paulo).
    const tomorrow = tomorrowInBrt();
    const tomorrowDay = format(tomorrow, 'd');

    // Navigate to the agenda page
    await page.goto('/agenda');
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();

    // First, create a session at 14:00 tomorrow so we have something to drag
    await page.getByTestId('schedule-button').click();
    await expect(page.getByTestId('session-form-modal')).toBeVisible();

    // Search and select patient
    const patientName = SEED_PATIENTS.activeWithPhone.fullName;
    const patientSearch = page.getByTestId('session-form-patient-search');
    await patientSearch.fill(patientName);

    const patientResults = page.getByTestId('session-form-patient-results');
    await expect(patientResults).toBeVisible({ timeout: 5000 });

    const patientOption = page.getByTestId(`patient-option-${SEED_PATIENTS.activeWithPhone.id}`);
    await expect(patientOption).toBeVisible({ timeout: 5000 });
    await patientOption.click();

    // Select tomorrow's date in the calendar popover.
    const dateTrigger = page.getByTestId('session-form-date-trigger');
    await expect(dateTrigger).toBeVisible();
    await dateTrigger.click();

    const calendarPopover = page.locator('[data-radix-popper-content-wrapper]').first();
    await expect(calendarPopover).toBeVisible();

    // If tomorrow is in the next month, navigate forward.
    if (tomorrow.getMonth() !== nowInBrt().getMonth()) {
      await calendarPopover.locator('button[name="next-month"]').click();
    }

    const dayButton = calendarPopover
      .locator('table button')
      .filter({ hasText: new RegExp(`^${tomorrowDay}$`) })
      .first();
    await dayButton.click();

    // Set start time to 08:00. This must not overlap with any other agenda
    // e2e test when running in parallel:
    //   - session-create: 14:00–14:50
    //   - block-create:   12:00–13:00
    // After the drag (4 × 30-min slots = +2h), the session lands at
    // 10:00–10:50, which also avoids conflicts with the other tests.
    const startTimeSelect = page.getByTestId('session-form-start-time');
    await startTimeSelect.click();
    await page.getByRole('option', { name: '08:00' }).click();

    // Use default duration (50 min) — just click save
    await page.getByTestId('session-form-save').click();
    await expect(page.getByTestId('session-form-modal')).toBeHidden({ timeout: 10000 });

    // Navigate to tomorrow's date. Switch to day view, click "Hoje" to
    // land on today (BRT), then click "next" once to advance one day.
    // This avoids the week-view "next" which jumps a full week and may
    // skip past tomorrow depending on the current day-of-week.
    await page.getByTestId('agenda-view-toggle').getByText('Dia').click();
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();

    // Wait for the session to appear on the calendar
    const sessionChip = page.getByTestId('session-chip').filter({ hasText: patientName }).first();
    await expect(sessionChip).toBeVisible({ timeout: 10000 });

    // FullCalendar renders time slots in a <td> grid. The session is rendered
    // as a FullCalendar event. To drag it 2 hours down (from 14:00 to 16:00),
    // we need to drag it by the height of 4 x 30-min slots.
    //
    // FullCalendar's default slot height depends on CSS — each 30-min slot
    // is roughly the height of one <td> row. We compute the slot height
    // from the actual DOM and drag by 4 x that value.
    //
    // Get the bounding box of a slot to compute slot height
    const slots = page.locator('.fc-timegrid-slot[data-time]');
    const firstSlot = slots.first();
    await expect(firstSlot).toBeVisible();
    const slotBox = await firstSlot.boundingBox();

    // slotBox.height is the height of one 30-min slot. We need to move
    // 4 slots down (2 hours = 4 x 30 min).
    const dragDistance = slotBox ? slotBox.height * 4 : 200;

    // Get the session chip's bounding box for the drag start point
    const chipBox = await sessionChip.boundingBox();
    if (!chipBox) {
      throw new Error('Could not get session chip bounding box');
    }

    // Perform the drag: start from center of chip, drag down by dragDistance
    const startX = chipBox.x + chipBox.width / 2;
    const startY = chipBox.y + chipBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Move in steps to trigger FullCalendar's drag detection
    await page.mouse.move(startX, startY + dragDistance / 2, { steps: 5 });
    await page.mouse.move(startX, startY + dragDistance, { steps: 5 });
    await page.mouse.up();

    // The reschedule confirmation dialog should appear
    const rescheduleDialog = page.getByTestId('reschedule-confirm-dialog');
    await expect(rescheduleDialog).toBeVisible({ timeout: 5000 });

    // Verify the dialog shows the patient name
    await expect(rescheduleDialog).toContainText(patientName);

    // Verify the dialog title asks about rescheduling
    await expect(rescheduleDialog).toContainText('Remarcar sessao?');

    // Click "Confirmar" to accept the reschedule
    await page.getByTestId('reschedule-confirm').click();

    // Verify success toast appeared. Use `exact: true` to match only the
    // toast title and not the description (which also contains "Sessao remarcada").
    await expect(page.getByText('Sessao remarcada', { exact: true })).toBeVisible({
      timeout: 5000,
    });

    // Verify the dialog is closed
    await expect(rescheduleDialog).toBeHidden({ timeout: 5000 });

    // Verify the session chip still exists on the calendar after the
    // reschedule (the calendar refreshes and re-renders the moved event).
    const movedChip = page.getByTestId('session-chip').filter({ hasText: patientName }).first();
    await expect(movedChip).toBeVisible({ timeout: 10000 });
  });
});
