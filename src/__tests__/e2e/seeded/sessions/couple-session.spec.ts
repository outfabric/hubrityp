import { expect, test } from '@playwright/test';
import { addDays, format } from 'date-fns';

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
 *   9. Verify the session appears with both patient names ("Maria & Joao")
 *  10. Click the session chip and verify both patients listed in the drawer
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - Patients are seeded in globalSetup (SEED_PATIENTS).
 */

test.describe('@sessions couple session creation', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('creates a couple session with 2 patients and verifies both names appear', async ({
    page,
  }) => {
    // Use tomorrow to guarantee the date is always in the future
    const tomorrow = addDays(new Date(), 1);
    const tomorrowDay = format(tomorrow, 'd');

    const primaryPatient = SEED_PATIENTS.activeWithPhone;
    const secondPatient = SEED_PATIENTS.activeMinimal;

    // Derive expected display name: "Maria & Joao" (first names)
    const primaryFirstName = primaryPatient.fullName.split(' ')[0]!;
    const secondFirstName = secondPatient.fullName.split(' ')[0]!;
    const coupleDisplayName = `${primaryFirstName} & ${secondFirstName}`;

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
    await expect(primaryOption).toBeVisible({ timeout: 5000 });
    await primaryOption.click();

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

    // Select the second patient from the dropdown
    // The dropdown uses SelectItem with data-testid="patient-option-<id>"
    const secondOption = page.getByTestId(`patient-option-${secondPatient.id}`);
    await expect(secondOption).toBeVisible({ timeout: 5000 });
    await secondOption.click();

    // Click "Salvar" to create the couple session
    await page.getByTestId('session-form-save').click();

    // Wait for the modal to close
    await expect(page.getByTestId('session-form-modal')).toBeHidden({ timeout: 10000 });

    // Verify a success toast appeared
    await expect(page.getByText(/agendada com sucesso/i)).toBeVisible({ timeout: 5000 });

    // Navigate to tomorrow so the session is visible
    await page.getByTestId('agenda-nav-next').click();

    // Verify the session appears on the calendar with both patient names
    // The session chip should display "Maria & Joao" (couple display name)
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
