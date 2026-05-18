import { expect, type Page } from '@playwright/test';

import { test } from '../setup/db-fixture';
import { SEED_PATIENTS, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @prontuario -- Attachments & Personal Notes E2E tests.
 *
 * Tests the "Anexos" and "Notas" tabs inside the prontuario shell:
 *
 *   Attachments (8.1):
 *     1. Upload PDF -> assert preview iframe loads -> verify card in list
 *     2. Upload image -> assert inline preview (img element)
 *     3. Audio without consent -> blocked UI with consent warning Alert
 *     4. Seed active consent term -> audio upload succeeds
 *     5. Soft-delete attachment -> confirm dialog -> removed from list
 *
 *   Personal Notes (8.2):
 *     6. Set password -> reload -> lock screen shown -> wrong password 5x ->
 *        lockout message with countdown -> seed locked_until in the past ->
 *        correct password -> content visible
 *     7. Personal notes write/auto-save persists across page reload
 *     8. Banner text present (CFP 001/2009 regulatory note)
 *
 * Prerequisites:
 *   - Seeded storageState provides an authenticated psychologist.
 *   - Patient SEED_PATIENTS.activeMinimal exists (seeded in globalSetup).
 *   - Supabase Storage is mocked via page.route() (no real storage).
 */

const SEED_USER_ID = '00000000-0000-4000-8000-000000000001';

// Use activeMinimal to avoid collision with evolution/session tests
const patientId = SEED_PATIENTS.activeMinimal.id;

// ---------------------------------------------------------------------------
// Helpers — Supabase Storage mocking
// ---------------------------------------------------------------------------

/**
 * Mocks the browser-side loading of signed URLs returned by the server action.
 *
 * The server-side storage operations (upload, createSignedUrl) go through
 * the mock GoTrue's /storage/v1/* shim and succeed at the server level.
 * The signed URL the server action returns points back to the mock GoTrue
 * (e.g., http://127.0.0.1:54321/object/sign/...). When the browser renders
 * an iframe/img with that URL, we intercept it via page.route() and return
 * mock content so the preview elements render correctly.
 */
async function mockStorageRoutes(page: Page) {
  await page.route('**/object/sign/**', (route) => {
    // Return a 1x1 transparent PNG so <img> elements render correctly.
    // For iframe (PDF) previews, browsers display the image inline — the
    // iframe is still visible in the DOM regardless of content type.
    return route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
  });
}

// ---------------------------------------------------------------------------
// 8.1 — Attachments tab tests
// ---------------------------------------------------------------------------

test.describe('@prontuario attachments tab', () => {
  test.use({ storageState: STORAGE_STATE_PATH });
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90_000);

  test.beforeEach(async ({ db }) => {
    // Clean up attachments and personal notes for this patient
    await db.sql`
      DELETE FROM public.evolution_attachments
      WHERE patient_id = ${patientId}
        AND user_id = ${SEED_USER_ID}
    `;
    // Reset consent state — no active consent by default for audio-block test
    await db.sql`
      UPDATE public.patients
      SET consent_signed_at = NULL,
          consent_revoked_at = NULL
      WHERE id = ${patientId}
    `;
    // Remove any consent terms for this patient
    await db.sql`
      DELETE FROM public.consent_terms
      WHERE patient_id = ${patientId}
        AND user_id = ${SEED_USER_ID}
    `;
  });

  test('uploads a PDF, sees preview iframe, and verifies card in list', async ({ page }) => {
    await mockStorageRoutes(page);

    // Navigate to prontuario and open Anexos tab
    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-anexos').click();
    await expect(page.getByTestId('prontuario-tab-content-anexos')).toBeVisible();

    // Should see empty state initially
    await expect(page.getByTestId('attachments-empty-state')).toBeVisible();

    // Click "Anexar arquivo" button
    await page.getByTestId('attachments-upload-button').click();

    // Upload sheet should open
    await expect(page.getByTestId('attachment-upload-sheet')).toBeVisible();

    // Select a PDF file via the hidden input
    const fileInput = page.getByTestId('attachment-file-input');
    await fileInput.setInputFiles({
      name: 'exame-sangue.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 test content for e2e'),
    });

    // Verify file name appears in the dropzone
    await expect(page.getByText('exame-sangue.pdf')).toBeVisible();

    // Category should default to "Exame externo" (exam) — leave as is
    await expect(page.getByTestId('attachment-category-exam')).toBeChecked();

    // Click Anexar submit button
    await page.getByTestId('attachment-submit-button').click();

    // Wait for success toast
    await expect(page.getByText(/anexado com sucesso/i)).toBeVisible({ timeout: 15_000 });

    // Sheet should close and card should appear in list
    await expect(page.getByTestId('attachment-upload-sheet')).not.toBeVisible();
    const attachmentsList = page.getByTestId('attachments-list');
    await expect(attachmentsList).toBeVisible({ timeout: 10_000 });

    // Verify the attachment card shows the display name
    await expect(attachmentsList.getByText('exame-sangue.pdf')).toBeVisible();

    // Click the preview (eye) button on the card.
    // The button and the preview container share the same data-testid pattern.
    // At click time, only the button exists (preview container appears after).
    const card = attachmentsList.locator('[data-testid^="attachment-card-"]').first();
    const cardId = await card.getAttribute('data-testid');
    const attachmentId = cardId?.replace('attachment-card-', '');

    // Use the button inside the card to trigger preview
    await card.getByRole('button', { name: /Visualizar arquivo/i }).click();

    // Assert preview container appears with iframe (PDF preview).
    // The container is a div (not a button) with the same testid — scope via :has(iframe).
    const previewIframe = page.locator(`[data-testid="attachment-preview-${attachmentId}"] iframe`);
    await expect(previewIframe).toBeVisible({ timeout: 10_000 });
  });

  test('uploads an image and sees inline preview with img element', async ({ page }) => {
    await mockStorageRoutes(page);

    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-anexos').click();
    await expect(page.getByTestId('prontuario-tab-content-anexos')).toBeVisible();

    // Click "Anexar arquivo"
    await page.getByTestId('attachments-upload-button').click();
    await expect(page.getByTestId('attachment-upload-sheet')).toBeVisible();

    // Select image category
    await page.getByTestId('attachment-category-image').click();

    // Upload an image file
    const fileInput = page.getByTestId('attachment-file-input');
    await fileInput.setInputFiles({
      name: 'desenho-paciente.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    });

    await expect(page.getByText('desenho-paciente.png')).toBeVisible();

    // Submit
    await page.getByTestId('attachment-submit-button').click();
    await expect(page.getByText(/anexado com sucesso/i)).toBeVisible({ timeout: 15_000 });

    // Card should appear
    const attachmentsList = page.getByTestId('attachments-list');
    await expect(attachmentsList).toBeVisible({ timeout: 10_000 });
    await expect(attachmentsList.getByText('desenho-paciente.png')).toBeVisible();

    // Click preview button via the card's aria-labeled button
    const card = attachmentsList.locator('[data-testid^="attachment-card-"]').first();
    const cardId = await card.getAttribute('data-testid');
    const attachmentId = cardId?.replace('attachment-card-', '');
    await card.getByRole('button', { name: /Visualizar arquivo/i }).click();

    // Assert inline img preview (not iframe).
    // The container is a div with the preview testid — scope via img child.
    const previewImg = page.locator(`[data-testid="attachment-preview-${attachmentId}"] img`);
    await expect(previewImg).toBeVisible({ timeout: 10_000 });
  });

  test('blocks audio upload when no consent term exists', async ({ page }) => {
    await mockStorageRoutes(page);

    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-anexos').click();
    await expect(page.getByTestId('prontuario-tab-content-anexos')).toBeVisible();

    // Open upload sheet
    await page.getByTestId('attachments-upload-button').click();
    await expect(page.getByTestId('attachment-upload-sheet')).toBeVisible();

    // Select audio category
    await page.getByTestId('attachment-category-audio').click();

    // Assert consent warning Alert is visible
    await expect(page.getByTestId('attachment-consent-warning')).toBeVisible();
    await expect(page.getByText(/Gravacoes requerem termo de consentimento/i)).toBeVisible();

    // The submit button should be disabled
    await expect(page.getByTestId('attachment-submit-button')).toBeDisabled();
  });

  test('audio upload succeeds after seeding an active consent term', async ({ page, db }) => {
    // Seed an active (signed, not revoked) consent term for this patient.
    // The page.tsx derives hasActiveConsent from the consent_terms table
    // (same source as the server action's checkActiveConsent), NOT from the
    // denormalized patients.consent_signed_at column.
    await db.sql`
      INSERT INTO public.consent_terms (id, patient_id, user_id, term_text, signature_token, signed_at, signed_ip, signed_user_agent)
      VALUES (
        gen_random_uuid(),
        ${patientId},
        ${SEED_USER_ID},
        'Consentimento para gravacao de sessoes',
        ${'9'.repeat(64)},
        now(),
        '127.0.0.1',
        'e2e-agent'
      )
      ON CONFLICT DO NOTHING
    `;

    await mockStorageRoutes(page);

    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-anexos').click();
    await expect(page.getByTestId('prontuario-tab-content-anexos')).toBeVisible();

    // Open upload sheet
    await page.getByTestId('attachments-upload-button').click();
    await expect(page.getByTestId('attachment-upload-sheet')).toBeVisible();

    // Select audio category
    await page.getByTestId('attachment-category-audio').click();

    // With active consent, the warning should NOT appear
    await expect(page.getByTestId('attachment-consent-warning')).not.toBeVisible();

    // Upload an audio file
    const fileInput = page.getByTestId('attachment-file-input');
    await fileInput.setInputFiles({
      name: 'sessao-gravacao.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('ID3 mock audio content for e2e test'),
    });

    await expect(page.getByText('sessao-gravacao.mp3')).toBeVisible();

    // Submit should be enabled
    await expect(page.getByTestId('attachment-submit-button')).toBeEnabled();
    await page.getByTestId('attachment-submit-button').click();

    // Wait for success
    await expect(page.getByText(/anexado com sucesso/i)).toBeVisible({ timeout: 15_000 });
  });

  test('soft-deletes an attachment via confirm dialog and removes from list', async ({
    page,
    db,
  }) => {
    await mockStorageRoutes(page);

    // Seed an attachment directly in the DB for this test
    const attachId = '00000000-0000-4000-8000-000000000070';
    const storagePath = `${SEED_USER_ID}/${patientId}/test-uuid.pdf`;
    await db.sql`
      INSERT INTO public.evolution_attachments (
        id, user_id, patient_id, file_name, display_name, file_size,
        mime_type, storage_path, category, consent_verified
      ) VALUES (
        ${attachId},
        ${SEED_USER_ID},
        ${patientId},
        'test-uuid.pdf',
        'laudo-medico.pdf',
        1024,
        'application/pdf',
        ${storagePath},
        'exam',
        false
      )
      ON CONFLICT (id) DO UPDATE SET deleted_at = NULL
    `;

    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-anexos').click();
    await expect(page.getByTestId('prontuario-tab-content-anexos')).toBeVisible();

    // The attachment list should show the seeded file
    const attachmentsList = page.getByTestId('attachments-list');
    await expect(attachmentsList).toBeVisible({ timeout: 10_000 });
    await expect(attachmentsList.getByText('laudo-medico.pdf')).toBeVisible();

    // Click the delete (trash) button on the card
    await page.getByTestId(`attachment-delete-${attachId}`).click();

    // Confirm dialog should appear
    await expect(page.getByTestId('attachment-delete-dialog')).toBeVisible();
    await expect(page.getByText(/Tem certeza/i)).toBeVisible();
    await expect(page.getByText(/copia auditavel/i)).toBeVisible();

    // Click "Excluir" to confirm
    await page.getByTestId('attachment-delete-confirm').click();

    // Wait for success toast
    await expect(page.getByText('Arquivo removido do prontuario.')).toBeVisible({
      timeout: 10_000,
    });

    // The file should no longer appear in the list
    await expect(attachmentsList.getByText('laudo-medico.pdf')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 8.2 — Personal Notes tab tests
// ---------------------------------------------------------------------------

test.describe('@prontuario personal notes tab', () => {
  test.use({ storageState: STORAGE_STATE_PATH });
  test.describe.configure({ mode: 'serial' });

  // Auto-save has a 10s debounce; password lockout tests need time too.
  test.setTimeout(120_000);

  test.beforeEach(async ({ db }) => {
    // Clean up personal notes for this patient
    await db.sql`
      DELETE FROM public.personal_notes
      WHERE patient_id = ${patientId}
        AND user_id = ${SEED_USER_ID}
    `;
  });

  test('banner text (CFP 001/2009 regulatory note) is present', async ({ page }) => {
    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-notas').click();
    await expect(page.getByTestId('prontuario-tab-content-notas')).toBeVisible();

    // Verify the regulatory banner is visible with the expected text
    await expect(page.getByTestId('personal-notes-banner')).toBeVisible();
    await expect(page.getByTestId('personal-notes-banner')).toContainText(
      'Resolucao CFP 001/2009, art. 5',
    );
    await expect(page.getByTestId('personal-notes-banner')).toContainText(
      'NAO fazem parte do prontuario oficial',
    );
  });

  test('writes content that persists across page reload via auto-save', async ({ page }) => {
    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-notas').click();
    await expect(page.getByTestId('prontuario-tab-content-notas')).toBeVisible();

    // The editor should be visible (no password set yet)
    await expect(page.getByTestId('personal-notes-lock')).not.toBeVisible();

    // Type content in the Tiptap editor
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible();
    await editor.click();
    await editor.fill('Notas pessoais do teste E2E — paciente apresenta melhora significativa');

    // Wait for auto-save indicator to show "Salvo as HH:MM"
    await expect(page.getByTestId('auto-save-indicator')).toContainText(/Salvo as/i, {
      timeout: 30_000,
    });

    // Reload the page
    await page.reload();
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-notas').click();
    await expect(page.getByTestId('prontuario-tab-content-notas')).toBeVisible();

    // Verify the content persisted
    const editorAfterReload = page.locator('[contenteditable="true"]').first();
    await expect(editorAfterReload).toContainText(
      'Notas pessoais do teste E2E',
      { timeout: 10_000 },
    );
  });

  test('set password -> reload -> lock screen -> wrong 5x -> lockout -> seed past lockout -> correct password -> content visible', async ({
    page,
    db,
  }) => {
    // First, write some content without a password
    await page.goto(`/pacientes/${patientId}/prontuario`);
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-notas').click();
    await expect(page.getByTestId('prontuario-tab-content-notas')).toBeVisible();

    // Type content
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible();
    await editor.click();
    await editor.fill('Conteudo secreto que deve estar protegido por senha');

    // Wait for auto-save
    await expect(page.getByTestId('auto-save-indicator')).toContainText(/Salvo as/i, {
      timeout: 30_000,
    });

    // Set a password via the "Configurar senha extra" link
    await page.getByTestId('personal-notes-set-password').click();
    await expect(page.getByTestId('personal-notes-password-sheet')).toBeVisible();

    // Fill password fields
    await page.getByTestId('password-new-input').fill('minhaSenha123');
    await page.getByTestId('password-confirm-input').fill('minhaSenha123');
    await page.getByTestId('password-set-submit').click();

    // Wait for success toast
    await expect(page.getByText('Senha configurada com sucesso.')).toBeVisible({
      timeout: 10_000,
    });

    // Reload the page — the lock screen should appear
    await page.reload();
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-notas').click();
    await expect(page.getByTestId('prontuario-tab-content-notas')).toBeVisible();

    // Lock screen should be visible
    await expect(page.getByTestId('personal-notes-lock')).toBeVisible();
    await expect(page.getByText('Notas protegidas')).toBeVisible();

    // Enter wrong password 5 times to trigger lockout
    for (let i = 0; i < 5; i++) {
      await page.getByTestId('personal-notes-lock-password').fill('senhaErrada');
      await page.getByTestId('personal-notes-lock-submit').click();

      if (i < 4) {
        // Should see "Senha incorreta. Tentativas restantes: N"
        await expect(page.getByTestId('personal-notes-lock-error')).toBeVisible({
          timeout: 10_000,
        });
        await expect(page.getByTestId('personal-notes-lock-error')).toContainText(
          `Tentativas restantes: ${4 - i}`,
        );
      }
    }

    // After the 5th wrong attempt, lockout message should appear
    await expect(page.getByTestId('personal-notes-lockout-message')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('personal-notes-lockout-message')).toContainText(
      /Bloqueado por \d+ minuto/,
    );

    // Seed locked_until in the past to simulate the cooldown period expiring
    await db.sql`
      UPDATE public.personal_notes
      SET locked_until = now() - interval '1 minute',
          failed_attempts = 0
      WHERE patient_id = ${patientId}
        AND user_id = ${SEED_USER_ID}
    `;

    // Reload to get the fresh lockout state from the server
    await page.reload();
    await expect(page.getByTestId('prontuario-page-title')).toBeVisible();
    await page.getByTestId('prontuario-tab-notas').click();
    await expect(page.getByTestId('prontuario-tab-content-notas')).toBeVisible();

    // Lock screen should be back (password input, not lockout countdown)
    await expect(page.getByTestId('personal-notes-lock')).toBeVisible();
    await expect(page.getByTestId('personal-notes-lock-password')).toBeVisible();
    await expect(page.getByTestId('personal-notes-lockout-message')).not.toBeVisible();

    // Enter correct password
    await page.getByTestId('personal-notes-lock-password').fill('minhaSenha123');
    await page.getByTestId('personal-notes-lock-submit').click();

    // Content should be visible now (the editor with the previously saved content)
    await expect(page.getByTestId('personal-notes-lock')).not.toBeVisible({ timeout: 10_000 });
    const unlockedEditor = page.locator('[contenteditable="true"]').first();
    await expect(unlockedEditor).toContainText('Conteudo secreto que deve estar protegido', {
      timeout: 10_000,
    });
  });
});
