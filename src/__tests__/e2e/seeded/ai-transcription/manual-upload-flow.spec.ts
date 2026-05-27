import { expect, test } from '@playwright/test';
import pgModule from 'postgres';

import { readSeedState, SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @ai-transcription -- Manual audio upload E2E tests.
 *
 * Tests the upload UI flow and verifies that `requestAudioUploadUrl` creates
 * a database row. The full upload round-trip (signed URL → XHR PUT →
 * confirmAudioUpload) depends on server-side Storage interactions which are
 * mocked at the GoTrue shim level but may fail due to Inngest send timeouts
 * in the e2e environment. We therefore split into two focused assertions:
 *
 *   1. UI flow: consent check → dropzone → file selection → upload starts
 *   2. Database: `ai_transcriptions` row created with `status='pending'`
 *
 * Prerequisites:
 *   - Seeded `activeMinimal` patient with a signed `ai_recording` consent
 *     term (global-setup.ts seeds `SEED_AI_CONSENT_TERMS.alreadySigned`)
 *   - Authenticated session via storageState
 */

test.describe('@ai-transcription manual audio upload flow', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test('opens upload sheet, selects file, triggers upload, and creates DB row', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const patientId = SEED_PATIENTS.activeMinimal.id;

    // Navigate to the patient detail page
    await page.goto(`/pacientes/${patientId}`);

    // Wait for the page to load
    await expect(
      page.getByText(SEED_PATIENTS.activeMinimal.fullName, { exact: false }),
    ).toBeVisible({ timeout: 15_000 });

    // Click the audio upload button to open the sheet
    const uploadBtn = page.getByTestId('audio-upload-btn');
    await expect(uploadBtn).toBeVisible({ timeout: 10_000 });
    await uploadBtn.click();

    // Sheet opens
    const sheet = page.getByTestId('audio-upload-sheet');
    await expect(sheet).toBeVisible();

    // Consent is active for activeMinimal — the dropzone should appear
    const dropzone = page.getByTestId('audio-dropzone');
    await expect(dropzone).toBeVisible({ timeout: 10_000 });

    // Select a minimal valid MP3 file
    const fileInput = page.getByTestId('audio-file-input');
    const mp3Bytes = new Uint8Array(4096);
    mp3Bytes[0] = 0x49; // I
    mp3Bytes[1] = 0x44; // D
    mp3Bytes[2] = 0x33; // 3
    mp3Bytes[3] = 0x04; // version major
    mp3Bytes[10] = 0xff; // MPEG sync word
    mp3Bytes[11] = 0xfb;
    mp3Bytes[12] = 0x90;

    await fileInput.setInputFiles({
      name: 'test-session-audio.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from(mp3Bytes),
    });

    // File metadata should be visible
    await expect(page.getByTestId('selected-file-name')).toHaveText('test-session-audio.mp3');
    await expect(page.getByTestId('selected-file-size')).toContainText('4.0 KB');

    // Click the confirm upload button — triggers the mutation
    const confirmBtn = page.getByTestId('confirm-upload-btn');
    await confirmBtn.click();

    // The progress section should appear (mutation started)
    await expect(page.getByTestId('upload-progress-section')).toBeVisible({ timeout: 15_000 });

    // Wait for either success (sheet closes) or error (toast appears).
    // In the e2e environment, the full round-trip may fail due to Storage
    // mock limitations or Inngest send timeout. We accept either outcome
    // and verify the database state separately.
    //
    // The key assertion is that requestAudioUploadUrl created a row.
    // Even if the flow errors after the INSERT, the row exists.
    //
    // Give the mutation time to reach the INSERT step (which happens
    // before the signed URL is created from Storage).
    await page.waitForTimeout(10_000);

    // Verify the ai_transcriptions row exists in the database.
    // requestAudioUploadUrl INSERTs a row with status='pending' before
    // calling Storage SDK. Even if Storage fails, the row should exist.
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      const rows = await sql`
        SELECT id, status, source, audio_object_key, user_id, patient_id
        FROM public.ai_transcriptions
        WHERE user_id = ${seed.userId}
          AND patient_id = ${patientId}
          AND source = 'manual_upload'
        ORDER BY created_at DESC
        LIMIT 1;
      `;

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.status).toBe('pending');
      expect(row.source).toBe('manual_upload');
      expect(row.user_id).toBe(seed.userId);
      expect(row.patient_id).toBe(patientId);
    } finally {
      await sql.end();
    }
  });
});
