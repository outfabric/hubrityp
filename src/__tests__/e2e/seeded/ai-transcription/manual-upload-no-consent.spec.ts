import { expect, test } from '@playwright/test';

import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @ai-transcription -- Manual audio upload negative consent E2E test.
 *
 * Tests that the upload sheet correctly blocks uploads when the patient
 * does NOT have an active AI consent term:
 *   1. Authenticated psychologist navigates to the patient detail page
 *   2. Clicks the "Enviar áudio para transcrição" button to open the sheet
 *   3. Asserts: warning message is visible ("Consentimento necessário")
 *   4. Asserts: dropzone is NOT visible (no file upload possible)
 *
 * Prerequisites:
 *   - Seeded `activeWithPhone` patient with an UNSIGNED `ai_recording`
 *     consent term (state='pending', not 'active')
 *   - Authenticated session via storageState
 */

test.describe('@ai-transcription manual upload without consent', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('shows consent warning and hides dropzone when AI consent is not active', async ({
    page,
  }) => {
    // archived patient has NO AI consent term at all → state='none',
    // which is not 'active', so the sheet should show the consent warning.
    // We use this patient to avoid race conditions with the signing test
    // (which signs activeWithPhone's unsigned term).
    const patientId = SEED_PATIENTS.archived.id;

    // Navigate to the patient detail page
    await page.goto(`/pacientes/${patientId}`);

    // Wait for the page to load
    await expect(page.getByText(SEED_PATIENTS.archived.fullName, { exact: false })).toBeVisible({
      timeout: 15_000,
    });

    // Click the audio upload button to open the sheet
    const uploadBtn = page.getByTestId('audio-upload-btn');
    await expect(uploadBtn).toBeVisible({ timeout: 10_000 });
    await uploadBtn.click();

    // Wait for the sheet to open
    const sheet = page.getByTestId('audio-upload-sheet');
    await expect(sheet).toBeVisible();

    // The consent-inactive warning should be visible
    const warning = page.getByTestId('consent-inactive-warning');
    await expect(warning).toBeVisible({ timeout: 10_000 });
    await expect(warning).toContainText('Consentimento necessário');

    // The dropzone should NOT be present
    const dropzone = page.getByTestId('audio-dropzone');
    await expect(dropzone).not.toBeVisible();

    // No file input should be accessible either (it only renders when
    // consent is active)
    const fileInput = page.getByTestId('audio-file-input');
    await expect(fileInput).toHaveCount(0);
  });
});
