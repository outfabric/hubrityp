import { expect, type Page } from '@playwright/test';

import { test } from '../setup/db-fixture';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @prontuario -- Clinical Documents E2E tests.
 *
 * Tests the "Documentos" tab inside the prontuario shell:
 *   1. Happy path laudo: navigate to Documentos tab, create laudo, fill sections,
 *      add CID-10, finalize with consent, verify "Gerando PDF..." toast, then
 *      verify PDF download works on a pre-seeded finalized document.
 *   2. Read-only finalized view: navigate to a finalized document, verify editor
 *      is in read-only mode, "Baixar PDF" and "Criar novo documento similar"
 *      buttons are visible.
 *   3. Filter by type and status: seed multiple documents, test type and status
 *      filters, verify correct documents are shown.
 *
 * Prerequisites:
 *   - Seeded storageState provides an authenticated psychologist.
 *   - Patient SEED_PATIENTS.activeMinimal exists (seeded in globalSetup).
 *   - No pre-existing clinical_documents for the test patient (cleaned in beforeEach).
 */

const SEED_USER_ID = '00000000-0000-4000-8000-000000000001';

// Use activeMinimal to avoid collision with other prontuario tests that use activeWithPhone
const patientId = SEED_PATIENTS.activeMinimal.id;

// ---------------------------------------------------------------------------
// Helpers — Supabase Storage mocking
// ---------------------------------------------------------------------------

/**
 * Mocks browser-side loading of signed URLs returned by the server action.
 *
 * The server-side storage operations (createSignedUrl) go through the mock
 * GoTrue's /storage/v1/* shim. The signed URL points back to the mock GoTrue
 * origin. When the browser tries to open/download that URL, we intercept it
 * via page.route() and return mock PDF content so the download button works.
 */
async function mockStorageRoutes(page: Page) {
  await page.route('**/object/sign/**', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: Buffer.from('%PDF-1.4 mock clinical document PDF content for e2e test'),
    });
  });
}

// ---------------------------------------------------------------------------
// 9.1 — Happy path: create laudo, fill all sections, add CID-10, finalize
// ---------------------------------------------------------------------------

test.describe('@prontuario clinical documents', () => {
  test.describe.configure({ mode: 'serial' });

  test.describe('happy path laudo creation and finalization', () => {
    test.use({ storageState: STORAGE_STATE_PATH });
    // CID-10 combobox debounce + Tiptap editor rendering + auto-save + finalization
    test.setTimeout(120_000);

    test.beforeEach(async ({ db }) => {
      // Clean up all clinical documents for this patient
      await db.sql`
        DELETE FROM public.clinical_documents
        WHERE patient_id = ${patientId}
          AND user_id = ${SEED_USER_ID}
      `;
    });

    test('creates a laudo, fills all sections with CID-10, finalizes with consent', async ({
      page,
    }) => {
      // 1. Navigate to patient prontuario
      await page.goto(`/pacientes/${patientId}/prontuario`);
      await expect(page.getByTestId('prontuario-page-title')).toBeVisible();

      // 2. Click the "Documentos" tab
      await page.getByTestId('prontuario-tab-documentos').click();
      await expect(page.getByTestId('prontuario-tab-content-documentos')).toBeVisible();

      // 3. Click "Novo documento" button
      await page.getByTestId('documents-new-button').click();

      // 4. The document type selector page should load
      await expect(page.getByTestId('document-type-selector')).toBeVisible({ timeout: 15_000 });

      // 5. Select "Laudo Psicologico"
      await page.getByTestId('document-type-laudo').click();

      // 6. Should navigate to the document editor
      await expect(page.getByTestId('document-editor')).toBeVisible({ timeout: 15_000 });

      // 7. Fill the "Solicitante" section (Tiptap rich text)
      const solicitanteSection = page.getByTestId('document-section-solicitante');
      await expect(solicitanteSection).toBeVisible();
      const solicitanteEditor = solicitanteSection.locator('[contenteditable="true"]');
      await solicitanteEditor.click();
      await solicitanteEditor.fill('Tribunal de Justica do Estado de Sao Paulo');

      // 8. Fill the "Demanda" section
      const demandaSection = page.getByTestId('document-section-demanda');
      await expect(demandaSection).toBeVisible();
      const demandaEditor = demandaSection.locator('[contenteditable="true"]');
      await demandaEditor.click();
      await demandaEditor.fill(
        'Avaliacao psicologica solicitada para subsidiar decisao judicial em processo de guarda.',
      );

      // 9. Fill the "Procedimentos" section
      const procedimentosSection = page.getByTestId('document-section-procedimentos');
      await expect(procedimentosSection).toBeVisible();
      const procedimentosEditor = procedimentosSection.locator('[contenteditable="true"]');
      await procedimentosEditor.click();
      await procedimentosEditor.fill(
        'Entrevistas clinicas, aplicacao de testes projetivos e observacao comportamental.',
      );

      // 10. Fill the "Analise" section (required for laudo)
      const analiseSection = page.getByTestId('document-section-analise');
      await expect(analiseSection).toBeVisible();
      const analiseEditor = analiseSection.locator('[contenteditable="true"]');
      await analiseEditor.click();
      await analiseEditor.fill(
        'Os dados coletados indicam quadro compativel com episodio depressivo leve.',
      );

      // 11. Fill the "Conclusao" section
      const conclusaoSection = page.getByTestId('document-section-conclusao');
      await expect(conclusaoSection).toBeVisible();
      const conclusaoEditor = conclusaoSection.locator('[contenteditable="true"]');
      await conclusaoEditor.click();
      await conclusaoEditor.fill(
        'Conclui-se que o paciente apresenta condicoes psicologicas adequadas.',
      );

      // 12. Fill "Local e Data" section
      const localDataSection = page.getByTestId('document-section-localData');
      await expect(localDataSection).toBeVisible();
      // Local input
      await localDataSection.locator('input').first().fill('Sao Paulo, SP');
      // Data input
      await localDataSection.locator('input').nth(1).fill('18/05/2026');

      // 13. Add CID-10 code F32 via combobox
      const cid10Section = page.getByTestId('document-section-cid10');
      await expect(cid10Section).toBeVisible();

      const comboboxInput = cid10Section.getByTestId('cid10-combobox-input');
      await expect(comboboxInput).toBeVisible();
      await comboboxInput.click();
      await comboboxInput.fill('F32');

      // Wait for CID-10 search results (debounce + server action round-trip)
      const f32Option = page.getByRole('option', { name: /F32/i });
      await expect(f32Option.first()).toBeVisible({ timeout: 10_000 });
      await f32Option.first().click();

      // Verify F32 code appears in the selected list
      await expect(cid10Section.getByText(/F32/)).toBeVisible();

      // 14. Before finalizing, save the draft manually so the server has the
      // latest content. Auto-save has a 10s debounce — the finalize action
      // reads content from the DB, not from the React state, so we must
      // ensure the latest content is persisted.
      await page.getByTestId('document-save-draft-button').click();
      // Wait for the auto-save indicator to confirm the save completed
      await expect(page.getByTestId('auto-save-indicator')).toContainText(/Salvo as/i, {
        timeout: 15_000,
      });

      // 15. Click "Finalizar e gerar PDF"
      const finalizeButton = page.getByTestId('document-finalize-button');
      await expect(finalizeButton).toBeEnabled({ timeout: 5_000 });
      await finalizeButton.click();

      // 16. The finalize modal should open
      await expect(page.getByTestId('finalize-modal')).toBeVisible();

      // 17. Since we added CID-10 codes, the consent checkbox should appear
      const consentCheckbox = page.getByTestId('finalize-cid10-consent');
      await expect(consentCheckbox).toBeVisible();

      // 18. The confirm button should be disabled until consent is checked
      await expect(page.getByTestId('finalize-confirm')).toBeDisabled();

      // 19. Check the consent checkbox
      await consentCheckbox.click();

      // 20. Now the confirm button should be enabled
      await expect(page.getByTestId('finalize-confirm')).toBeEnabled();

      // 21. Click confirm to finalize
      await page.getByTestId('finalize-confirm').click();

      // 22. After finalization the modal calls router.push to the viewer page.
      // The toast "Gerando PDF..." is transient and may be dismissed during
      // the page transition, so we skip asserting it and directly wait for
      // the finalized document viewer to appear.
      await expect(page.getByTestId('document-viewer')).toBeVisible({ timeout: 30_000 });

      // 23. Verify the "Finalizado" badge is shown (use exact to avoid matching
      // the immutability notice paragraph that also contains "finalizado")
      await expect(page.getByText('Finalizado', { exact: true })).toBeVisible();

      // 24. Verify the immutability notice is shown
      await expect(
        page.getByText('Este documento foi finalizado e nao pode ser editado.'),
      ).toBeVisible();
    });

    test('downloads PDF from a pre-seeded finalized document with pdf_storage_path', async ({
      page,
      db,
    }) => {
      await mockStorageRoutes(page);

      // Seed a finalized document with a PDF path
      const docId = '00000000-0000-4000-8000-000000000090';
      const pdfPath = `${SEED_USER_ID}/${patientId}/${docId}.pdf`;
      const contentJson = JSON.stringify({
        solicitante: 'Tribunal',
        demanda: 'Avaliacao',
        procedimentos: 'Entrevistas',
        analise: 'Analise detalhada',
        conclusao: 'Conclusao tecnica',
        localData: { local: 'Sao Paulo, SP', data: '18/05/2026' },
        cid10Codes: [],
        document_type: 'laudo',
        psychologistInfo: { name: 'Seed User', crp: '00000-S/SP', contact: '' },
      });

      await db.sql`
        INSERT INTO public.clinical_documents (
          id, user_id, patient_id, document_type, title, content,
          status, finalized_at, pdf_storage_path, pdf_size,
          references_cid10, cid10_consent_confirmed
        ) VALUES (
          ${docId},
          ${SEED_USER_ID},
          ${patientId},
          'laudo',
          'Laudo Psicologico - Avaliacao',
          ${contentJson}::jsonb,
          'finalized',
          now(),
          ${pdfPath},
          1024,
          false,
          false
        )
        ON CONFLICT (id) DO UPDATE SET
          status = 'finalized',
          finalized_at = now(),
          pdf_storage_path = EXCLUDED.pdf_storage_path,
          pdf_size = EXCLUDED.pdf_size
      `;

      // Navigate to the finalized document
      await page.goto(`/pacientes/${patientId}/prontuario/documentos/${docId}`);
      await expect(page.getByTestId('document-viewer')).toBeVisible({ timeout: 15_000 });

      // Verify the "Baixar PDF" button is visible and enabled
      const downloadButton = page.getByTestId('document-viewer-download');
      await expect(downloadButton).toBeVisible();
      await expect(downloadButton).toBeEnabled();

      // Listen for the popup (window.open) triggered by the download
      const popupPromise = page.waitForEvent('popup', { timeout: 15_000 });

      // Click "Baixar PDF"
      await downloadButton.click();

      // Verify a new tab/popup was opened (the mock route will serve PDF content)
      const popup = await popupPromise;
      // The popup URL should contain /object/sign/ (the mock storage route)
      expect(popup.url()).toContain('/object/sign/');
      await popup.close();
    });
  });

  // ---------------------------------------------------------------------------
  // 9.2 — Read-only finalized document view
  // ---------------------------------------------------------------------------

  test.describe('read-only finalized document view', () => {
    test.use({ storageState: STORAGE_STATE_PATH });
    test.setTimeout(60_000);

    const finalizedDocId = '00000000-0000-4000-8000-000000000091';

    test.beforeEach(async ({ db }) => {
      // Clean and re-seed a finalized document
      await db.sql`
        DELETE FROM public.clinical_documents
        WHERE patient_id = ${patientId}
          AND user_id = ${SEED_USER_ID}
      `;

      const pdfPath = `${SEED_USER_ID}/${patientId}/${finalizedDocId}.pdf`;
      const contentJson = JSON.stringify({
        solicitante: 'Escola',
        demanda: 'Acompanhamento escolar',
        procedimentos: 'Entrevistas e observacao',
        analise: 'Analise do progresso',
        conclusao: 'Evolucao positiva',
        localData: { local: 'Sao Paulo, SP', data: '15/05/2026' },
        cid10Codes: [],
        document_type: 'relatorio',
        psychologistInfo: { name: 'Seed User', crp: '00000-S/SP', contact: '' },
      });

      await db.sql`
        INSERT INTO public.clinical_documents (
          id, user_id, patient_id, document_type, title, content,
          status, finalized_at, pdf_storage_path, pdf_size,
          references_cid10, cid10_consent_confirmed
        ) VALUES (
          ${finalizedDocId},
          ${SEED_USER_ID},
          ${patientId},
          'relatorio',
          'Relatorio de Acompanhamento',
          ${contentJson}::jsonb,
          'finalized',
          now(),
          ${pdfPath},
          2048,
          false,
          false
        )
        ON CONFLICT (id) DO UPDATE SET
          status = 'finalized',
          finalized_at = now(),
          pdf_storage_path = EXCLUDED.pdf_storage_path,
          pdf_size = EXCLUDED.pdf_size,
          title = EXCLUDED.title,
          content = EXCLUDED.content
      `;
    });

    test('shows finalized document in read-only mode with download and clone buttons', async ({
      page,
    }) => {
      // Navigate to the finalized document
      await page.goto(`/pacientes/${patientId}/prontuario/documentos/${finalizedDocId}`);
      await expect(page.getByTestId('document-viewer')).toBeVisible({ timeout: 15_000 });

      // Verify "Finalizado" badge is present (use exact to avoid matching
      // the immutability notice paragraph that also contains "finalizado")
      await expect(page.getByText('Finalizado', { exact: true })).toBeVisible();

      // Verify the title is displayed
      await expect(page.getByTestId('document-viewer-title')).toContainText(
        'Relatorio de Acompanhamento',
      );

      // Verify the immutability notice
      await expect(
        page.getByText('Este documento foi finalizado e nao pode ser editado.'),
      ).toBeVisible();

      // Verify NO editable inputs exist (no contenteditable, no input fields for sections)
      const editableElements = page.getByTestId('document-editor');
      await expect(editableElements).not.toBeVisible();

      // Verify "Baixar PDF" button is visible
      const downloadButton = page.getByTestId('document-viewer-download');
      await expect(downloadButton).toBeVisible();
      await expect(downloadButton).toContainText('Baixar PDF');

      // Verify "Criar novo documento similar" button is visible
      const cloneButton = page.getByTestId('document-viewer-clone');
      await expect(cloneButton).toBeVisible();
      await expect(cloneButton).toContainText('Criar novo documento similar');

      // Verify section content is displayed read-only
      // The analise section should show the seeded content
      const analiseSection = page.getByTestId('document-viewer-section-analise');
      await expect(analiseSection).toBeVisible();
      await expect(analiseSection).toContainText('Analise do progresso');
    });
  });

  // ---------------------------------------------------------------------------
  // 9.3 — Filter list by type and status
  // ---------------------------------------------------------------------------

  test.describe('filter documents by type and status', () => {
    test.use({ storageState: STORAGE_STATE_PATH });
    test.setTimeout(90_000);

    test.beforeEach(async ({ db }) => {
      // Clean all clinical documents for this patient
      await db.sql`
        DELETE FROM public.clinical_documents
        WHERE patient_id = ${patientId}
          AND user_id = ${SEED_USER_ID}
      `;

      const baseContent = (docType: string) =>
        JSON.stringify({
          document_type: docType,
          psychologistInfo: { name: 'Seed User', crp: '00000-S/SP', contact: '' },
        });

      // Seed 4 documents of different types and statuses
      // 1. Laudo - finalized
      await db.sql`
        INSERT INTO public.clinical_documents (
          id, user_id, patient_id, document_type, title, content,
          status, finalized_at, references_cid10, cid10_consent_confirmed
        ) VALUES (
          '00000000-0000-4000-8000-000000000092',
          ${SEED_USER_ID},
          ${patientId},
          'laudo',
          'Laudo Psicologico Finalizado',
          ${baseContent('laudo')}::jsonb,
          'finalized',
          now(),
          false,
          false
        )
      `;

      // 2. Laudo - draft
      await db.sql`
        INSERT INTO public.clinical_documents (
          id, user_id, patient_id, document_type, title, content,
          status, references_cid10, cid10_consent_confirmed
        ) VALUES (
          '00000000-0000-4000-8000-000000000093',
          ${SEED_USER_ID},
          ${patientId},
          'laudo',
          'Laudo Psicologico Rascunho',
          ${baseContent('laudo')}::jsonb,
          'draft',
          false,
          false
        )
      `;

      // 3. Declaracao - finalized
      await db.sql`
        INSERT INTO public.clinical_documents (
          id, user_id, patient_id, document_type, title, content,
          status, finalized_at, references_cid10, cid10_consent_confirmed
        ) VALUES (
          '00000000-0000-4000-8000-000000000094',
          ${SEED_USER_ID},
          ${patientId},
          'declaracao',
          'Declaracao de Comparecimento',
          ${baseContent('declaracao')}::jsonb,
          'finalized',
          now(),
          false,
          false
        )
      `;

      // 4. Relatorio - draft
      await db.sql`
        INSERT INTO public.clinical_documents (
          id, user_id, patient_id, document_type, title, content,
          status, references_cid10, cid10_consent_confirmed
        ) VALUES (
          '00000000-0000-4000-8000-000000000095',
          ${SEED_USER_ID},
          ${patientId},
          'relatorio',
          'Relatorio de Acompanhamento Draft',
          ${baseContent('relatorio')}::jsonb,
          'draft',
          false,
          false
        )
      `;
    });

    test('filters documents by type "Laudo" then by status "Finalizado", then clears filters', async ({
      page,
    }) => {
      // 1. Navigate to patient prontuario
      await page.goto(`/pacientes/${patientId}/prontuario`);
      await expect(page.getByTestId('prontuario-page-title')).toBeVisible();

      // 2. Click the "Documentos" tab
      await page.getByTestId('prontuario-tab-documentos').click();
      await expect(page.getByTestId('prontuario-tab-content-documentos')).toBeVisible();

      // 3. Wait for the documents list to load (should show all 4 documents)
      const documentsList = page.getByTestId('documents-list');
      await expect(documentsList).toBeVisible({ timeout: 15_000 });

      // Verify all 4 documents are shown initially
      const allCards = documentsList.locator('[data-testid^="document-card-"]');
      await expect(allCards).toHaveCount(4);

      // 4. Apply type filter "Laudo"
      await page.getByTestId('documents-type-filter').click();
      await page.getByRole('option', { name: 'Laudo' }).click();

      // 5. Verify only laudos are shown (2 documents: finalized + draft)
      await expect(allCards).toHaveCount(2, { timeout: 10_000 });
      await expect(documentsList.getByText('Laudo Psicologico Finalizado')).toBeVisible();
      await expect(documentsList.getByText('Laudo Psicologico Rascunho')).toBeVisible();
      // Declaracao and Relatorio should not be visible
      await expect(documentsList.getByText('Declaracao de Comparecimento')).not.toBeVisible();
      await expect(documentsList.getByText('Relatorio de Acompanhamento Draft')).not.toBeVisible();

      // 6. Apply status filter "Finalizado"
      await page.getByTestId('documents-status-finalized').click();

      // 7. Verify only finalized laudos are shown (1 document)
      await expect(allCards).toHaveCount(1, { timeout: 10_000 });
      await expect(documentsList.getByText('Laudo Psicologico Finalizado')).toBeVisible();
      await expect(documentsList.getByText('Laudo Psicologico Rascunho')).not.toBeVisible();

      // 8. Clear type filter (select "Todos os tipos")
      await page.getByTestId('documents-type-filter').click();
      await page.getByRole('option', { name: 'Todos os tipos' }).click();

      // 9. With only status=finalized, should show 2 finalized documents (laudo + declaracao)
      await expect(allCards).toHaveCount(2, { timeout: 10_000 });
      await expect(documentsList.getByText('Laudo Psicologico Finalizado')).toBeVisible();
      await expect(documentsList.getByText('Declaracao de Comparecimento')).toBeVisible();

      // 10. Clear status filter (click "Todos")
      await page.getByTestId('documents-status-all').click();

      // 11. All 4 documents should be shown again
      await expect(allCards).toHaveCount(4, { timeout: 10_000 });
    });
  });
});
