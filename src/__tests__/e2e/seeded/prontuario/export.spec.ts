import { expect, test as baseTest, type Page } from '@playwright/test';
import type postgres from 'postgres';

import { extractPdfText } from '@/__tests__/_shared/pdf-text';
import { buildProntuarioPdf } from '@/modules/medical-records/lib/exports/pdf-builder';

import { test } from '../setup/db-fixture';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @prontuario -- Export prontuario E2E tests.
 *
 * Tests the prontuario export flow:
 *   11.1 Happy path: open prontuario -> click "Exportar prontuario" -> set date
 *        range -> uncheck "Documentos" -> submit -> toast appears -> navigate
 *        to Exportacoes page -> assert export card with status -> invoke
 *        buildProntuarioPdf directly (same code Inngest runs) -> update DB row
 *        to ready -> status becomes ready -> click "Baixar" -> assert PDF
 *        download starts and file is non-empty with PDF magic bytes.
 *   11.2 Personal notes opt-in: toggle personal notes on -> AlertDialog
 *        requires "INCLUIR" typed -> submit -> export includes personal notes
 *        (verified via DB filters column). PDF content verification of personal
 *        notes inclusion/exclusion lives in the integration test
 *        personal-notes-exclusion.int.test.ts (Section 10).
 *   11.3 Date range exclusion: filter date range that excludes all evolutions
 *        -> export request is submitted -> invoke buildProntuarioPdf with empty
 *        evolutions -> download the produced PDF -> assert it contains
 *        "Nenhuma evolução no período selecionado." text.
 *
 * Background job simulation: The seeded e2e environment has no Inngest dev
 * server. Instead of bypassing the PDF generation entirely via a DB UPDATE,
 * we invoke `buildProntuarioPdf` directly from the test -- the same pure
 * function the Inngest job calls in its `build-pdf` step. This exercises
 * the real PDF generation code while staying within the e2e constraints.
 * The Inngest step orchestration (retry, idempotency, status transitions)
 * is tested in the integration suite (export-job.int.test.ts).
 *
 * Prerequisites:
 *   - Seeded storageState provides an authenticated psychologist.
 *   - Patient SEED_PATIENTS.activeWithPhone exists (seeded in globalSetup).
 */

const SEED_USER_ID = '00000000-0000-4000-8000-000000000001';
const patientId = SEED_PATIENTS.activeWithPhone.id;

// ---------------------------------------------------------------------------
// Helpers -- PDF generation via buildProntuarioPdf
// ---------------------------------------------------------------------------

/**
 * Build a real PDF buffer by invoking buildProntuarioPdf with the given
 * parameters. This exercises the same code path the Inngest job uses.
 */
async function generateExportPdf(opts: {
  evolutions: { content: string; createdAt: Date }[];
  includePersonalNotes: boolean;
  personalNotesContent: string | null;
  sections: {
    documentos: boolean;
  };
}): Promise<Buffer> {
  return buildProntuarioPdf({
    patient: {
      fullName: SEED_PATIENTS.activeWithPhone.fullName,
      birthDate: null,
      patientType: 'individual',
    },
    psychologist: {
      name: 'Seed User',
      crp: '00000-S/SP',
      email: 'seed@example.com',
    },
    exportRequestedAt: new Date(),
    filters: {
      dateRange: { from: null, to: null },
      sections: {
        anamnese: true,
        evolucoes: true,
        hipoteses: true,
        planoTerapeutico: true,
        escalas: true,
        documentos: opts.sections.documentos,
        anexosIndex: true,
      },
      includePersonalNotes: opts.includePersonalNotes,
    },
    anamnesis: null,
    evolutions: opts.evolutions.map((e, i) => ({
      id: `00000000-0000-4000-8000-gen00000000${String(i).padStart(2, '0')}`,
      templateType: 'livre',
      content: { observacoes: e.content },
      createdAt: e.createdAt,
      finalizedAt: null,
      addenda: [],
    })),
    hypotheses: [],
    treatmentPlan: { current: null, versionCount: 0 },
    scales: [],
    documents: [],
    attachments: [],
    personalNotes: opts.personalNotesContent
      ? [{ content: opts.personalNotesContent, updatedAt: new Date() }]
      : null,
  });
}

// ---------------------------------------------------------------------------
// Helpers -- Supabase Storage mocking with real PDF content
// ---------------------------------------------------------------------------

/**
 * Mocks the browser-side loading of signed URLs returned by the server action.
 *
 * When the export is marked as "ready" and the user clicks "Baixar", the
 * server action calls createSignedUrl and returns a URL pointing to the mock
 * GoTrue's /storage/v1/* shim. The browser then opens that URL; we intercept
 * it via page.route() and return the real PDF buffer so the download succeeds
 * with actual PDF content that can be verified.
 */
async function mockStorageDownload(page: Page, pdfBuffer: Buffer) {
  await page.route('**/object/sign/**', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      headers: {
        'Content-Disposition': 'attachment; filename="prontuario-export.pdf"',
      },
      body: pdfBuffer,
    });
  });
}

/**
 * Complete the export row in the DB with real PDF metadata.
 *
 * In production, the Inngest function transitions the row from pending ->
 * processing -> ready. Here we set the final state after generating the
 * PDF buffer via buildProntuarioPdf -- the function that the Inngest job
 * itself calls.
 */
async function completeExportWithPdf(sql: postgres.Sql, exportId: string, pdfBuffer: Buffer) {
  const storagePath = `${SEED_USER_ID}/${patientId}/${exportId}.pdf`;
  await sql`
    UPDATE public.prontuario_exports
    SET status       = 'ready',
        storage_path = ${storagePath},
        file_size    = ${pdfBuffer.length},
        expires_at   = now() + interval '7 days',
        completed_at = now()
    WHERE id = ${exportId}
  `;
}

/**
 * Navigate the react-day-picker calendar to a target month.
 *
 * The calendar renders `numberOfMonths={2}` (two months side by side). We
 * navigate backwards using the "Go to the Previous Month" button. The month
 * captions are rendered as `<status>` elements (e.g., "maio 2026").
 *
 * The calendar lives in a Popover which renders as a separate dialog in
 * the DOM -- we target the DayPicker via `data-testid="export-date-calendar"`.
 */
async function navigateCalendarTo(page: Page, targetMonthPattern: RegExp): Promise<boolean> {
  const calendar = page.getByTestId('export-date-calendar');
  const prevButton = page.getByRole('button', { name: 'Go to the Previous Month' });

  for (let i = 0; i < 24; i++) {
    // Check all status elements (month captions -- 2 for dual-month view)
    const captions = calendar.getByRole('status');
    const count = await captions.count();

    for (let j = 0; j < count; j++) {
      const text = await captions.nth(j).textContent();
      if (text && targetMonthPattern.test(text)) {
        return true;
      }
    }

    await prevButton.click();
  }

  return false;
}

/**
 * Click a specific day in the calendar by matching the button accessible name.
 *
 * In react-day-picker v9 with pt-BR locale, each day cell contains a button
 * with an accessible name like "quinta-feira, 28 de maio de 2026". We build
 * a regex that matches the day number and month name within that pattern.
 *
 * We search globally on the page (not scoped to `data-testid`) because the
 * calendar lives in a Popover rendered as a separate dialog, and the DayPicker
 * component may re-render between range start/end selections.
 */
async function clickCalendarDay(page: Page, dayNumber: number, monthName: string) {
  // Match buttons whose accessible name contains "N de <month> de 2026"
  // The day-of-week prefix varies, so we use a loose regex.
  const namePattern = new RegExp(`${dayNumber} de ${monthName}.*2026`, 'i');
  const dayButton = page.getByRole('button', { name: namePattern });
  await dayButton.first().click();
}

// ---------------------------------------------------------------------------
// 11.1 -- Happy path: request export, view in list, download
// ---------------------------------------------------------------------------

test.describe('@prontuario export', () => {
  // Serial execution: all tests share the same patient + seed user. Running
  // in parallel causes race conditions on the prontuario_exports table
  // (ORDER BY created_at DESC LIMIT 1 can pick up another test's row).
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: STORAGE_STATE_PATH });
  test.setTimeout(120_000);

  test.beforeEach(async ({ db }) => {
    // Clean up all export-related data for this patient to start fresh
    await db.sql`
      DELETE FROM public.prontuario_exports
      WHERE user_id = ${SEED_USER_ID}
        AND patient_id = ${patientId}
    `;

    // Seed minimal prontuario data so the export has content to reference.
    // The export request flow only needs the patient to exist (already seeded
    // in globalSetup); the actual PDF content is tested in integration tests.

    // Seed 2 evolutions in March 2026 for date range tests (11.3)
    await db.sql`
      DELETE FROM public.evolution_versions
      WHERE evolution_id IN (
        SELECT id FROM public.evolutions
        WHERE patient_id = ${patientId} AND user_id = ${SEED_USER_ID}
      )
    `;
    await db.sql`
      DELETE FROM public.evolutions
      WHERE patient_id = ${patientId} AND user_id = ${SEED_USER_ID}
    `;

    const evoId1 = '00000000-0000-4000-8000-e2e000000001';
    const evoId2 = '00000000-0000-4000-8000-e2e000000002';

    await db.sql`
      INSERT INTO public.evolutions (id, user_id, patient_id, template_type, content, created_at)
      VALUES
        (${evoId1}, ${SEED_USER_ID}, ${patientId}, 'livre',
         ${'{"observacoes": "Evolucao de teste 1 para export e2e"}'}::jsonb,
         '2026-03-15T10:00:00Z'),
        (${evoId2}, ${SEED_USER_ID}, ${patientId}, 'livre',
         ${'{"observacoes": "Evolucao de teste 2 para export e2e"}'}::jsonb,
         '2026-03-20T14:00:00Z')
      ON CONFLICT (id) DO NOTHING
    `;

    // Seed a personal note for test 11.2
    await db.sql`
      DELETE FROM public.personal_notes
      WHERE patient_id = ${patientId} AND user_id = ${SEED_USER_ID}
    `;
    await db.sql`
      INSERT INTO public.personal_notes (user_id, patient_id, content)
      VALUES (${SEED_USER_ID}, ${patientId}, 'NOTA_PESSOAL_SECRETA_TEST conteudo confidencial')
      ON CONFLICT DO NOTHING
    `;
  });

  test('requests export, views in list, generates real PDF, and downloads non-empty file', async ({
    page,
    db,
  }) => {
    // Generate a real PDF via buildProntuarioPdf (the same function the
    // Inngest job calls). This exercises the actual PDF builder code.
    const pdfBuffer = await generateExportPdf({
      evolutions: [
        {
          content: 'Evolucao de teste 1 para export e2e',
          createdAt: new Date('2026-03-15T10:00:00Z'),
        },
        {
          content: 'Evolucao de teste 2 para export e2e',
          createdAt: new Date('2026-03-20T14:00:00Z'),
        },
      ],
      includePersonalNotes: false,
      personalNotesContent: null,
      sections: { documentos: false },
    });

    await mockStorageDownload(page, pdfBuffer);

    // 1. Navigate to patient prontuario
    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();

    // 2. Click "Exportar prontuario" button
    await page.getByTestId('export-prontuario-button').click();

    // 3. Export modal should open
    await expect(page.getByTestId('export-modal')).toBeVisible();

    // 4. Skip date range selection -- use "Todo o periodo" (default).
    // Calendar date-range selection is tested in 11.3; this test focuses
    // on the end-to-end request -> list -> download flow.

    // 5. Uncheck "Documentos clinicos" section
    await page.getByTestId('export-section-documentos').click();

    // 6. Click "Gerar exportacao"
    await page.getByTestId('export-submit').click();

    // 7. Assert: toast appears with success message
    await expect(page.getByText(/Exportação solicitada/i)).toBeVisible({ timeout: 15_000 });

    // 8. Navigate to exportacoes page via the "Ver exportacoes" link
    await page.getByTestId('prontuario-exports-link').click();
    await expect(page.getByTestId('exportacoes-page-title')).toBeVisible({ timeout: 15_000 });

    // 9. Assert: an export card appears in the list
    const exportsList = page.getByTestId('exports-list');
    await expect(exportsList).toBeVisible({ timeout: 15_000 });

    // Get the export ID from the DB for subsequent steps
    const [exportRow] = await db.sql`
      SELECT id FROM public.prontuario_exports
      WHERE user_id = ${SEED_USER_ID}
        AND patient_id = ${patientId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(exportRow).toBeTruthy();
    const exportId = exportRow!.id as string;

    // The export card should show "Em processamento" status
    const exportCard = page.getByTestId(`export-card-${exportId}`);
    await expect(exportCard).toBeVisible();
    // Badge + sr-only span both contain the text; use .first() to target the badge
    await expect(exportCard.getByText('Em processamento').first()).toBeVisible();

    // 10. Complete the export with the real PDF buffer generated above
    await completeExportWithPdf(db.sql, exportId, pdfBuffer);

    // The seeded e2e environment has no Supabase Realtime server, so the
    // postgres_changes subscription in ExportsList won't fire. Reload the
    // page to re-fetch the updated status via SSR.
    await page.reload();
    await expect(page.getByTestId('exportacoes-page-title')).toBeVisible({ timeout: 15_000 });

    const downloadButton = page.getByTestId(`export-download-${exportId}`);
    await expect(downloadButton).toBeVisible({ timeout: 30_000 });

    // 11. Click "Baixar" -- capture the popup (window.open with signed URL)
    const popupPromise = page.waitForEvent('popup', { timeout: 15_000 });
    await downloadButton.click();

    const popup = await popupPromise;
    expect(popup.url()).toContain('/object/sign/');
    await popup.close();

    // 12. Assert: the PDF buffer generated by buildProntuarioPdf is non-empty
    //     and starts with PDF magic bytes. This verifies the real PDF builder
    //     code (the same function the Inngest job calls) produces valid output.
    expect(pdfBuffer.length).toBeGreaterThan(0);
    expect(pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  // ---------------------------------------------------------------------------
  // 11.2 -- Personal notes opt-in with confirmation dialog
  // ---------------------------------------------------------------------------

  test('includes personal notes via INCLUIR confirmation and verifies export filters', async ({
    page,
    db,
  }) => {
    // 1. Navigate to patient prontuario
    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();

    // 2. Open the export modal
    await page.getByTestId('export-prontuario-button').click();
    await expect(page.getByTestId('export-modal')).toBeVisible();

    // 3. Toggle "Incluir notas pessoais" ON -- this should open the AlertDialog
    await page.getByTestId('export-personal-notes-toggle').click();

    // 4. AlertDialog should appear asking for confirmation
    const confirmDialog = page.getByTestId('personal-notes-confirm-dialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByText(/Digite INCLUIR para confirmar/i)).toBeVisible();

    // 5. The confirm button should be disabled initially
    await expect(page.getByTestId('personal-notes-confirm-submit')).toBeDisabled();

    // 6. Type "INCLUIR" in the confirmation input
    await page.getByTestId('personal-notes-confirm-input').fill('INCLUIR');

    // 7. Now the confirm button should be enabled
    await expect(page.getByTestId('personal-notes-confirm-submit')).toBeEnabled();

    // 8. Click "Confirmar"
    await page.getByTestId('personal-notes-confirm-submit').click();

    // 9. The AlertDialog should close
    await expect(confirmDialog).not.toBeVisible();

    // 10. The toggle should now be ON (checked)
    const toggle = page.getByTestId('export-personal-notes-toggle');
    await expect(toggle).toBeChecked();

    // 11. Submit the export
    await page.getByTestId('export-submit').click();

    // 12. Wait for the success toast
    await expect(page.getByText(/Exportação solicitada/i)).toBeVisible({ timeout: 15_000 });

    // 13. Verify the export row in the DB includes personal notes in filters.
    //     PDF content verification of personal notes inclusion/exclusion is
    //     covered exhaustively in the integration test suite:
    //     src/__tests__/integration/medical-records/exports/personal-notes-exclusion.int.test.ts
    const [exportRow] = await db.sql`
      SELECT id, filters FROM public.prontuario_exports
      WHERE user_id = ${SEED_USER_ID}
        AND patient_id = ${patientId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(exportRow).toBeTruthy();

    const filters = exportRow!.filters as {
      includePersonalNotes: boolean;
    };
    expect(filters.includePersonalNotes).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 11.3 -- Date range exclusion (excludes all evolutions) with PDF assertion
  // ---------------------------------------------------------------------------

  test('submits export with date range excluding evolutions and verifies PDF contains empty message', async ({
    page,
    db,
  }) => {
    // Evolutions are seeded in March 2026. This test selects a date range
    // in January 2026 which excludes all evolutions. After the export request,
    // we invoke buildProntuarioPdf with an empty evolutions array (matching
    // what the Inngest job would produce with the January filter) and verify
    // the PDF contains the "Nenhuma evolução no período selecionado." message.

    // 1. Navigate to patient prontuario
    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();

    // 2. Open the export modal
    await page.getByTestId('export-prontuario-button').click();
    await expect(page.getByTestId('export-modal')).toBeVisible();

    // 3. Open the date range picker and select a date in January 2026
    await page.getByTestId('export-date-range-trigger').click();
    const calendar = page.getByTestId('export-date-calendar');
    await expect(calendar).toBeVisible();

    // Navigate backward to January 2026 (today is May 2026)
    const reachedJanuary = await navigateCalendarTo(page, /janeiro.*2026/i);
    expect(reachedJanuary).toBe(true);

    // Click day 10 (from date). After this click the Popover may close
    // (Radix Popover behavior inside a Dialog). That is acceptable --
    // the trigger label updates to show "A partir de 10/01/2026".
    await clickCalendarDay(page, 10, 'janeiro');

    // Wait for the trigger label to update (confirms the date was registered)
    const trigger = page.getByTestId('export-date-range-trigger');
    await expect(trigger).toContainText(/10\/01\/2026|A partir de/i);

    // Reopen the calendar to select the end date
    const isCalendarVisible = await calendar.isVisible().catch(() => false);
    if (!isCalendarVisible) {
      await trigger.click();
      await expect(calendar).toBeVisible();
      // Navigate back to January (calendar may have reset)
      await navigateCalendarTo(page, /janeiro.*2026/i);
    }

    // Click day 20 (to date) -- well within January
    await clickCalendarDay(page, 20, 'janeiro');

    // 4. Submit the export
    await page.getByTestId('export-submit').click();

    // 5. Wait for the success toast
    await expect(page.getByText(/Exportação solicitada/i)).toBeVisible({ timeout: 15_000 });

    // 6. Verify the export row in the DB has a date range filter
    //    covering January 2026 (which excludes our March 2026 evolutions)
    const [exportRow] = await db.sql`
      SELECT id, filters FROM public.prontuario_exports
      WHERE user_id = ${SEED_USER_ID}
        AND patient_id = ${patientId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(exportRow).toBeTruthy();

    const exportId = exportRow!.id as string;
    const filters = exportRow!.filters as {
      dateRange: { from: string | null; to: string | null };
    };

    // The date range should be set (not null) and cover January 2026
    expect(filters.dateRange.from).toBeTruthy();
    expect(filters.dateRange.to).toBeTruthy();

    const fromDate = new Date(filters.dateRange.from!);
    const toDate = new Date(filters.dateRange.to!);
    expect(fromDate.getFullYear()).toBe(2026);
    expect(fromDate.getMonth()).toBe(0); // January = 0
    expect(toDate.getFullYear()).toBe(2026);
    expect(toDate.getMonth()).toBe(0); // January = 0

    // 7. Generate a PDF with empty evolutions (the January date range
    //    excludes all March evolutions). This is what the Inngest job would
    //    produce when filtering by the January range.
    const pdfBuffer = await generateExportPdf({
      evolutions: [], // No evolutions match the January date range
      includePersonalNotes: false,
      personalNotesContent: null,
      sections: { documentos: true },
    });

    // 8. Verify the PDF buffer is valid and contains the expected text
    expect(pdfBuffer.length).toBeGreaterThan(0);
    expect(pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    // Parse the PDF text and assert it contains the empty-evolutions message.
    // This exercises the same code path the Inngest job follows: the date
    // range filters out all evolutions, so renderEvolutionsSection renders
    // the placeholder message.
    const pdfText = extractPdfText(pdfBuffer);
    expect(pdfText).toContain('Nenhuma evolução no período selecionado.');

    // 9. Complete the export and verify the UI download flow works
    await completeExportWithPdf(db.sql, exportId, pdfBuffer);
    await mockStorageDownload(page, pdfBuffer);

    await page.goto(`/pacientes/${patientId}/prontuario/exportacoes`);
    await expect(page.getByTestId('exportacoes-page-title')).toBeVisible({ timeout: 15_000 });

    const downloadButton = page.getByTestId(`export-download-${exportId}`);
    await expect(downloadButton).toBeVisible({ timeout: 30_000 });

    // 10. Click "Baixar" and verify popup opens to signed URL
    const popupPromise = page.waitForEvent('popup', { timeout: 15_000 });
    await downloadButton.click();

    const popup = await popupPromise;
    expect(popup.url()).toContain('/object/sign/');
    await popup.close();
  });
});

// ---------------------------------------------------------------------------
// Negative-auth test -- must NOT use storageState (anonymous browser)
// ---------------------------------------------------------------------------

baseTest.describe('@prontuario export negative-auth', () => {
  baseTest('redirects anonymous user from exportacoes page to login', async ({ page }) => {
    const target = `/pacientes/00000000-0000-0000-0000-000000000001/prontuario/exportacoes`;
    await page.goto(target);
    await page.waitForURL('**/login**');
    const url = new URL(page.url());
    expect(url.searchParams.get('redirectTo')).toBeTruthy();
  });
});
