import { expect } from '@playwright/test';

import { test } from '../setup/db-fixture';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @prontuario -- Evolution addendum E2E test.
 *
 * Tests the addendum flow for an evolution past the 30-day edit window:
 *   1. Seed an evolution with created_at more than 30 days ago (so
 *      `shouldForceAddendum` returns true)
 *   2. Navigate to the evolution detail page
 *   3. Verify the "Somente adendo" badge is displayed
 *   4. Edit content (triggers auto-save after 10s debounce)
 *   5. Verify the addendum reason dialog appears (requiring a reason)
 *   6. Submit the dialog with a reason
 *   7. Verify the addendum was created by checking VersionHistoryPanel
 *      shows the new version with the "Adendo" badge
 *
 * Prerequisites:
 *   - Seeded storageState provides an authenticated psychologist.
 *   - Evolution row is inserted directly into the Testcontainers DB with
 *     `created_at` set to 31+ days ago.
 */

// Deterministic IDs for the test evolution
const TEST_EVOLUTION_ID = '00000000-0000-4000-8000-000000000050';
const SEED_USER_ID = '00000000-0000-4000-8000-000000000001';

test.describe('@prontuario evolution addendum flow', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // Auto-save debounce is 10s + dialog interaction + save
  test.setTimeout(90_000);

  // Use activeMinimal to avoid collision with the CRUD test that cleans
  // evolutions for activeWithPhone in its own beforeEach.
  const patientId = SEED_PATIENTS.activeMinimal.id;

  test.beforeEach(async ({ db }) => {
    // Clean up any previous test data
    await db.sql`DELETE FROM public.evolution_versions WHERE evolution_id = ${TEST_EVOLUTION_ID}`;
    await db.sql`DELETE FROM public.evolutions WHERE id = ${TEST_EVOLUTION_ID}`;

    // Seed an evolution with created_at 31 days ago (past the 30-day edit window)
    // This triggers shouldForceAddendum(createdAt) === true
    await db.sql`
      INSERT INTO public.evolutions (
        id, user_id, patient_id, template_type, content,
        current_version, created_at, updated_at, finalized_at
      ) VALUES (
        ${TEST_EVOLUTION_ID},
        ${SEED_USER_ID},
        ${patientId},
        'livre',
        ${'{"conteudo": "<p>Conteudo original da evolucao</p>"}'}::jsonb,
        1,
        now() - interval '31 days',
        now() - interval '31 days',
        now() - interval '31 days'
      )
    `;

    // Seed the initial version (v1)
    await db.sql`
      INSERT INTO public.evolution_versions (
        id, evolution_id, version_number, content, is_addendum, modified_by, created_at
      ) VALUES (
        gen_random_uuid(),
        ${TEST_EVOLUTION_ID},
        1,
        ${'{"conteudo": "<p>Conteudo original da evolucao</p>"}'}::jsonb,
        false,
        ${SEED_USER_ID},
        now() - interval '31 days'
      )
    `;
  });

  test('editing an old evolution triggers addendum dialog, submitting creates addendum with badge', async ({
    page,
  }) => {
    // 1. Navigate to the evolution detail page
    await page.goto(`/pacientes/${patientId}/prontuario/evolucoes/${TEST_EVOLUTION_ID}`);
    await expect(page.getByTestId('evolution-detail-page-title')).toBeVisible();

    // 2. Verify "Somente adendo" badge is displayed (past 30-day window)
    await expect(page.getByTestId('addendum-mode-badge')).toBeVisible();
    await expect(page.getByTestId('addendum-mode-badge')).toContainText('Somente adendo');

    // 3. Edit the content in the TiptapEditor
    const tiptapEditor = page.locator('.tiptap[contenteditable="true"]').first();
    await expect(tiptapEditor).toBeVisible();

    // Clear and type new content to trigger a change
    await tiptapEditor.click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('Conteudo editado do adendo');

    // 4. Wait for auto-save debounce (10s) to trigger the addendum dialog
    await expect(page.getByTestId('addendum-reason-dialog')).toBeVisible({ timeout: 20_000 });

    // 5. Verify the dialog requires a reason — submit button is disabled when empty
    const submitBtn = page.getByTestId('addendum-submit-btn');
    await expect(submitBtn).toBeDisabled();

    // 6. Fill in the addendum reason
    const reasonInput = page.getByTestId('addendum-reason-input');
    await expect(reasonInput).toBeVisible();
    await reasonInput.fill('Correcao de informacao clinica relevante');

    // Submit button should now be enabled
    await expect(submitBtn).toBeEnabled();

    // 7. Submit the addendum
    await submitBtn.click();

    // 8. Wait for success toast
    await expect(page.getByText('Adendo adicionado com sucesso')).toBeVisible({ timeout: 10_000 });

    // 9. Reload the page to get fresh server-rendered version data
    //    (versions are fetched server-side and passed as props — after a
    //    client-side mutation they are stale until re-rendered)
    await page.reload();
    await expect(page.getByTestId('evolution-detail-page-title')).toBeVisible();

    // 10. Open VersionHistoryPanel and verify the addendum version
    await page.getByTestId('version-history-trigger').click();
    await expect(page.getByTestId('version-history-panel')).toBeVisible();

    // Version 2 should exist and have the "Adendo" badge
    await expect(page.getByTestId('version-item-2')).toBeVisible();
    await expect(page.getByTestId('addendum-badge')).toBeVisible();
    await expect(page.getByTestId('addendum-badge')).toContainText('Adendo');
  });
});
