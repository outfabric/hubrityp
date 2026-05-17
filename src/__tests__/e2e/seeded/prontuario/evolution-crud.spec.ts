import { expect } from '@playwright/test';

import { test } from '../setup/db-fixture';
import { SEED_PATIENTS, SEED_SESSIONS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @prontuario -- Evolution CRUD happy-path E2E test.
 *
 * Tests the full evolution creation flow:
 *   1. Navigate to a "done" session's patient prontuario page
 *   2. Click "Registrar evolucao" CTA (empty state)
 *   3. Select TCC template in the TemplateSelector ("Abordagem" dropdown)
 *   4. Fill humor_inicial, humor_final (number fields) and conteudo_trabalhado (rich text)
 *   5. Wait for the auto-save to fire and create the evolution (10s debounce)
 *   6. Verify redirect to evolution detail page with "Salvo as" indicator
 *   7. Open VersionHistoryPanel ("Historico") and verify v1 appears
 *
 * Prerequisites:
 *   - Seeded storageState provides an authenticated psychologist.
 *   - Patient with a "done" session exists (seeded in globalSetup via
 *     SEED_SESSIONS.confirmedForDone which is set to 'done' for this test).
 *   - The prontuario page is accessible at /pacientes/[id]/prontuario.
 */

test.describe('@prontuario evolution creation happy path', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // Auto-save debounce is 10s, plus network overhead and redirects.
  test.setTimeout(90_000);

  const patientId = SEED_PATIENTS.activeWithPhone.id;

  test.beforeEach(async ({ db }) => {
    // Ensure the patient has a "done" session so the prontuario page is contextually valid.
    // The confirmedForDone session is seeded as 'confirmed'; mark it as 'done' for this test.
    await db.resetSession(SEED_SESSIONS.confirmedForDone.id, {
      status: 'done',
      confirmedAt: new Date(),
    });

    // Clean up any existing evolutions for this patient so we start with empty state
    await db.sql`DELETE FROM public.evolution_versions WHERE evolution_id IN (
      SELECT id FROM public.evolutions WHERE patient_id = ${patientId}
    )`;
    await db.sql`DELETE FROM public.evolutions WHERE patient_id = ${patientId}`;
  });

  test('creates a TCC evolution via auto-save and verifies version history shows v1', async ({
    page,
  }) => {
    // 1. Navigate to the patient's prontuario page
    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();

    // 2. The evolution list should be empty — click "Registrar evolucao"
    await expect(page.getByTestId('evolutions-empty-state')).toBeVisible();
    await page.getByTestId('evolutions-empty-cta').click();

    // 3. Should navigate to the "nova evolucao" page
    await expect(page.getByTestId('nova-evolucao-page-title')).toBeVisible();
    await expect(page.getByTestId('nova-evolucao-page-title')).toHaveText('Nova evolucao');

    // 4. Select TCC template from the "Abordagem" dropdown
    const templateTrigger = page.locator('#template-type-select');
    await expect(templateTrigger).toBeVisible();
    await templateTrigger.click();

    // Select TCC option
    const tccOption = page.getByRole('option', {
      name: 'Terapia Cognitivo-Comportamental (TCC)',
    });
    await expect(tccOption).toBeVisible();
    await tccOption.click();

    // 5. Fill in the required TCC fields

    // humor_inicial (number input 0-10)
    const humorInicialInput = page.locator('#field-humor_inicial');
    await expect(humorInicialInput).toBeVisible();
    await humorInicialInput.fill('7');

    // humor_final (number input 0-10)
    const humorFinalInput = page.locator('#field-humor_final');
    await expect(humorFinalInput).toBeVisible();
    await humorFinalInput.fill('8');

    // Fill rich text fields — TCC requires: pauta_sessao, conteudo_trabalhado,
    // tarefa_casa_atribuida, tarefa_anterior_status, proximos_passos
    // The TiptapEditor uses contenteditable divs with class .tiptap
    const tiptapEditors = page.locator('.tiptap[contenteditable="true"]');

    // pauta_sessao (first rich text field in TCC)
    await tiptapEditors.nth(0).click();
    await tiptapEditors.nth(0).fill('Pauta de teste para a sessao de TCC');

    // conteudo_trabalhado (second rich text field)
    await tiptapEditors.nth(1).click();
    await tiptapEditors.nth(1).fill('Conteudo trabalhado durante a sessao');

    // tarefa_casa_atribuida (third rich text field)
    await tiptapEditors.nth(2).click();
    await tiptapEditors.nth(2).fill('Tarefa de casa atribuida ao paciente');

    // tarefa_anterior_status (select field) — select "Sim"
    const tarefaStatusTrigger = page.locator('#field-tarefa_anterior_status');
    await expect(tarefaStatusTrigger).toBeVisible();
    await tarefaStatusTrigger.click();
    const simOption = page.getByRole('option', { name: 'Sim' });
    await expect(simOption).toBeVisible();
    await simOption.click();

    // proximos_passos (fourth rich text field, after the select)
    await tiptapEditors.nth(3).click();
    await tiptapEditors.nth(3).fill('Proximos passos para o tratamento');

    // 6. Wait for auto-save to fire (10s debounce) — the creation succeeds
    //    and redirects to the evolution detail page.
    //    We detect success by waiting for the toast + URL change.
    await expect(page.getByText('Evolucao criada com sucesso')).toBeVisible({ timeout: 20_000 });

    // After successful creation, the page redirects to the detail view
    await page.waitForURL('**/prontuario/evolucoes/**', { timeout: 10_000 });

    // 7. On the detail page, verify it loaded correctly
    await expect(page.getByTestId('evolution-detail-page-title')).toBeVisible();

    // 8. Open VersionHistoryPanel ("Historico" button) and verify v1 exists
    await page.getByTestId('version-history-trigger').click();
    await expect(page.getByTestId('version-history-panel')).toBeVisible();
    await expect(page.getByTestId('version-item-1')).toBeVisible();

    // Verify "Versao 1" text is displayed
    await expect(page.getByTestId('version-item-1')).toContainText('Versao 1');
  });
});
