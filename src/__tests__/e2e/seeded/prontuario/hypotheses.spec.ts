import { expect } from '@playwright/test';

import { test } from '../setup/db-fixture';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @prontuario -- Diagnostic Hypotheses E2E tests.
 *
 * Tests the "Hipoteses Diagnosticas" tab inside the prontuario shell:
 *   1. CID-10 mode: open prontuario, navigate to tab, add hypothesis via CID-10
 *      combobox, verify card + status badge appears
 *   2. Confirm hypothesis: use the card dropdown to confirm, assert badge change
 *   3. Descriptive mode: add hypothesis without CID-10, fill description, verify
 *
 * Prerequisites:
 *   - Seeded storageState provides an authenticated psychologist.
 *   - Patient with ID SEED_PATIENTS.activeMinimal exists (seeded in globalSetup).
 *   - No pre-existing hypotheses for the test patient (cleaned in beforeEach).
 */

const SEED_USER_ID = '00000000-0000-4000-8000-000000000001';

test.describe('@prontuario diagnostic hypotheses tab', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // Run serially: all three tests share the same patient and their beforeEach
  // cleanup (DELETE WHERE patient_id) would race against each other under
  // parallel execution, causing one test's seeded hypothesis to be wiped by
  // another test's beforeEach.
  test.describe.configure({ mode: 'serial' });

  // CID-10 combobox has 250ms debounce + network round-trip for server action
  test.setTimeout(60_000);

  // Use activeMinimal to avoid collision with evolution tests that use activeWithPhone
  const patientId = SEED_PATIENTS.activeMinimal.id;

  test.beforeEach(async ({ db }) => {
    // Clean up any existing hypotheses for this patient so we start fresh
    await db.sql`
      DELETE FROM public.diagnostic_hypotheses
      WHERE patient_id = ${patientId}
        AND user_id = ${SEED_USER_ID}
    `;
  });

  test('adds a CID-10 hypothesis and verifies card appears with Em investigacao badge', async ({
    page,
  }) => {
    // 1. Navigate to the patient's prontuario page
    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();

    // 2. Click the "Hipoteses" tab
    await page.getByTestId('prontuario-tab-hipoteses').click();
    await expect(page.getByTestId('prontuario-tab-content-hipoteses')).toBeVisible();

    // 3. Verify the educational banner is visible
    await expect(page.getByTestId('hypotheses-educational-banner')).toBeVisible();
    await expect(page.getByTestId('hypotheses-educational-banner')).toContainText(
      'Hipótese diagnóstica em psicologia tem natureza de orientação clínica',
    );

    // 4. Click "Adicionar hipotese" button
    await page.getByTestId('hypotheses-add-button').click();

    // 5. The hypothesis form sheet should open
    await expect(page.getByTestId('hypothesis-form-sheet')).toBeVisible();

    // 6. Toggle to "Por CID-10" mode (should already be default, but click to be explicit)
    await page.locator('#mode-cid10').click();

    // 7. Type "depres" in the CID-10 combobox input.
    //    The input must be a real text input (type="text") that accepts keyboard
    //    input. Verify the input value reflects the typed query — this assertion
    //    would FAIL if the input were rendered as type="button" (the bug fixed in
    //    QA-1: PopoverTrigger asChild injects type="button").
    const comboboxInput = page.getByTestId('cid10-combobox-input');
    await expect(comboboxInput).toBeVisible();
    await expect(comboboxInput).toHaveAttribute('type', 'text');
    await comboboxInput.click();
    await comboboxInput.fill('depres');
    // Assert the input actually received the typed text (guards against the
    // type="button" regression where fill() silently no-ops).
    await expect(comboboxInput).toHaveValue('depres');

    // 8. Wait for debounce (250ms) + server action round-trip — select the F32.0 result.
    //    The combobox renders results in a listbox with role="option".
    //    Allow generous timeout: 250ms debounce + 50ms*6 typing + server action.
    const f32Option = page.getByRole('option', { name: /F32\.0/i });
    await expect(f32Option).toBeVisible({ timeout: 10_000 });
    await f32Option.click();

    // 9. Verify the selected state shows the code
    await expect(page.getByTestId('cid10-combobox-selected')).toBeVisible();
    await expect(page.getByTestId('cid10-combobox-selected')).toContainText('F32.0');

    // 10. Click "Salvar hipotese"
    await page.getByTestId('hypothesis-form-submit').click();

    // 11. Wait for success toast
    await expect(page.getByText('Hipótese criada com sucesso.')).toBeVisible({ timeout: 10_000 });

    // 12. Sheet should close and card should appear in list
    await expect(page.getByTestId('hypothesis-form-sheet')).not.toBeVisible();

    // 13. Verify the hypothesis card appears with CID-10 code and "Em investigacao" badge
    const hypothesesList = page.getByTestId('hypotheses-list');
    await expect(hypothesesList).toBeVisible({ timeout: 5_000 });

    // The card shows F32.0 code and "Em investigacao" badge (warning variant).
    // Scope to the card containing F32.0 to avoid strict mode violations from parallel tests.
    await expect(hypothesesList).toContainText('F32.0');
    const cidCard = hypothesesList.locator('[data-testid^="hypothesis-card-"]', {
      hasText: 'F32.0',
    });
    await expect(cidCard).toBeVisible();
    await expect(cidCard.getByText('Em investigação')).toBeVisible();
  });

  test('confirms a hypothesis via dropdown menu and badge changes to Confirmada', async ({
    page,
    db,
  }) => {
    // Pre-seed a hypothesis in "investigating" status to confirm
    const hypothesisId = '00000000-0000-4000-8000-000000000060';
    await db.sql`
      INSERT INTO public.diagnostic_hypotheses (
        id, user_id, patient_id, cid10_code, cid10_description,
        status, created_at, updated_at
      ) VALUES (
        ${hypothesisId},
        ${SEED_USER_ID},
        ${patientId},
        'F32.0',
        'Episódio depressivo leve',
        'investigating',
        now(),
        now()
      )
    `;

    // 1. Navigate to the prontuario page and open the Hipoteses tab
    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-hipoteses').click();
    await expect(page.getByTestId('prontuario-tab-content-hipoteses')).toBeVisible();

    // 2. Wait for the hypothesis card to appear
    const card = page.getByTestId(`hypothesis-card-${hypothesisId}`);
    await expect(card).toBeVisible({ timeout: 5_000 });

    // 3. Verify it currently shows "Em investigacao" badge
    await expect(card.getByText('Em investigação')).toBeVisible();

    // 4. Open the dropdown menu on the card
    await page.getByTestId(`hypothesis-card-menu-${hypothesisId}`).click();

    // 5. Click "Confirmar" in the dropdown
    await page.getByTestId(`hypothesis-action-confirm-${hypothesisId}`).click();

    // 6. Wait for success toast
    await expect(page.getByText('Hipótese confirmada.')).toBeVisible({ timeout: 10_000 });

    // 7. Assert badge changes to "Confirmada" (success variant)
    await expect(card.getByText('Confirmada')).toBeVisible();
    await expect(card.getByText('Em investigação')).not.toBeVisible();
  });

  test('adds a descriptive hypothesis without CID-10 and verifies card appears', async ({
    page,
  }) => {
    const descriptionText = 'Possivel transtorno de ansiedade generalizada com componente somatico';

    // 1. Navigate to the prontuario page and open the Hipoteses tab
    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-hipoteses').click();
    await expect(page.getByTestId('prontuario-tab-content-hipoteses')).toBeVisible();

    // 2. Click "Adicionar hipotese" button
    await page.getByTestId('hypotheses-add-button').click();
    await expect(page.getByTestId('hypothesis-form-sheet')).toBeVisible();

    // 3. Switch to "Descritiva" mode
    await page.locator('#mode-descriptive').click();

    // 4. Fill the description textarea
    const descriptionInput = page.getByTestId('hypothesis-description-input');
    await expect(descriptionInput).toBeVisible();
    await descriptionInput.fill(descriptionText);

    // 5. Click "Salvar hipotese"
    await page.getByTestId('hypothesis-form-submit').click();

    // 6. Wait for success toast
    await expect(page.getByText('Hipótese criada com sucesso.')).toBeVisible({ timeout: 10_000 });

    // 7. Sheet should close
    await expect(page.getByTestId('hypothesis-form-sheet')).not.toBeVisible();

    // 8. Verify the hypothesis card appears with the description text and "Em investigacao" badge.
    //    Scope the badge assertion to the specific card containing our description to avoid
    //    strict mode violations if other tests running in parallel left their own cards.
    const hypothesesList = page.getByTestId('hypotheses-list');
    await expect(hypothesesList).toBeVisible({ timeout: 5_000 });
    await expect(hypothesesList).toContainText(descriptionText);

    // Find the card that contains our description and assert it has the badge
    const ourCard = hypothesesList.locator('[data-testid^="hypothesis-card-"]', {
      hasText: descriptionText,
    });
    await expect(ourCard).toBeVisible();
    await expect(ourCard.getByText('Em investigação')).toBeVisible();
  });
});
