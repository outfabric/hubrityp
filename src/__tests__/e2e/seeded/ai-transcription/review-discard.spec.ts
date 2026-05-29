import { expect, test } from '@playwright/test';
import pgModule from 'postgres';

import {
  readSeedState,
  SEED_AI_TRANSCRIPTIONS,
  SEED_PATIENTS,
  STORAGE_STATE_PATH,
} from '../setup/seed-state';

/**
 * @ai-transcription -- Review discard flow (section 11.4).
 *
 * With a seeded `ready` transcription (SEED_AI_TRANSCRIPTIONS.readyForDiscard):
 *   1. open the review page,
 *   2. click "Descartar e escrever manualmente",
 *   3. type the confirmation word ("DESCARTAR"),
 *   4. confirm,
 *   5. assert redirect to the new-evolution (manual) flow + success toast.
 *
 * Spec: specs/ai-transcription-review-ui/spec.md.
 */
test.describe('@ai-transcription review — discard and write manually', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  const transcriptionId = SEED_AI_TRANSCRIPTIONS.readyForDiscard.id;
  const patientId = SEED_AI_TRANSCRIPTIONS.readyForDiscard.patientId;

  // Reset to a clean `ready` state so the discard transition is always valid
  // on retries/reruns (discard moves the row to status='reviewed').
  test.beforeEach(async () => {
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      await sql`
        UPDATE public.ai_transcriptions
        SET status     = 'ready',
            reviewed_at = NULL,
            updated_at  = now()
        WHERE id = ${transcriptionId} AND user_id = ${seed.userId};
      `;
    } finally {
      await sql.end();
    }
  });

  test('discard confirms and redirects to the manual new-evolution flow', async ({ page }) => {
    test.setTimeout(60_000);

    // Sanity: patient must be the seeded one so the redirect target is known.
    expect(patientId).toBe(SEED_PATIENTS.activeMinimal.id);

    await page.goto(`/dashboard/transcricoes/${transcriptionId}/revisar`);

    await expect(page.getByTestId('transcription-review-form')).toBeVisible({ timeout: 15_000 });

    // Open the discard confirmation dialog.
    await page.getByTestId('discard-btn').click();
    await expect(page.getByTestId('discard-dialog')).toBeVisible();

    // The confirm button stays disabled until the exact word is typed.
    const confirmBtn = page.getByTestId('discard-confirm-btn');
    await expect(confirmBtn).toBeDisabled();

    await page.getByTestId('discard-confirm-input').fill('DESCARTAR');
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // Success toast + redirect to the new-evolution editor for the patient.
    await expect(page.getByText('Nota descartada. Escreva a evolução manualmente.')).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForURL(`**/pacientes/${patientId}/prontuario/evolucoes/nova**`, {
      timeout: 15_000,
    });

    const url = new URL(page.url());
    expect(url.pathname).toBe(`/pacientes/${patientId}/prontuario/evolucoes/nova`);

    // DB: the transcription was marked reviewed (discarded), not saved.
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      const rows = await sql`
        SELECT status, saved_to_prontuario, evolution_id
        FROM public.ai_transcriptions
        WHERE id = ${transcriptionId} AND user_id = ${seed.userId};
      `;
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.status).toBe('reviewed');
      expect(row.saved_to_prontuario).toBe(false);
      expect(row.evolution_id).toBeNull();
    } finally {
      await sql.end();
    }
  });
});
