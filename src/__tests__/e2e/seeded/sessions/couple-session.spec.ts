import { expect, test } from '@playwright/test';
import { format } from 'date-fns';

import { nowInBrt, tomorrowInBrt } from '../_shared/brt-date';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @sessions -- Couple session creation E2E test.
 *
 * Tests the couple session scheduling flow:
 *   1. Navigate to /agenda
 *   2. Click "+ Agendar" button
 *   3. Search and select the primary patient
 *   4. Check "Atendimento de casal"
 *   5. Select a second (different) patient from the dropdown
 *   6. Pick tomorrow's date and time (17:00)
 *   7. Submit
 *   8. Navigate to tomorrow on the calendar
 *   9. Verify the session appears as a couple session
 *  10. Click the session chip and verify the detail drawer
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - Patients are seeded in globalSetup (SEED_PATIENTS).
 *
 * Note: The second patient is selected by choosing the first available option
 * in the couple dropdown rather than targeting a specific seeded patient ID.
 * This avoids flakiness when parallel tests (e.g., patient-edit-archive)
 * archive seeded patients before this test runs.
 */

test.describe('@sessions couple session creation', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // Increase timeout — this test opens a form, selects multiple patients,
  // creates a session, then navigates the calendar to verify the result.
  test.setTimeout(60_000);

  test('creates a couple session with 2 patients and verifies both names appear', async ({
    page,
  }) => {
    // Use tomorrow in BRT to guarantee the date is always in the future
    // and aligned with the browser's timezone (America/Sao_Paulo).
    const tomorrow = tomorrowInBrt();
    const tomorrowDay = format(tomorrow, 'd');

    const primaryPatient = SEED_PATIENTS.activeWithPhone;

    // Navigate to the agenda page
    await page.goto('/agenda');
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();

    // Click the "+ Agendar" button
    await page.getByTestId('schedule-button').click();
    await expect(page.getByTestId('session-form-modal')).toBeVisible();

    // Search and select the primary patient
    const patientSearch = page.getByTestId('session-form-patient-search');
    await expect(patientSearch).toBeVisible();
    await patientSearch.fill(primaryPatient.fullName);

    const patientResults = page.getByTestId('session-form-patient-results');
    await expect(patientResults).toBeVisible({ timeout: 5000 });

    const primaryOption = page.getByTestId(`patient-option-${primaryPatient.id}`);
    await expect(primaryOption).toBeVisible({ timeout: 10000 });
    await primaryOption.click();

    // Capture the displayed primary patient name (may differ from seed if
    // renamed by a parallel test). Read it while the modal is still open.
    const primaryDisplayName = (await patientSearch.inputValue()) || primaryPatient.fullName;

    // Select tomorrow's date
    const dateTrigger = page.getByTestId('session-form-date-trigger');
    await dateTrigger.click();

    const calendarPopover = page.locator('[data-radix-popper-content-wrapper]').first();
    await expect(calendarPopover).toBeVisible();

    if (tomorrow.getMonth() !== nowInBrt().getMonth()) {
      await calendarPopover.locator('button[name="next-month"]').click();
    }

    const dayButton = calendarPopover
      .locator('table button')
      .filter({ hasText: new RegExp(`^${tomorrowDay}$`) })
      .first();
    await dayButton.click();

    // Select start time: 17:00 (unique to avoid conflicts with other parallel tests)
    const startTimeSelect = page.getByTestId('session-form-start-time');
    await startTimeSelect.click();
    await page.getByRole('option', { name: '17:00' }).click();

    // Select duration: 50 min
    const durationSelect = page.getByTestId('session-form-duration');
    await durationSelect.click();
    await page.getByRole('option', { name: '50 min' }).click();

    // Check "Atendimento de casal" to reveal the second patient selector
    const coupleToggle = page.getByTestId('couple-toggle');
    await expect(coupleToggle).toBeVisible();
    await coupleToggle.click();

    // Wait for the second patient section to appear
    const secondPatientSection = page.getByTestId('second-patient-section');
    await expect(secondPatientSection).toBeVisible();

    // Open the second patient select dropdown
    const secondPatientSelect = page.getByTestId('second-patient-select');
    await expect(secondPatientSelect).toBeVisible();
    await secondPatientSelect.click();

    // Select the first available option in the couple dropdown.
    // We target by role rather than a specific data-testid because parallel
    // tests may archive the seeded activeMinimal patient, removing it from
    // the active-patients list that populates this dropdown.
    const firstAvailableOption = page.getByRole('option').first();
    await expect(firstAvailableOption).toBeVisible({ timeout: 10000 });
    const secondPatientName = (await firstAvailableOption.textContent()) ?? 'Paciente';
    await firstAvailableOption.click();

    // Build the expected couple display name: "PrimaryFirst & SecondFirst"
    const primaryFirstName = primaryDisplayName.split(' ')[0] ?? 'Paciente';
    const secondFirstName = secondPatientName.split(' ')[0] ?? 'Paciente';
    const coupleDisplayName = `${primaryFirstName} & ${secondFirstName}`;

    // Click "Salvar" to create the couple session
    await page.getByTestId('session-form-save').click();

    // Wait for the modal to close
    await expect(page.getByTestId('session-form-modal')).toBeHidden({ timeout: 10000 });

    // Verify a success toast appeared
    await expect(page.getByText(/agendada com sucesso/i)).toBeVisible({ timeout: 5000 });

    // Navigate to tomorrow's date. Switch to day view, click "Hoje" to
    // land on today (BRT), then click "next" once to advance one day.
    // This avoids the week-view "next" which jumps a full week and may
    // skip past tomorrow depending on the current day-of-week.
    await page.getByTestId('agenda-view-toggle').getByText('Dia').click();
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();

    // Verify the session appears on the calendar with the couple display name.
    // The chip should show "PrimaryFirst & SecondFirst".
    const coupleSessionChip = page
      .getByTestId('session-chip')
      .filter({ hasText: coupleDisplayName })
      .first();
    await expect(coupleSessionChip).toBeVisible({ timeout: 10000 });

    // Click the couple session chip to open the detail drawer
    await coupleSessionChip.click();

    const drawer = page.getByTestId('session-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Verify the drawer title contains the couple display name
    await expect(drawer).toContainText(coupleDisplayName);

    // Verify the status badge shows "Agendada"
    const statusBadge = page.getByTestId('session-status-badge');
    await expect(statusBadge).toBeVisible();
    await expect(statusBadge).toHaveText(/Agendada/);
  });
});
