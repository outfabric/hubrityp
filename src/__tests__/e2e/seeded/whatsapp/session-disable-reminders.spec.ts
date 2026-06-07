import { expect, test } from '@playwright/test';
import { format } from 'date-fns';

import { isoDate, nowInBrt, tomorrowInBrt } from '../_shared/brt-date';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @whatsapp -- Session creation with "Nao enviar lembretes" checkbox E2E test.
 *
 * Flow:
 *   1. Navigate to /agenda
 *   2. Click "+ Agendar" to open session form modal
 *   3. Search and select a patient with phone (eligible for WhatsApp reminders)
 *   4. Pick tomorrow's date and 18:00 time
 *   5. Check the "Nao enviar lembretes WhatsApp para esta sessao" checkbox
 *   6. Save the session
 *   7. Verify the session was created with reminders_disabled=true by navigating
 *      to the session detail and verifying the edit modal shows the checkbox checked
 *
 * Prerequisites:
 *   - storageState provides an authenticated psychologist.
 *   - Seeded patient with phone number (SEED_PATIENTS.activeWithPhone).
 */

test.describe('@whatsapp session disable reminders', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('creates a session with reminders disabled checkbox checked', async ({ page }) => {
    const tomorrow = tomorrowInBrt();
    const tomorrowDay = format(tomorrow, 'd');
    const tomorrowIso = isoDate(tomorrow);

    // Navigate to the agenda page
    await page.goto('/agenda');
    await expect(page.getByTestId('agenda-page-title')).toBeVisible();

    // Click the "+ Agendar" button to open the session form modal
    await page.getByTestId('schedule-button').click();
    await expect(page.getByTestId('session-form-modal')).toBeVisible();

    // Search for the seeded patient with phone (Maria Silva)
    const patientSearch = page.getByTestId('session-form-patient-search');
    await patientSearch.fill(SEED_PATIENTS.activeWithPhone.fullName);

    // Wait for results and select the patient
    const patientResults = page.getByTestId('session-form-patient-results');
    await expect(patientResults).toBeVisible({ timeout: 5000 });

    const patientOption = page.getByTestId(`patient-option-${SEED_PATIENTS.activeWithPhone.id}`);
    await expect(patientOption).toBeVisible({ timeout: 5000 });
    await patientOption.click();

    // Select tomorrow's date
    const dateTrigger = page.getByTestId('session-form-date-trigger');
    await dateTrigger.click();

    const calendarPopover = page.locator('[data-radix-popper-content-wrapper]').first();
    await expect(calendarPopover).toBeVisible();

    // If tomorrow is in the next month, navigate forward
    if (tomorrow.getMonth() !== nowInBrt().getMonth()) {
      await calendarPopover.locator('button[name="next-month"]').click();
    }

    // Click the day button for tomorrow using the data-day attribute to avoid
    // the outside-day ambiguity (showOutsideDays shows adjacent-month days
    // with matching day numbers).
    const dayButton = calendarPopover.locator(`td[data-day="${tomorrowIso}"] button`);
    await dayButton.click();

    // Select start time: 18:00 (avoids collision with other seeded sessions)
    const startTimeSelect = page.getByTestId('session-form-start-time');
    await startTimeSelect.click();
    await page.getByRole('option', { name: '18:00' }).click();

    // Select duration: 50 min
    const durationSelect = page.getByTestId('session-form-duration');
    await durationSelect.click();
    await page.getByRole('option', { name: '50 min' }).click();

    // The "Nao enviar lembretes" checkbox should be visible because the
    // patient has a phone number and has not opted out
    const remindersDisabledSection = page.getByTestId('session-form-reminders-disabled');
    await expect(remindersDisabledSection).toBeVisible({ timeout: 5000 });

    // Check the "Nao enviar lembretes" checkbox
    const remindersCheckbox = remindersDisabledSection.locator('#session-reminders-disabled');
    await remindersCheckbox.click();

    // Click "Salvar" to create the session
    await page.getByTestId('session-form-save').click();

    // Wait for modal to close (success)
    await expect(page.getByTestId('session-form-modal')).toBeHidden({ timeout: 10000 });

    // Verify success toast
    await expect(page.getByText('Sessão agendada com sucesso.')).toBeVisible({ timeout: 5000 });

    // Navigate to tomorrow in day view to find the newly created session
    await page.getByTestId('agenda-view-toggle').getByText('Dia').click();
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();

    // Verify the period title shows tomorrow
    await expect(page.getByTestId('agenda-period-title')).toContainText(
      new RegExp(`\\b${tomorrowDay}\\b`),
      { timeout: 10000 },
    );

    // Find the session chip at 18:00 for Maria Silva
    const sessionChip = page
      .getByTestId('session-chip')
      .filter({ hasText: SEED_PATIENTS.activeWithPhone.fullName })
      .filter({ hasText: '18:00' })
      .first();
    await expect(sessionChip).toBeVisible({ timeout: 10000 });

    // Click the chip to open the detail drawer
    await sessionChip.click();
    const drawer = page.getByTestId('session-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Click "Editar" to open the edit modal and verify reminders_disabled is checked
    await drawer.getByTestId('session-edit-button').click();

    // The edit modal should open
    await expect(page.getByTestId('session-form-modal')).toBeVisible({ timeout: 5000 });

    // Verify the reminders disabled checkbox is checked in edit mode
    const editRemindersSection = page.getByTestId('session-form-reminders-disabled');
    await expect(editRemindersSection).toBeVisible({ timeout: 5000 });

    const editCheckbox = editRemindersSection.locator('#session-reminders-disabled');
    await expect(editCheckbox).toHaveAttribute('data-state', 'checked');
  });
});
