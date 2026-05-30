import { expect, test } from '@playwright/test';
import pgModule from 'postgres';

import { readSeedState, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @ai-transcription -- Settings flow happy path (section 5.1).
 *
 * Authenticated psychologist:
 *   1. opens `/configuracoes`,
 *   2. clicks the "Transcrição IA" settings card,
 *   3. the settings form renders with the persisted defaults (first visit
 *      lazily creates the row: enabled=false, template='livre',
 *      sensitivity='medium', retenção=24h, manter transcrição=off),
 *   4. enables the feature and changes the default template,
 *   5. saves → success toast appears,
 *   6. revisits the page → the changed values are persisted.
 *
 * The settings row is owner-scoped (`user_id = session.uid`); we reset it in
 * `beforeEach` (DELETE) so each run/retry starts from the clean default state
 * the first-visit upsert produces — deterministic across reused Testcontainers.
 *
 * Spec: openspec/changes/ai-transcription-settings-ui.
 */
test.describe('@ai-transcription settings — enable, change template, persist', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async () => {
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      // Drop the row so the first page visit re-creates the canonical defaults
      // via the `getTranscriptionSettings` upsert.
      await sql`
        DELETE FROM public.ai_transcription_settings
        WHERE user_id = ${seed.userId};
      `;
    } finally {
      await sql.end();
    }
  });

  test('navigates from the settings index, edits, saves, and persists', async ({ page }) => {
    test.setTimeout(60_000);

    // 1. Settings index.
    await page.goto('/configuracoes');
    await expect(page.getByTestId('settings-index-page')).toBeVisible({ timeout: 15_000 });

    // 2. Click the "Transcrição IA" card.
    await page.getByTestId('settings-area-card-transcricao-ia').click();
    await page.waitForURL(/\/configuracoes\/transcricao-ia$/, { timeout: 15_000 });

    // 3. Form renders with the persisted defaults.
    const form = page.getByTestId('transcription-settings-form');
    await expect(form).toBeVisible({ timeout: 15_000 });

    const enabledSwitch = page.getByTestId('transcription-settings-enabled');
    const keepTranscriptionSwitch = page.getByTestId('transcription-settings-keep-transcription');
    // Defaults: feature off, "manter transcrição" off.
    await expect(enabledSwitch).toHaveAttribute('data-state', 'unchecked');
    await expect(keepTranscriptionSwitch).toHaveAttribute('data-state', 'unchecked');
    // Default template is "Livre".
    await expect(page.getByTestId('transcription-settings-template')).toContainText('Livre');

    // 4. Enable the feature and change the default template to TCC.
    await enabledSwitch.click();
    await expect(enabledSwitch).toHaveAttribute('data-state', 'checked');

    await page.getByTestId('transcription-settings-template').click();
    await page.getByRole('option', { name: 'TCC' }).click();
    await expect(page.getByTestId('transcription-settings-template')).toContainText('TCC');

    // 5. Save → success toast. Enabling (off -> on) never triggers the disable
    //    confirmation dialog, so the action runs directly.
    await page.getByTestId('transcription-settings-save').click();
    await expect(page.getByText('Configurações salvas')).toBeVisible({ timeout: 15_000 });

    // -----------------------------------------------------------------------
    // DB assertion: the owner-scoped row reflects the edits.
    // -----------------------------------------------------------------------
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      const rows = await sql`
        SELECT enabled, default_template, risk_detection_sensitivity,
               keep_audio_hours, keep_transcription
        FROM public.ai_transcription_settings
        WHERE user_id = ${seed.userId};
      `;
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.enabled).toBe(true);
      expect(row.default_template).toBe('tcc');
      // Unchanged fields keep their defaults.
      expect(row.risk_detection_sensitivity).toBe('medium');
      expect(Number(row.keep_audio_hours)).toBe(24);
      expect(row.keep_transcription).toBe(false);
    } finally {
      await sql.end();
    }

    // 6. Revisit the page — the persisted values render (not the defaults).
    await page.goto('/configuracoes/transcricao-ia');
    await expect(page.getByTestId('transcription-settings-form')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('transcription-settings-enabled')).toHaveAttribute(
      'data-state',
      'checked',
    );
    await expect(page.getByTestId('transcription-settings-template')).toContainText('TCC');
  });
});
