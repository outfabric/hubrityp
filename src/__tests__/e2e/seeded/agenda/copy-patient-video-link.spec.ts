import { expect, test } from '@playwright/test';

import { isoDate, nowInBrt, tomorrowInBrt } from '../_shared/brt-date';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @agenda -- Copy patient video link E2E flow.
 *
 * Exercises the complete user-facing flow built across sections 1-9 of the
 * `copy-patient-video-link` change:
 *
 *   1. Schedule an ONLINE session via the form modal. This triggers
 *      `reserveVideoRoom` (a `video_rooms` row with `stream_call_id=NULL`) and
 *      makes `createSessionImpl` return `patientVideoUrl` (APP_URL is set in the
 *      e2e web server env).
 *   2. The post-scheduling Sonner toast surfaces with a "Copiar link" action.
 *   3. Open the session detail drawer for the created session.
 *   4. The "Link do paciente" section is visible with a "Copiar link" button.
 *   5. Clicking "Copiar link" flips the button label to "Copiado!".
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - Patients are seeded in globalSetup (SEED_PATIENTS).
 *   - The e2e web server (`start-server.ts`) sets `APP_URL` so the patient video
 *     URL is generated server-side.
 *
 * Clipboard note: Chromium denies `navigator.clipboard.writeText` by default in
 * headless contexts. We grant clipboard permissions so the drawer's copy handler
 * resolves and flips to "Copiado!"; the toast action also writes to the
 * clipboard without throwing.
 */

test.describe('@agenda copy patient video link', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('schedules an online session, surfaces the copy action, and copies the link from the drawer', async ({
    page,
    context,
  }) => {
    // Allow the page to write to the clipboard so the copy handler resolves
    // instead of rejecting (which would show an error toast and keep the
    // button label as "Copiar link").
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://localhost:3000',
    });

    // Use tomorrow in BRT so the session is always in the future and aligned
    // with the browser timezone (America/Sao_Paulo).
    const tomorrow = tomorrowInBrt();
    const tomorrowIso = isoDate(tomorrow);

    await page.goto('/agenda');

    await expect(page.getByTestId('agenda-page-title')).toBeVisible();

    // Open the session form modal.
    await page.getByTestId('schedule-button').click();
    await expect(page.getByTestId('session-form-modal')).toBeVisible();

    // Search and select the seeded patient.
    const patientName = SEED_PATIENTS.activeWithPhone.fullName;
    const patientSearch = page.getByTestId('session-form-patient-search');
    await expect(patientSearch).toBeVisible();
    await patientSearch.fill(patientName);

    const patientResults = page.getByTestId('session-form-patient-results');
    await expect(patientResults).toBeVisible({ timeout: 5000 });

    const patientOption = page.getByTestId(`patient-option-${SEED_PATIENTS.activeWithPhone.id}`);
    await expect(patientOption).toBeVisible({ timeout: 5000 });
    await patientOption.click();

    // Pick tomorrow's date in the calendar popover.
    const dateTrigger = page.getByTestId('session-form-date-trigger');
    await expect(dateTrigger).toBeVisible();
    await dateTrigger.click();

    const calendarPopover = page.locator('[data-radix-popper-content-wrapper]').first();
    await expect(calendarPopover).toBeVisible();

    if (tomorrow.getMonth() !== nowInBrt().getMonth()) {
      await calendarPopover.locator('button[name="next-month"]').click();
    }

    const dayButton = calendarPopover.locator(`td[data-day="${tomorrowIso}"] button`);
    await dayButton.click();

    // Pick a distinctive start time (13:00) that no other parallel spec uses
    // for this same seeded patient. The whole seeded suite runs `fullyParallel`
    // against ONE shared seed user, so two specs scheduling the same patient at
    // the same tomorrow slot race on `detectConflicts` — the loser gets a
    // `conflict_warning`, its modal stays open, and the save assertion fails.
    // `recurring-session-create.spec.ts` already owns tomorrow@15:00 for this
    // patient, so this online-session spec takes the free 13:00 slot.
    const startTimeSelect = page.getByTestId('session-form-start-time');
    await startTimeSelect.click();
    await page.getByRole('option', { name: '13:00' }).click();

    const durationSelect = page.getByTestId('session-form-duration');
    await durationSelect.click();
    await page.getByRole('option', { name: '50 min' }).click();

    await expect(page.getByTestId('session-form-end-time')).toContainText('13:50');

    // Select the ONLINE modality — this is what makes the flow reserve a video
    // room and return `patientVideoUrl`. The radio item carries an `id`
    // (`modality-online`), not a test id; target it by its accessible role/name.
    await page.getByRole('radio', { name: 'Online' }).click();

    // Save the session.
    await page.getByTestId('session-form-save').click();

    // The modal closes on success.
    await expect(page.getByTestId('session-form-modal')).toBeHidden({ timeout: 10000 });

    // (b) The post-scheduling toast surfaces with a "Copiar link" action.
    // The toast title and the copy action live inside the Sonner toaster region.
    // Scope to the toast (status role) so the "Copiar link" assertion does not
    // collide with the drawer button rendered later.
    const toast = page.getByText('Sessão agendada com sucesso.');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Copiar link' })).toBeVisible({ timeout: 5000 });

    // Navigate to tomorrow (day view) and locate the created session chip.
    await page.getByTestId('agenda-view-toggle').getByText('Dia').click();
    await page.getByTestId('agenda-nav-today').click();
    await page.getByTestId('agenda-nav-next').click();

    const sessionChip = page
      .getByTestId('session-chip')
      .filter({ hasText: patientName })
      .filter({ hasText: '13:00' })
      .first();
    await expect(sessionChip).toBeVisible({ timeout: 10000 });

    // (c) Open the session detail drawer.
    await sessionChip.click();
    const drawer = page.getByTestId('session-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // (d) The "Link do paciente" section is visible with a "Copiar link" button.
    const linkSection = page.getByTestId('patient-video-link-section');
    await expect(linkSection).toBeVisible();
    await expect(linkSection).toContainText('Link do paciente');

    const copyButton = page.getByTestId('copy-patient-link-button');
    await expect(copyButton).toBeVisible();
    await expect(copyButton).toHaveText(/Copiar link/);

    // (e) Clicking "Copiar link" flips the button label to "Copiado!".
    await copyButton.click();
    await expect(copyButton).toHaveText(/Copiado!/, { timeout: 5000 });
  });
});
