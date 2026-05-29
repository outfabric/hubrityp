import { expect, test } from '@playwright/test';
import pgModule from 'postgres';

import { readSeedState, SEED_AI_TRANSCRIPTIONS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @ai-transcription -- Review + save happy path (section 11.3).
 *
 * With a seeded `ready` transcription (SEED_AI_TRANSCRIPTIONS.readyForSave):
 *   1. open the review page,
 *   2. edit a field,
 *   3. check the "revisei" box,
 *   4. click "Salvar no prontuário",
 *   5. assert the UI redirects to the created evolution and shows a success
 *      toast,
 *   6. assert the DB has an evolution with `ai_assisted = true` and
 *      `ai_transcription_id` set to the transcription, and the transcription
 *      flipped to reviewed + saved_to_prontuario.
 *
 * The row is owned by the seed user and its patient (activeMinimal) carries a
 * signed `ai_recording` consent term, which the save action re-verifies.
 *
 * Spec: specs/ai-transcription-review-ui/spec.md.
 */
test.describe('@ai-transcription review — edit, confirm, and save to prontuário', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  const transcriptionId = SEED_AI_TRANSCRIPTIONS.readyForSave.id;

  // Reset the row to a clean `ready`/unsaved state and drop any evolution a
  // previous run created, so retries and reruns are deterministic.
  test.beforeEach(async () => {
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      await sql`
        DELETE FROM public.evolutions
        WHERE user_id = ${seed.userId}
          AND ai_transcription_id = ${transcriptionId};
      `;
      await sql`
        UPDATE public.ai_transcriptions
        SET status              = 'ready',
            saved_to_prontuario = false,
            evolution_id        = NULL,
            reviewed_at         = NULL,
            updated_at          = now()
        WHERE id = ${transcriptionId} AND user_id = ${seed.userId};
      `;
    } finally {
      await sql.end();
    }
  });

  test('saves the reviewed note as a flagged evolution and redirects', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto(`/dashboard/transcricoes/${transcriptionId}/revisar`);

    // The review form must render for a `ready` transcription.
    await expect(page.getByTestId('transcription-review-form')).toBeVisible({ timeout: 15_000 });

    const seed = await readSeedState();

    // Edit a single-line field. The save flow persists the draft (via
    // `useWatch`-backed auto-save) before committing the evolution, so the typed
    // text MUST survive into the committed clinical record. This is asserted in
    // the DB section below — the human's edits are the whole point of the review
    // workflow (RF-10.15: the psychologist signs off on accurate content).
    const editedHumor = 'Humor inicial editado pelo revisor';
    const humorField = page.getByTestId('field-humorInicial');
    // Type char-by-char (not `fill`) so every keystroke dispatches the input
    // event react-hook-form's `register` subscribes to — `fill` sets the value
    // in one shot and RHF's internal store can miss it.
    await humorField.click();
    await humorField.press('Control+A');
    await humorField.press('Delete');
    await humorField.pressSequentially(editedHumor);
    await expect(humorField).toHaveValue(editedHumor);
    // Blur so the on-blur draft auto-save captures the edit before we promote.
    await humorField.blur();

    // Confirm review — this enables the primary action.
    await page.getByTestId('reviewed-checkbox').click();

    const saveBtn = page.getByTestId('save-to-prontuario-btn');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Success toast and redirect to the created evolution detail.
    await expect(page.getByText('Nota salva no prontuário.')).toBeVisible({ timeout: 15_000 });
    await page.waitForURL(/\/pacientes\/.+\/prontuario\/evolucoes\/.+/, { timeout: 15_000 });

    const url = new URL(page.url());
    expect(url.pathname).toMatch(/\/pacientes\/[^/]+\/prontuario\/evolucoes\/[^/]+$/);

    // -----------------------------------------------------------------------
    // DB assertions: a flagged evolution exists and the transcription saved.
    // -----------------------------------------------------------------------
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      const evolutions = await sql`
        SELECT id, ai_assisted, ai_transcription_id, user_id, content
        FROM public.evolutions
        WHERE user_id = ${seed.userId}
          AND ai_transcription_id = ${transcriptionId};
      `;
      expect(evolutions).toHaveLength(1);
      const evolution = evolutions[0]!;
      expect(evolution.ai_assisted).toBe(true);
      expect(evolution.ai_transcription_id).toBe(transcriptionId);
      expect(evolution.user_id).toBe(seed.userId);

      // The redirect target id matches the created evolution.
      const evolutionIdFromUrl = url.pathname.split('/').pop();
      expect(evolutionIdFromUrl).toBe(evolution.id);

      // The serialized note was committed as the evolution content (livre
      // template `{ conteudo: string }`). The edited single-line field MUST be
      // present — proving the human's edits reach the permanent clinical record
      // rather than being silently discarded (HIGH 2 regression).
      const contentRaw: unknown = evolution.content;
      const content = typeof contentRaw === 'string' ? contentRaw : JSON.stringify(contentRaw);
      expect(content).toContain('Nota gerada por IA (revisada)');
      expect(content).toContain(editedHumor);

      const transcriptionRows = await sql`
        SELECT status, saved_to_prontuario, evolution_id
        FROM public.ai_transcriptions
        WHERE id = ${transcriptionId} AND user_id = ${seed.userId};
      `;
      expect(transcriptionRows).toHaveLength(1);
      const transcription = transcriptionRows[0]!;
      expect(transcription.status).toBe('reviewed');
      expect(transcription.saved_to_prontuario).toBe(true);
      expect(transcription.evolution_id).toBe(evolution.id);
    } finally {
      await sql.end();
    }
  });
});
