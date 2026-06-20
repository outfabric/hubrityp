import { expect } from '@playwright/test';

import { test } from '../setup/db-fixture';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @prontuario -- Manual "Salvar" button across the three large prontuario editors.
 *
 * A manual save button coexists with the 10s auto-save on:
 *   - Evoluções editor       (data-testid="evolution-save-button")
 *   - Plano terapêutico tab   (data-testid="treatment-plan-save-button")
 *   - Notas pessoais tab      (data-testid="personal-notes-save-button")
 *
 * The button is driven by the shared `useAutoSave` hook: disabled while the
 * content is clean (`!isDirty`) or a save is in flight (`status === 'saving'`),
 * enabled once the user edits, and on click calls `saveNow()` which bypasses
 * the 10s debounce. These specs prove the *manual* path (click before the
 * debounce would ever fire) persists, without waiting for auto-save.
 *
 * Prerequisites:
 *   - Seeded storageState provides an authenticated psychologist (the global
 *     seed user, id 00000000-0000-4000-8000-000000000001).
 *   - SEED_PATIENTS rows exist (seeded in global-setup).
 *
 * Patient assignment avoids collision with the sibling prontuario specs that
 * run under fullyParallel: evolution-crud uses activeWithPhone, treatment-plan
 * uses activeMinimal. This spec uses `archived` (Ana Oliveira) for the
 * evolution + notes flows and pre-seeds/cleans its own treatment plan on
 * `archived` too, so it owns its rows end-to-end.
 */

const SEED_USER_ID = '00000000-0000-4000-8000-000000000001';
const patientId = SEED_PATIENTS.archived.id;

test.describe('@prontuario manual save button', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  // Generous timeout: build/start overhead + redirects. We deliberately never
  // wait the 10s debounce — manual save is immediate — so these stay well under.
  test.setTimeout(90_000);

  // Share the same patient across the three flows; serialize so the per-flow
  // cleanup cannot race under parallel execution.
  test.describe.configure({ mode: 'serial' });

  // -------------------------------------------------------------------------
  // 6.1 Evoluções flow
  // -------------------------------------------------------------------------

  test('evolução: button disabled until dirty, manual save before 10s persists after reload', async ({
    page,
    db,
  }) => {
    // Start from empty state — remove any evolution this patient may carry.
    await db.sql`DELETE FROM public.evolution_versions WHERE evolution_id IN (
      SELECT id FROM public.evolutions WHERE patient_id = ${patientId}
    )`;
    await db.sql`DELETE FROM public.evolutions WHERE patient_id = ${patientId}`;

    const initialContent = 'Conteudo inicial da evolucao';
    const editedContent = 'Conteudo da evolucao salvo manualmente antes do auto-save';

    // 1. Open the "nova evolução" editor (default template is "livre" → single
    //    rich "Conteúdo" field, no template selection needed).
    await page.goto(`/pacientes/${patientId}/prontuario/evolucoes/nova`);
    await expect(page.getByTestId('nova-evolucao-page-title')).toBeVisible();

    const saveButton = page.getByTestId('evolution-save-button');
    const editor = page.getByTestId('evolution-editor');
    await expect(editor).toBeVisible();

    // 2. Button is disabled while the editor is clean (nothing typed yet).
    await expect(saveButton).toBeDisabled();

    // 3. Type into the single "livre" rich text field — button becomes enabled.
    const tiptap = editor.locator('.tiptap[contenteditable="true"]').first();
    await tiptap.click();
    await tiptap.fill(initialContent);
    await expect(saveButton).toBeEnabled();

    // 4. Click "Salvar" well before the 10s debounce would fire. This creates
    //    the evolution and redirects to its detail page.
    await saveButton.click();
    await expect(page.getByText('Evolução criada com sucesso')).toBeVisible({ timeout: 15_000 });
    await page.waitForURL('**/prontuario/evolucoes/**', { timeout: 10_000 });
    await expect(page.getByTestId('evolution-detail-page-title')).toBeVisible();

    // 5. On the detail page the editor is freshly mounted with the persisted
    //    content, so its save button starts disabled (clean) and the indicator
    //    is empty (nothing saved THIS mount). Edit the field → button enables →
    //    manual save → the indicator shows "Salvo às HH:MM" without waiting the
    //    10s debounce.
    const detailEditor = page.getByTestId('evolution-editor');
    await expect(detailEditor).toBeVisible();
    const detailSaveButton = page.getByTestId('evolution-save-button');
    await expect(detailSaveButton).toBeDisabled();

    const detailTiptap = detailEditor.locator('.tiptap[contenteditable="true"]').first();
    await expect(detailTiptap).toContainText(initialContent, { timeout: 10_000 });
    await detailTiptap.click();
    await detailTiptap.fill(editedContent);
    await expect(detailSaveButton).toBeEnabled();

    await detailSaveButton.click();
    await expect(page.getByTestId('auto-save-indicator')).toContainText(/Salvo às \d{2}:\d{2}/, {
      timeout: 15_000,
    });

    // 6. Reload the detail page — the manually-saved edit is rehydrated into
    //    the editor.
    const detailUrl = page.url();
    await page.reload();
    await expect(page.getByTestId('evolution-detail-page-title')).toBeVisible();
    const reloadedTiptap = page
      .getByTestId('evolution-editor')
      .locator('.tiptap[contenteditable="true"]')
      .first();
    await expect(reloadedTiptap).toContainText(editedContent, { timeout: 10_000 });

    // Sanity: stayed on the same detail page after reload.
    expect(page.url()).toBe(detailUrl);
  });

  // -------------------------------------------------------------------------
  // 6.2 Plano flow
  // -------------------------------------------------------------------------

  test('plano: manual save persists a goal; empty-description goal shows toast and is not persisted', async ({
    page,
    db,
  }) => {
    // Clean any treatment plan for this patient so we start from empty state.
    await db.sql`
      DELETE FROM public.treatment_plan_versions
      WHERE plan_id IN (
        SELECT id FROM public.treatment_plans
        WHERE patient_id = ${patientId} AND user_id = ${SEED_USER_ID}
      )
    `;
    await db.sql`
      DELETE FROM public.treatment_plans
      WHERE patient_id = ${patientId} AND user_id = ${SEED_USER_ID}
    `;

    const goalText = 'Reduzir crises de ansiedade salvo manualmente';

    // 1. Open prontuario → Plano tab → create plan.
    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-plano').click();
    await expect(page.getByTestId('prontuario-tab-content-plano')).toBeVisible();
    await expect(page.getByTestId('treatment-plan-empty-state')).toBeVisible();
    await page.getByTestId('treatment-plan-create-cta').click();
    await expect(page.getByTestId('treatment-plan-editor')).toBeVisible();

    const saveButton = page.getByTestId('treatment-plan-save-button');

    // 2. Add a goal with a real description → manual save persists it.
    await page.getByTestId('goals-add-button').click();
    const goal0 = page.getByTestId('goal-item-0');
    await expect(goal0).toBeVisible();
    await goal0.locator('textarea').fill(goalText);
    await expect(saveButton).toBeEnabled();

    await saveButton.click();
    await expect(page.getByTestId('auto-save-indicator')).toContainText(/Salvo às \d{2}:\d{2}/, {
      timeout: 15_000,
    });

    // Verify the goal is persisted in the database (owner-scoped).
    await expect
      .poll(
        async () => {
          const rows = await db.sql`
            SELECT goals FROM public.treatment_plans
            WHERE patient_id = ${patientId} AND user_id = ${SEED_USER_ID}
          `;
          return rows.length === 1 ? JSON.stringify(rows[0]!.goals) : null;
        },
        { timeout: 10_000 },
      )
      .toContain(goalText);

    // 3. Add a SECOND goal with an empty description → manual save is blocked
    //    by a toast and must NOT persist (the plan still has exactly one goal).
    await page.getByTestId('goals-add-button').click();
    const goal1 = page.getByTestId('goal-item-1');
    await expect(goal1).toBeVisible();
    // Leave goal1 description empty.
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Validation toast surfaces instead of a silent error.
    await expect(
      page.getByText('Preencha a descrição de todas as metas antes de salvar.'),
    ).toBeVisible({ timeout: 5_000 });

    // The empty-description goal was NOT persisted: still exactly one goal in DB.
    await expect
      .poll(
        async () => {
          const rows = await db.sql`
            SELECT goals FROM public.treatment_plans
            WHERE patient_id = ${patientId} AND user_id = ${SEED_USER_ID}
          `;
          if (rows.length !== 1) return -1;
          const goals = rows[0]!.goals as unknown[];
          return Array.isArray(goals) ? goals.length : -1;
        },
        { timeout: 5_000 },
      )
      .toBe(1);
  });

  // -------------------------------------------------------------------------
  // 6.3 Notas flow
  // -------------------------------------------------------------------------

  test('notas (unlocked): manual save persists the note', async ({ page, db }) => {
    // Ensure the notes are UNLOCKED for this patient (no password hash) and
    // start from a known-empty content.
    await db.sql`DELETE FROM public.personal_notes WHERE patient_id = ${patientId}`;

    const noteText = 'Nota pessoal salva manualmente';

    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-notas').click();
    await expect(page.getByTestId('prontuario-tab-content-notas')).toBeVisible();

    // Editor (unlocked) renders — no password set.
    await expect(page.getByTestId('personal-notes-tab')).toBeVisible({ timeout: 10_000 });

    const saveButton = page.getByTestId('personal-notes-save-button');
    // Clean content → button disabled.
    await expect(saveButton).toBeDisabled();

    // Type a note → button enabled → manual save persists.
    const tiptap = page
      .getByTestId('personal-notes-tab')
      .locator('.tiptap[contenteditable="true"]')
      .first();
    await tiptap.click();
    await tiptap.fill(noteText);
    await expect(saveButton).toBeEnabled();

    await saveButton.click();
    await expect(page.getByTestId('auto-save-indicator')).toContainText(/Salvo às \d{2}:\d{2}/, {
      timeout: 15_000,
    });

    // Verify persistence in the DB (owner-scoped).
    await expect
      .poll(
        async () => {
          const rows = await db.sql`
            SELECT content FROM public.personal_notes
            WHERE patient_id = ${patientId} AND user_id = ${SEED_USER_ID}
          `;
          return rows.length === 1 ? (rows[0]!.content as string) : null;
        },
        { timeout: 10_000 },
      )
      .toContain(noteText);
  });

  test('notas (locked): no manual save button is rendered in the locked state', async ({
    page,
    db,
  }) => {
    // Give this patient a password-protected notes row so the lock screen
    // renders instead of the editor. The hash value is irrelevant — we never
    // attempt to unlock; we only assert the locked UI and the ABSENCE of the
    // save button. A non-null password_hash + no in-session unlock is what
    // gates the editor (`hasPassword && !unlocked`).
    await db.sql`DELETE FROM public.personal_notes WHERE patient_id = ${patientId}`;
    await db.sql`
      INSERT INTO public.personal_notes (user_id, patient_id, content, password_hash, failed_attempts)
      VALUES (${SEED_USER_ID}, ${patientId}, NULL, 'not-a-real-hash', 0)
    `;

    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-notas').click();
    await expect(page.getByTestId('prontuario-tab-content-notas')).toBeVisible();

    // The lock screen renders; the regulatory banner is still present, but the
    // editor and its manual save button are NOT.
    await expect(page.getByTestId('personal-notes-banner')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('personal-notes-save-button')).toHaveCount(0);

    // Clean up so the locked row does not leak into sibling specs.
    await db.sql`DELETE FROM public.personal_notes WHERE patient_id = ${patientId}`;
  });
});
