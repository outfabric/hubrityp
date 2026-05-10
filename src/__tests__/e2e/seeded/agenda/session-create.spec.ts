import { expect, test } from '@playwright/test';
import { format } from 'date-fns';

import { nowInBrt, tomorrowInBrt } from '../_shared/brt-date';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @agenda -- Session creation E2E tests.
 *
 * Tests the full session scheduling flow:
 *   1. Navigate to /agenda
 *   2. Click "+ Agendar" button
 *   3. Search and select a patient by name
 *   4. Pick tomorrow's date and a time
 *   5. Select a location (if available)
 *   6. Click "Salvar"
 *   7. Navigate to tomorrow on the calendar
 *   8. Verify the session appears on the calendar grid
 *   9. Click the session to open the detail drawer
 *  10. Verify the drawer shows the correct fields
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - Patients are seeded in globalSetup (SEED_PATIENTS).
 */

test.describe('@agenda session creation', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('creates a session via modal, verifies it on the calendar, and opens the detail drawer', async ({
    page,
  }) => {
    // Use tomorrow in BRT to guarantee the date is always in the future
    // and aligned with the browser's timezone (America/Sao_Paulo).
    const tomorrow = tomorrowInBrt();
    const tomorrowDay = format(tomorrow, 'd');

    // Navigate to the agenda page
    await page.goto('/agenda');

    // Verify the page title is visible
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();
    await expect(page.getByTestId('agenda-page-title')).toHaveText('Agenda');

    // Click the "+ Agendar" button to open the session form modal
    await page.getByTestId('schedule-button').click();

    // The session form modal should appear
    await expect(page.getByTestId('session-form-modal')).toBeVisible();

    // Search for the seeded patient by name
    const patientSearch = page.getByTestId('session-form-patient-search');
    await expect(patientSearch).toBeVisible();

    // Type the patient name to trigger search
    const patientName = SEED_PATIENTS.activeWithPhone.fullName;
    await patientSearch.fill(patientName);

    // Wait for search results to appear (300ms debounce + network)
    const patientResults = page.getByTestId('session-form-patient-results');
    await expect(patientResults).toBeVisible({ timeout: 5000 });

    // Select the patient from the dropdown
    const patientOption = page.getByTestId(`patient-option-${SEED_PATIENTS.activeWithPhone.id}`);
    await expect(patientOption).toBeVisible({ timeout: 5000 });
    await patientOption.click();

    // Select tomorrow's date in the calendar popover.
    // The modal defaults to today; we open the popover and pick tomorrow
    // to ensure the session is always in the future.
    const dateTrigger = page.getByTestId('session-form-date-trigger');
    await expect(dateTrigger).toBeVisible();
    await dateTrigger.click();

    // Scope the day button search to the popover content to avoid matching
    // the nav bar calendar or tab buttons (which also have aria-selected).
    const calendarPopover = page.locator('[data-radix-popper-content-wrapper]').first();
    await expect(calendarPopover).toBeVisible();

    // If tomorrow is in the next month, navigate forward.
    if (tomorrow.getMonth() !== nowInBrt().getMonth()) {
      await calendarPopover.locator('button[name="next-month"]').click();
    }

    // Click the day button for tomorrow. In react-day-picker v9, each day
    // cell renders a <button> inside a <td>.
    const dayButton = calendarPopover
      .locator('table button')
      .filter({ hasText: new RegExp(`^${tomorrowDay}$`) })
      .first();
    await dayButton.click();

    // Select start time: 14:00
    const startTimeSelect = page.getByTestId('session-form-start-time');
    await startTimeSelect.click();
    await page.getByRole('option', { name: '14:00' }).click();

    // Select duration: 50 min
    const durationSelect = page.getByTestId('session-form-duration');
    await durationSelect.click();
    await page.getByRole('option', { name: '50 min' }).click();

    // Verify the computed end time updates
    const endTime = page.getByTestId('session-form-end-time');
    await expect(endTime).toContainText('14:50');

    // If locations are available, verify one can be selected
    const locationSelect = page.getByTestId('session-form-location');
    if (await locationSelect.isVisible().catch(() => false)) {
      // A location may already be pre-selected (default). That is acceptable.
      await expect(locationSelect).toBeVisible();
    }

    // Click "Salvar" to create the session
    await page.getByTestId('session-form-save').click();

    // Wait for the modal to close (success path)
    await expect(page.getByTestId('session-form-modal')).toBeHidden({ timeout: 10000 });

    // Verify a success toast appeared
    await expect(page.getByText('Sessao agendada com sucesso.')).toBeVisible({ timeout: 5000 });

    // Navigate to tomorrow's date. Switch to day view, click "Hoje" to
    // land on today (BRT), then click "next" once to advance one day.
    // This avoids the week-view "next" which jumps a full week and may
    // skip past tomorrow depending on the current day-of-week.
    await page.getByTestId('agenda-view-toggle').getByText('Dia').click();
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();

    // Verify the session now appears on the calendar grid.
    // FullCalendar renders session chips with data-testid="session-chip".
    // Filter by both patient name and time (14:00) to disambiguate from
    // seeded sessions for the same patient at other times.
    const sessionChip = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ hasText: '14:00' })
      .first();
    await expect(sessionChip).toBeVisible({ timeout: 10000 });

    // Click the session chip to open the detail drawer
    await sessionChip.click();

    // The session detail drawer should open
    const drawer = page.getByTestId('session-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Verify the drawer shows the patient name in the title
    await expect(drawer.locator('text=' + patientName)).toBeVisible();

    // Verify the status badge shows "Agendada"
    const statusBadge = page.getByTestId('session-status-badge');
    await expect(statusBadge).toBeVisible();
    await expect(statusBadge).toHaveText(/Agendada/);

    // Verify the drawer has action buttons
    await expect(page.getByTestId('session-edit-button')).toBeVisible();
    await expect(page.getByTestId('action-btn-mark_done')).toBeVisible();
  });
});
