import { expect, test } from '@playwright/test';
import pgModule from 'postgres';

import { readSeedState, SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @ai-transcription -- Settings usage stats (section 5.3).
 *
 * The stats panel withholds the acceptance rate ("Dados insuficientes") until
 * at least 5 transcriptions have been reviewed (MIN_REVIEWED_FOR_ACCEPTANCE),
 * because the ratio is statistically meaningless on a tiny sample.
 *
 * Phase 1: seed 3 reviewed transcriptions (1 saved without edits) → reviewed=3
 *          (< 5) → the "Taxa de aceitação" card reads "Dados insuficientes".
 *          (`totalProcessed` is 3 > 0, so the metric grid renders rather than
 *          the empty state.)
 * Phase 2: seed 7 more reviewed transcriptions (6 saved without edits) →
 *          reviewed=10, acceptedWithoutEdits=7 → revisit shows 70%.
 *
 * acceptanceRatePercent = round(acceptedWithoutEdits / reviewed * 100), where
 * `acceptedWithoutEdits` = rows with `saved_to_prontuario AND user_edits_count
 * = 0`. We delete every transcription for the seed user up front so the counts
 * are fully controlled and not polluted by the global-setup review fixtures.
 *
 * Spec: openspec/changes/ai-transcription-settings-ui.
 */
test.describe('@ai-transcription settings — usage stats acceptance rate', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // Deterministic ids for the rows this spec owns, so cleanup is exact.
  const STATS_ID_PREFIX = '00000000-0000-4000-8000-0000000005';

  /**
   * Insert `count` reviewed transcriptions for the seed user, of which
   * `acceptedCount` are saved to prontuário with zero edits (the acceptance
   * numerator). `offset` keeps ids unique across the two phases.
   */
  async function seedReviewed(
    sql: pgModule.Sql,
    userId: string,
    patientId: string,
    count: number,
    acceptedCount: number,
    offset: number,
  ): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      const accepted = i < acceptedCount;
      // 2-hex-digit suffix, unique per (offset + i).
      const suffix = (offset + i).toString(16).padStart(2, '0');
      const id = `${STATS_ID_PREFIX}${suffix}`;
      await sql`
        INSERT INTO public.ai_transcriptions (
          id, user_id, patient_id, source,
          status, saved_to_prontuario, user_edits_count
        )
        VALUES (
          ${id}, ${userId}, ${patientId}, 'manual_upload',
          'reviewed', ${accepted}, ${accepted ? 0 : 2}
        )
        ON CONFLICT (id) DO UPDATE SET
          status              = 'reviewed',
          saved_to_prontuario = EXCLUDED.saved_to_prontuario,
          user_edits_count    = EXCLUDED.user_edits_count;
      `;
    }
  }

  test('withholds the rate under 5 reviews, then reports 70%', async ({ page }) => {
    test.setTimeout(60_000);

    const seed = await readSeedState();
    const patientId = SEED_PATIENTS.activeMinimal.id;
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });

    try {
      // Clean slate: own all transcription counts for this user.
      await sql`DELETE FROM public.ai_transcriptions WHERE user_id = ${seed.userId};`;

      // Phase 1: 3 reviewed, 1 accepted without edits → reviewed < 5.
      await seedReviewed(sql, seed.userId, patientId, 3, 1, 0);

      await page.goto('/configuracoes/transcricao-ia');
      // The metric grid renders (totalProcessed = 3 > 0), not the empty state.
      await expect(page.getByTestId('transcription-stats-grid')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('transcription-stats-empty')).toHaveCount(0);
      // Acceptance is withheld below the 5-review threshold.
      await expect(page.getByText('Dados insuficientes')).toBeVisible();

      // Phase 2: 7 more reviewed, 6 accepted → reviewed=10, accepted=7 → 70%.
      await seedReviewed(sql, seed.userId, patientId, 7, 6, 3);

      await page.goto('/configuracoes/transcricao-ia');
      await expect(page.getByTestId('transcription-stats-grid')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('70%')).toBeVisible();
      await expect(page.getByText('Dados insuficientes')).toHaveCount(0);
    } finally {
      // Restore the seed user's transcription fixtures for any later spec by
      // removing only the rows this spec inserted; global-setup re-seeds the
      // review fixtures on the next full run.
      await sql`
        DELETE FROM public.ai_transcriptions
        WHERE user_id = ${seed.userId}
          AND id::text LIKE ${`${STATS_ID_PREFIX}%`};
      `;
      await sql.end();
    }
  });
});
