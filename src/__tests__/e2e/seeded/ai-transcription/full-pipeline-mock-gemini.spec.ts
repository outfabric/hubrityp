import { expect, test } from '@playwright/test';
import pgModule from 'postgres';

import {
  readSeedState,
  SEED_AI_TRANSCRIPTIONS,
  SEED_PATIENTS,
  STORAGE_STATE_PATH,
} from '../setup/seed-state';

/**
 * @ai-transcription -- Full pipeline E2E test (mock Gemini).
 *
 * Validates the AI transcription pipeline's database lifecycle end-to-end:
 *   1. Seed state: `ai_transcriptions` row in `pending` status with audio key
 *   2. Navigate to the patient page to verify the seeded patient is visible
 *   3. Simulate pipeline processing: transition through status states
 *      (pending -> transcribing -> generating -> ready) via direct DB writes
 *   4. Assert final DB row has correct shape: status='ready', generated_note
 *      matches GeneratedNoteSchema (schemaVersion=1), risk_alerts populated,
 *      completedAt set, template_used recorded
 *
 * Why simulate via DB instead of invoking Inngest?
 *   The seeded e2e suite does not run an Inngest dev server. The actual Gemini
 *   calls require API credentials not available in the test environment. By
 *   writing the pipeline's output directly, we validate that the schema accepts
 *   the full lifecycle state machine and that the data relationships (user,
 *   patient, consent) are correctly established.
 *
 * The actual review UI is the next change — for now we verify the DB contract.
 *
 * Prerequisites:
 *   - Seeded `activeMinimal` patient with a signed `ai_recording` consent term
 *   - Seeded `ai_transcriptions` row (SEED_AI_TRANSCRIPTIONS.pendingPipeline)
 *   - Authenticated session via storageState
 */

// Serial: both tests share the same seeded `ai_transcriptions` row — running
// in parallel would cause race conditions on the row status.
test.describe.serial('@ai-transcription full pipeline (mock Gemini)', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // Reset the transcription row to 'pending' before each test so retries
  // and subsequent tests always start from a clean state.
  test.beforeEach(async () => {
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });
    try {
      await sql`
        UPDATE public.ai_transcriptions
        SET status         = 'pending',
            generated_note = NULL,
            risk_alerts    = NULL,
            template_used  = NULL,
            completed_at   = NULL,
            reviewed_at    = NULL,
            error_code     = NULL,
            updated_at     = now()
        WHERE id = ${SEED_AI_TRANSCRIPTIONS.pendingPipeline.id};
      `;
    } finally {
      await sql.end();
    }
  });

  test('pipeline lifecycle: pending -> transcribing -> generating -> ready with valid note shape', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const transcriptionId = SEED_AI_TRANSCRIPTIONS.pendingPipeline.id;
    const patientId = SEED_AI_TRANSCRIPTIONS.pendingPipeline.patientId;

    // -----------------------------------------------------------------------
    // Step 1: Navigate to the patient page to confirm seeded data is reachable
    // -----------------------------------------------------------------------
    await page.goto(`/pacientes/${patientId}`);

    await expect(
      page.getByText(SEED_PATIENTS.activeMinimal.fullName, { exact: false }),
    ).toBeVisible({ timeout: 15_000 });

    // -----------------------------------------------------------------------
    // Step 2: Verify the seeded transcription row exists with status='pending'
    // -----------------------------------------------------------------------
    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });

    try {
      const pendingRows = await sql`
        SELECT id, status, source, audio_object_key, user_id, patient_id,
               generated_note, risk_alerts, completed_at, template_used
        FROM public.ai_transcriptions
        WHERE id = ${transcriptionId}
          AND user_id = ${seed.userId};
      `;

      expect(pendingRows).toHaveLength(1);
      const pendingRow = pendingRows[0]!;
      expect(pendingRow.status).toBe('pending');
      expect(pendingRow.source).toBe('manual_upload');
      expect(pendingRow.audio_object_key).toBe(
        SEED_AI_TRANSCRIPTIONS.pendingPipeline.audioObjectKey,
      );
      expect(pendingRow.patient_id).toBe(patientId);
      expect(pendingRow.generated_note).toBeNull();
      expect(pendingRow.risk_alerts).toBeNull();
      expect(pendingRow.completed_at).toBeNull();

      // -----------------------------------------------------------------------
      // Step 3: Simulate pipeline status transitions
      // The real Inngest function transitions through these states. We simulate
      // each to verify the CHECK constraint allows the full state machine.
      // -----------------------------------------------------------------------

      // pending -> transcribing
      await sql`
        UPDATE public.ai_transcriptions
        SET status = 'transcribing', updated_at = now()
        WHERE id = ${transcriptionId} AND user_id = ${seed.userId};
      `;

      const transcribingRows = await sql`
        SELECT status FROM public.ai_transcriptions WHERE id = ${transcriptionId};
      `;
      expect(transcribingRows[0]!.status).toBe('transcribing');

      // transcribing -> generating
      await sql`
        UPDATE public.ai_transcriptions
        SET status = 'generating', updated_at = now()
        WHERE id = ${transcriptionId} AND user_id = ${seed.userId};
      `;

      const generatingRows = await sql`
        SELECT status FROM public.ai_transcriptions WHERE id = ${transcriptionId};
      `;
      expect(generatingRows[0]!.status).toBe('generating');

      // -----------------------------------------------------------------------
      // Step 4: Simulate pipeline completion — write the generated note, risk
      // alerts, and transition to 'ready'. This mirrors what step 12 (persist-note)
      // of the Inngest function does.
      // -----------------------------------------------------------------------

      const mockGeneratedNote = JSON.stringify({
        schemaVersion: 1,
        humorInicial: 'Ansioso, com sinais de preocupacao',
        humorFinal: 'Mais calmo, com plano de acao definido',
        pauta: ['Ansiedade relacionada ao trabalho', 'Dificuldades no sono'],
        conteudoTrabalhado: [
          'Tecnicas de respiracao diafragmatica',
          'Registro de pensamentos automaticos',
          'Reestruturacao cognitiva sobre crencas de desempenho',
        ],
        tarefaCasa: [
          'Praticar respiracao 4-7-8 antes de dormir',
          'Preencher registro de pensamentos 3x por semana',
        ],
        palavrasRisco: [],
        observacoesExtras:
          'Paciente demonstrou boa adesao as tecnicas. Reavaliacao do sono na proxima sessao.',
      });

      const mockRiskAlerts = JSON.stringify([
        {
          kind: 'substance_abuse',
          excerpt: 'Mencionou uso ocasional de alcool para lidar com insonia',
          confidence: 'low',
        },
      ]);

      const templateUsed = 'tcc:v1+t:v1';

      await sql`
        UPDATE public.ai_transcriptions
        SET status            = 'ready',
            generated_note    = ${mockGeneratedNote}::jsonb,
            risk_alerts       = ${mockRiskAlerts}::jsonb,
            template_used     = ${templateUsed},
            completed_at      = now(),
            updated_at        = now()
        WHERE id = ${transcriptionId}
          AND user_id = ${seed.userId};
      `;

      // -----------------------------------------------------------------------
      // Step 5: Assert the final DB state matches the expected pipeline output
      // -----------------------------------------------------------------------

      const readyRows = await sql`
        SELECT id, status, source, audio_object_key, user_id, patient_id,
               generated_note, risk_alerts, completed_at, template_used,
               error_code, retry_count
        FROM public.ai_transcriptions
        WHERE id = ${transcriptionId}
          AND user_id = ${seed.userId};
      `;

      expect(readyRows).toHaveLength(1);
      const readyRow = readyRows[0]!;

      // Status and metadata
      expect(readyRow.status).toBe('ready');
      expect(readyRow.template_used).toBe(templateUsed);
      expect(readyRow.completed_at).not.toBeNull();
      expect(readyRow.error_code).toBeNull();

      // Generated note shape (GeneratedNoteSchema v1)
      // postgres.js returns JSONB as a parsed object, but the column name is
      // snake_case. The JSON itself uses camelCase keys.
      const noteRaw: unknown = readyRow.generated_note;
      const note = (
        typeof noteRaw === 'string' ? (JSON.parse(noteRaw) as Record<string, unknown>) : noteRaw
      ) as Record<string, unknown>;
      expect(note.schemaVersion).toBe(1);
      expect(note.humorInicial).toBeTruthy();
      expect(note.humorFinal).toBeTruthy();
      expect(Array.isArray(note.pauta)).toBe(true);
      expect((note.pauta as string[]).length).toBeGreaterThan(0);
      expect(Array.isArray(note.conteudoTrabalhado)).toBe(true);
      expect((note.conteudoTrabalhado as string[]).length).toBeGreaterThan(0);
      expect(Array.isArray(note.tarefaCasa)).toBe(true);
      expect(Array.isArray(note.palavrasRisco)).toBe(true);

      // Risk alerts shape (RiskAlertSchema[])
      const alertsRaw: unknown = readyRow.risk_alerts;
      const alerts = (
        typeof alertsRaw === 'string'
          ? (JSON.parse(alertsRaw) as Array<Record<string, unknown>>)
          : alertsRaw
      ) as Array<Record<string, unknown>>;
      expect(Array.isArray(alerts)).toBe(true);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.kind).toBe('substance_abuse');
      expect(alerts[0]!.confidence).toBe('low');
      expect(typeof alerts[0]!.excerpt).toBe('string');

      // Ownership unchanged
      expect(readyRow.user_id).toBe(seed.userId);
      expect(readyRow.patient_id).toBe(patientId);
      expect(readyRow.source).toBe('manual_upload');
      expect(readyRow.audio_object_key).toBe(SEED_AI_TRANSCRIPTIONS.pendingPipeline.audioObjectKey);

      // -----------------------------------------------------------------------
      // Step 6: Verify 'reviewed' transition is also valid (full state machine)
      // -----------------------------------------------------------------------
      await sql`
        UPDATE public.ai_transcriptions
        SET status      = 'reviewed',
            reviewed_at = now(),
            updated_at  = now()
        WHERE id = ${transcriptionId}
          AND user_id = ${seed.userId};
      `;

      const reviewedRows = await sql`
        SELECT status, reviewed_at FROM public.ai_transcriptions
        WHERE id = ${transcriptionId};
      `;
      expect(reviewedRows[0]!.status).toBe('reviewed');
      expect(reviewedRows[0]!.reviewed_at).not.toBeNull();
    } finally {
      await sql.end();
    }
  });

  test('pipeline failure state: pending -> failed with error_code persisted', async ({ page }) => {
    test.setTimeout(60_000);

    const transcriptionId = SEED_AI_TRANSCRIPTIONS.pendingPipeline.id;
    const patientId = SEED_AI_TRANSCRIPTIONS.pendingPipeline.patientId;

    // Navigate to the patient page to verify seeded data is accessible
    await page.goto(`/pacientes/${patientId}`);
    await expect(
      page.getByText(SEED_PATIENTS.activeMinimal.fullName, { exact: false }),
    ).toBeVisible({ timeout: 15_000 });

    const seed = await readSeedState();
    const sql = pgModule(seed.databaseUrl, { max: 1, onnotice: () => {} });

    try {
      // Simulate a failed pipeline: pending -> transcribing -> failed
      await sql`
        UPDATE public.ai_transcriptions
        SET status = 'transcribing', updated_at = now()
        WHERE id = ${transcriptionId} AND user_id = ${seed.userId};
      `;

      await sql`
        UPDATE public.ai_transcriptions
        SET status     = 'failed',
            error_code = 'gemini_safety_block',
            updated_at = now()
        WHERE id = ${transcriptionId} AND user_id = ${seed.userId};
      `;

      const failedRows = await sql`
        SELECT status, error_code, generated_note, completed_at
        FROM public.ai_transcriptions
        WHERE id = ${transcriptionId}
          AND user_id = ${seed.userId};
      `;

      expect(failedRows).toHaveLength(1);
      const failedRow = failedRows[0]!;
      expect(failedRow.status).toBe('failed');
      expect(failedRow.error_code).toBe('gemini_safety_block');
      expect(failedRow.generated_note).toBeNull();
      expect(failedRow.completed_at).toBeNull();
    } finally {
      await sql.end();
    }
  });
});
