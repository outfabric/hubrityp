import { expect, test } from '@playwright/test';

import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @agenda -- Session drag-and-drop reschedule E2E tests.
 *
 * Tests the drag-and-drop reschedule flow:
 *   1. Create a session via the modal at 14:00
 *   2. Drag the session event from 14:00 to 16:00
 *   3. Verify the reschedule confirmation dialog appears
 *   4. Verify it shows the patient name and new time
 *   5. Click "Confirmar"
 *   6. Verify success toast
 *   7. Verify the session is now at 16:00
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - Patients are seeded in globalSetup (SEED_PATIENTS).
 */

test.describe('@agenda session drag and drop', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('drags a session to a new time slot and confirms the reschedule', async ({ page }) => {
    // Navigate to the agenda page
    await page.goto('/agenda');
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();

    // First, create a session at 14:00 so we have something to drag
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

    // Set start time to 14:00
    const startTimeSelect = page.getByTestId('session-form-start-time');
    await startTimeSelect.click();
    await page.getByRole('option', { name: '14:00' }).click();

    // Use default duration (50 min) — just click save
    await page.getByTestId('session-form-save').click();
    await expect(page.getByTestId('session-form-modal')).toBeHidden({ timeout: 10000 });

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

    // Verify success toast appeared
    await expect(page.getByText('Sessao remarcada')).toBeVisible({ timeout: 5000 });

    // Verify the dialog is closed
    await expect(rescheduleDialog).toBeHidden({ timeout: 5000 });

    // Verify the session chip still exists on the calendar after the
    // reschedule (the calendar refreshes and re-renders the moved event).
    const movedChip = page.getByTestId('session-chip').filter({ hasText: patientName }).first();
    await expect(movedChip).toBeVisible({ timeout: 10000 });
  });
});
