import { expect, test as baseTest } from '@playwright/test';

import { test } from '../setup/db-fixture';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @prontuario -- Treatment Plan E2E tests.
 *
 * Tests the "Plano" tab inside the prontuario shell:
 *   1. Happy path: open prontuario, navigate to Plano tab, see empty state,
 *      click CTA, add 2 goals with descriptions, 1 phase with title, fill
 *      Tiptap resources and criteria editors, wait for auto-save indicator,
 *      reload page, assert everything persists.
 *   2. Version history: edit a goal description, wait for auto-save, open
 *      Historico de versoes sheet, assert v1 and v2 visible with timestamps,
 *      click Eye on v1, assert prior content visible in read-only snapshot.
 *   3. Negative-auth: anonymous GET to /pacientes/[id]/prontuario redirects
 *      to /login (re-asserts middleware gating for this route).
 *
 * Prerequisites:
 *   - Seeded storageState provides an authenticated psychologist.
 *   - Patient with ID SEED_PATIENTS.activeMinimal exists (seeded in globalSetup).
 *   - No pre-existing treatment plan for the test patient (cleaned in beforeEach).
 */

const SEED_USER_ID = '00000000-0000-4000-8000-000000000001';

test.describe('@prontuario treatment plan tab', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // Auto-save debounce is 10s, plus network overhead for upsert + reload.
  test.setTimeout(120_000);

  // Run serially: tests share the same patient and beforeEach cleanup
  // would race under parallel execution.
  test.describe.configure({ mode: 'serial' });

  // Use activeMinimal to avoid collision with evolution tests that use activeWithPhone
  const patientId = SEED_PATIENTS.activeMinimal.id;

  test.beforeEach(async ({ db }) => {
    // Clean up any existing treatment plan data for this patient so we start fresh.
    // Versions cascade-delete with the plan row (FK ON DELETE CASCADE).
    await db.sql`
      DELETE FROM public.treatment_plan_versions
      WHERE plan_id IN (
        SELECT id FROM public.treatment_plans
        WHERE patient_id = ${patientId}
          AND user_id = ${SEED_USER_ID}
      )
    `;
    await db.sql`
      DELETE FROM public.treatment_plans
      WHERE patient_id = ${patientId}
        AND user_id = ${SEED_USER_ID}
    `;
  });

  test('happy path: creates treatment plan with goals, phase, resources, criteria — persists after reload', async ({
    page,
  }) => {
    // 1. Navigate to the patient's prontuario page
    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();

    // 2. Click the "Plano" tab
    await page.getByTestId('prontuario-tab-plano').click();
    await expect(page.getByTestId('prontuario-tab-content-plano')).toBeVisible();

    // 3. Verify empty state is displayed
    await expect(page.getByTestId('treatment-plan-empty-state')).toBeVisible();
    await expect(page.getByText('Plano terapeutico ainda nao criado')).toBeVisible();

    // 4. Click "Criar plano terapeutico" CTA
    await page.getByTestId('treatment-plan-create-cta').click();

    // 5. Editor should appear (empty state disappears)
    await expect(page.getByTestId('treatment-plan-editor')).toBeVisible();

    // 6. Add 2 goals with descriptions
    const goalsAddButton = page.getByTestId('goals-add-button');

    // Goal 1
    await goalsAddButton.click();
    const goal0 = page.getByTestId('goal-item-0');
    await expect(goal0).toBeVisible();
    const goal0Textarea = goal0.locator('textarea');
    await goal0Textarea.fill('Reduzir sintomas de ansiedade em situacoes sociais');

    // Goal 2
    await goalsAddButton.click();
    const goal1 = page.getByTestId('goal-item-1');
    await expect(goal1).toBeVisible();
    const goal1Textarea = goal1.locator('textarea');
    await goal1Textarea.fill('Desenvolver habilidades de regulacao emocional');

    // 7. Add 1 phase with title
    const phasesAddButton = page.getByTestId('phases-add-button');
    await phasesAddButton.click();
    const phase0 = page.getByTestId('phase-item-0');
    await expect(phase0).toBeVisible();
    const phaseTitleInput = phase0.locator('input');
    await phaseTitleInput.fill('Fase de avaliacao e psicoeducacao');

    // 8. Fill Tiptap resources editor
    const resourcesEditor = page.getByTestId('resources-editor');
    const resourcesTiptap = resourcesEditor.locator('.tiptap[contenteditable="true"]');
    await resourcesTiptap.click();
    await resourcesTiptap.fill('Tecnicas de relaxamento e respiracao diafragmatica');

    // 9. Fill Tiptap success criteria editor
    const criteriaEditor = page.getByTestId('success-criteria-editor');
    const criteriaTiptap = criteriaEditor.locator('.tiptap[contenteditable="true"]');
    await criteriaTiptap.click();
    await criteriaTiptap.fill('Reducao de 50% nos episodios de ansiedade relatados');

    // 10. Wait for auto-save indicator to show "Salvo as HH:MM"
    //     Auto-save debounce is 10s — wait with generous timeout.
    const autoSaveIndicator = page.getByTestId('auto-save-indicator');
    await expect(autoSaveIndicator).toContainText(/Salvo as \d{2}:\d{2}/, { timeout: 30_000 });

    // 11. Reload page and re-navigate to Plano tab to verify persistence
    await page.reload();
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-plano').click();
    await expect(page.getByTestId('prontuario-tab-content-plano')).toBeVisible();

    // Wait for treatment plan editor to load (loading spinner then editor)
    await expect(page.getByTestId('treatment-plan-editor')).toBeVisible({ timeout: 10_000 });

    // 12. Assert goals persist
    const reloadedGoal0 = page.getByTestId('goal-item-0');
    await expect(reloadedGoal0).toBeVisible();
    await expect(reloadedGoal0.locator('textarea')).toHaveValue(
      'Reduzir sintomas de ansiedade em situacoes sociais',
    );

    const reloadedGoal1 = page.getByTestId('goal-item-1');
    await expect(reloadedGoal1).toBeVisible();
    await expect(reloadedGoal1.locator('textarea')).toHaveValue(
      'Desenvolver habilidades de regulacao emocional',
    );

    // 13. Assert phase persists
    const reloadedPhase0 = page.getByTestId('phase-item-0');
    await expect(reloadedPhase0).toBeVisible();
    await expect(reloadedPhase0.locator('input')).toHaveValue('Fase de avaliacao e psicoeducacao');

    // 14. Assert Tiptap rich text content persists
    const reloadedResourcesTiptap = page
      .getByTestId('resources-editor')
      .locator('.tiptap[contenteditable="true"]');
    await expect(reloadedResourcesTiptap).toContainText(
      'Tecnicas de relaxamento e respiracao diafragmatica',
    );

    const reloadedCriteriaTiptap = page
      .getByTestId('success-criteria-editor')
      .locator('.tiptap[contenteditable="true"]');
    await expect(reloadedCriteriaTiptap).toContainText(
      'Reducao de 50% nos episodios de ansiedade relatados',
    );
  });

  test('edit goal triggers new version — version history shows v1 and v2, Eye on v1 shows prior content', async ({
    page,
    db,
  }) => {
    // Pre-seed a treatment plan with one goal so we start with v1 already saved
    const planId = '00000000-0000-4000-8000-000000000070';
    const goalId = '00000000-0000-4000-8000-000000000071';
    const originalDescription = 'Objetivo original do plano terapeutico';
    const editedDescription = 'Objetivo editado com nova formulacao clinica';

    const goalsJson = JSON.stringify([
      { id: goalId, description: originalDescription, targetDate: null, order: 0 },
    ]);

    await db.sql`
      INSERT INTO public.treatment_plans (
        id, user_id, patient_id, goals, phases, resources, success_criteria,
        current_version, created_at, updated_at
      ) VALUES (
        ${planId},
        ${SEED_USER_ID},
        ${patientId},
        ${goalsJson}::jsonb,
        '[]'::jsonb,
        NULL,
        NULL,
        1,
        now(),
        now()
      )
    `;

    // Seed version 1
    const versionContent = JSON.stringify({
      goals: [{ id: goalId, description: originalDescription, targetDate: null, order: 0 }],
      phases: [],
      resources: null,
      successCriteria: null,
    });

    await db.sql`
      INSERT INTO public.treatment_plan_versions (
        id, plan_id, version_number, content, modified_by, created_at
      ) VALUES (
        gen_random_uuid(),
        ${planId},
        1,
        ${versionContent}::jsonb,
        ${SEED_USER_ID},
        now() - interval '5 minutes'
      )
    `;

    // 1. Navigate to prontuario and open Plano tab
    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-plano').click();
    await expect(page.getByTestId('prontuario-tab-content-plano')).toBeVisible();

    // 2. Wait for the editor to load with pre-seeded data
    await expect(page.getByTestId('treatment-plan-editor')).toBeVisible({ timeout: 10_000 });

    // 3. Verify goal 0 has the original description
    const goalItem = page.getByTestId('goal-item-0');
    await expect(goalItem).toBeVisible();
    await expect(goalItem.locator('textarea')).toHaveValue(originalDescription);

    // 4. Edit the goal description — clear and type new content
    const goalTextarea = goalItem.locator('textarea');
    await goalTextarea.clear();
    await goalTextarea.fill(editedDescription);

    // 5. Wait for auto-save indicator to show "Salvo as HH:MM" (10s debounce + save)
    const autoSaveIndicator = page.getByTestId('auto-save-indicator');
    await expect(autoSaveIndicator).toContainText(/Salvo as \d{2}:\d{2}/, { timeout: 30_000 });

    // 6. Open version history sheet
    await page.getByTestId('treatment-plan-version-history-trigger').click();
    await expect(page.getByTestId('treatment-plan-version-history-sheet')).toBeVisible();

    // 7. Assert v1 and v2 are visible with timestamps
    const versionItem1 = page.getByTestId('treatment-plan-version-item-1');
    const versionItem2 = page.getByTestId('treatment-plan-version-item-2');

    await expect(versionItem2).toBeVisible({ timeout: 5_000 });
    await expect(versionItem1).toBeVisible();

    // Both should have pt-BR formatted timestamps (e.g., "17 de mai de 2026, 14:30")
    await expect(versionItem1).toContainText(/\d{2} de \w+ de \d{4}, \d{2}:\d{2}/);
    await expect(versionItem2).toContainText(/\d{2} de \w+ de \d{4}, \d{2}:\d{2}/);

    // Both should show their version badge
    await expect(versionItem1).toContainText('v1');
    await expect(versionItem2).toContainText('v2');

    // 8. Click Eye on v1 to view read-only snapshot
    const eyeButtonV1 = versionItem1.getByRole('button', { name: 'Ver versao 1' });
    await eyeButtonV1.click();

    // 9. Assert the v1 snapshot shows the original goal description
    const snapshot = page.getByTestId('treatment-plan-version-snapshot-1');
    await expect(snapshot).toBeVisible({ timeout: 5_000 });
    await expect(snapshot).toContainText(originalDescription);
  });
});

// ---------------------------------------------------------------------------
// Negative-auth test — must NOT use storageState (anonymous browser)
// ---------------------------------------------------------------------------

baseTest.describe('@prontuario treatment plan negative-auth', () => {
  // No storageState — unauthenticated browser context

  baseTest('anonymous GET to /pacientes/[id]/prontuario redirects to /login', async ({ page }) => {
    const patientId = SEED_PATIENTS.activeMinimal.id;
    const targetPath = `/pacientes/${patientId}/prontuario`;

    // Navigate without any auth cookies
    const response = await page.goto(targetPath);

    // Middleware should redirect to /login
    await page.waitForURL('**/login**', { timeout: 10_000 });

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');

    // The redirectTo query parameter should preserve the original destination
    const redirectTo = url.searchParams.get('redirectTo');
    expect(redirectTo).toBe(targetPath);

    // Response should not be a server error (redirect, not 500)
    expect(response?.status()).toBeLessThan(500);
  });
});
