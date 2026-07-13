import { test, expect } from '../setup/db-fixture';
import { readSeedState, STORAGE_STATE_PATH } from '../setup/seed-state';

/**
 * @whatsapp -- Template editing flow E2E test.
 *
 * Flow:
 *   1. Pre-seed: insert whatsapp_account + 5 templates via direct SQL
 *   2. Navigate to /configuracoes/lembretes/templates
 *   3. Verify 5 template cards appear
 *   4. Click "Lembrete 24h" card
 *   5. Verify edit page opens with body in textarea
 *   6. Edit body (append text)
 *   7. Verify char counter updates
 *   8. Click variable badge "{hora}" and verify insertion
 *   9. Verify preview updates
 *  10. Click "Salvar e enviar para aprovacao" (mock Twilio Content API)
 *  11. Verify redirect to template list
 *  12. Verify badge changed to "Em analise"
 *
 * Prerequisites:
 *   - Seeded session (storageState) provides an authenticated psychologist.
 *   - whatsapp_account + templates are seeded in beforeEach.
 */

// Deterministic UUIDs for seeded data
const WHATSAPP_ACCOUNT_ID = '00000000-0000-4000-8000-000000000050';

const TEMPLATE_KEYS = [
  'lembrete_24h',
  'lembrete_2h',
  'cancelamento_aviso',
  'link_video',
  'termo_consentimento',
] as const;

const DEFAULT_BODIES: Record<string, string> = {
  lembrete_24h:
    'Ola, {nome_paciente}! Lembrando da sua sessao com {nome_psicologo} amanha, {data} ({dia_semana}), as {hora}. Duracao: {duracao_min} min.',
  lembrete_2h:
    'Ola, {nome_paciente}! Sua sessao com {nome_psicologo} e em 2 horas, as {hora} ({dia_semana}).',
  cancelamento_aviso:
    'Ola, {nome_paciente}. Informamos que sua sessao com {nome_psicologo} em {data}, as {hora}, foi cancelada.',
  link_video:
    'Ola, {nome_paciente}! Sua sessao online com {nome_psicologo} comeca em breve. Acesse: {link_video}',
  termo_consentimento:
    'Ola, {nome_completo}. {nome_psicologo} enviou o Termo de Consentimento para assinatura.',
};

// Expected human-readable labels for template cards (must match accented
// strings in the UI component `template-card.tsx`)
const TEMPLATE_LABELS: Record<string, string> = {
  lembrete_24h: 'Lembrete 24h',
  lembrete_2h: 'Lembrete 2h',
  cancelamento_aviso: 'Aviso de cancelamento',
  link_video: 'Link de vídeo',
  termo_consentimento: 'Termo de consentimento',
};

test.describe('@whatsapp template editing', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async ({ db }) => {
    const seed = await readSeedState();
    const userId = seed.userId;

    // Clean up any existing whatsapp data for this user
    await db.sql`DELETE FROM public.message_templates WHERE user_id = ${userId}`;
    await db.sql`DELETE FROM public.whatsapp_accounts WHERE user_id = ${userId}`;

    // Insert whatsapp_account (upsert by user_id to handle parallel test interference)
    await db.sql`
      INSERT INTO public.whatsapp_accounts (id, user_id, provider, account_id, phone_number, display_name, status, consent_given_at)
      VALUES (
        ${WHATSAPP_ACCOUNT_ID},
        ${userId},
        'twilio',
        'MG00000000000000000000000000000000',
        '+5511987654321',
        'Dra. Teste',
        'active',
        now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        status       = 'active',
        phone_number = EXCLUDED.phone_number,
        display_name = EXCLUDED.display_name;
    `;

    // Insert 5 default templates with 'approved' status
    for (const key of TEMPLATE_KEYS) {
      const body = DEFAULT_BODIES[key] ?? '';
      await db.sql`
        INSERT INTO public.message_templates (user_id, template_key, body, variables, meta_status, is_default)
        VALUES (
          ${userId},
          ${key},
          ${body},
          '[]'::jsonb,
          'approved',
          true
        )
        ON CONFLICT (user_id, template_key) DO UPDATE SET
          body        = EXCLUDED.body,
          meta_status = EXCLUDED.meta_status,
          variables   = EXCLUDED.variables;
      `;
    }
  });

  test('lists 5 template cards with correct names', async ({ page }) => {
    await page.goto('/configuracoes/lembretes/templates');

    // Verify page title
    await expect(page.getByTestId('templates-page-title')).toBeVisible();
    await expect(page.getByTestId('templates-page-title')).toHaveText('Templates de Mensagem');

    // Verify 5 template cards appear
    for (const key of TEMPLATE_KEYS) {
      const card = page.getByTestId(`template-card-${key}`);
      await expect(card).toBeVisible({ timeout: 10000 });
      // Verify the card contains the expected label text
      const label = TEMPLATE_LABELS[key] ?? key;
      await expect(card).toContainText(label);
    }
  });

  test('edits Lembrete 24h body, inserts variable, previews, and submits', async ({ page }) => {
    // Mock Twilio Content API for template submission
    await page.route('**/v1/Content', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sid: 'HX11111111111111111111111111111111' }),
      });
    });

    // Mock approval submission
    await page.route('**/v1/Content/*/ApprovalRequests/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'pending' }),
      });
    });

    // Navigate to templates listing
    await page.goto('/configuracoes/lembretes/templates');

    // Wait for cards to render, then click "Lembrete 24h" card
    const lembrete24hCard = page.getByTestId('template-card-lembrete_24h');
    await expect(lembrete24hCard).toBeVisible({ timeout: 10000 });
    await lembrete24hCard.click();

    // Verify edit page loads
    await expect(page.getByTestId('template-edit-title')).toHaveText('Lembrete 24h', {
      timeout: 10000,
    });

    // Verify the textarea has the current body
    const textarea = page.getByTestId('template-body-textarea');
    await expect(textarea).toBeVisible();
    const currentBody = await textarea.inputValue();
    expect(currentBody.length).toBeGreaterThan(0);

    // Record initial char count
    const initialCharCounter = page.getByTestId('template-char-counter');
    await expect(initialCharCounter).toBeVisible();
    const initialCounterText = await initialCharCounter.textContent();
    const initialLength = parseInt(initialCounterText?.split('/')[0]?.trim() ?? '0', 10);

    // Edit the body: append text
    const appendedText = ' Atendimento presencial.';
    await textarea.click();
    await textarea.press('End');
    await textarea.type(appendedText);

    // Verify char counter updated
    const expectedLength = initialLength + appendedText.length;
    await expect(initialCharCounter).toContainText(`${expectedLength} / 1024`);

    // Click variable badge "{hora}" to insert it
    const horaBadge = page.getByTestId('variable-badge-hora');
    await expect(horaBadge).toBeVisible();
    await horaBadge.click();

    // Verify the textarea now contains "{hora}" (appended at cursor position)
    const updatedBody = await textarea.inputValue();
    expect(updatedBody).toContain('{hora}');

    // Verify preview card updates (contains example value for hora: "14:00")
    const previewText = page.getByTestId('template-preview-text');
    await expect(previewText).toBeVisible();
    // The preview should contain the rendered example for {hora}
    await expect(previewText).toContainText('14:00');

    // Click "Salvar e enviar para aprovacao"
    await page.getByTestId('template-submit-button').click();

    // Wait for success toast
    await expect(page.getByText('Template salvo e enviado para')).toBeVisible({ timeout: 10000 });

    // Verify redirect back to template listing
    await page.waitForURL('**/configuracoes/lembretes/templates', { timeout: 10000 });

    // Verify the lembrete_24h card badge shows "Em analise"
    const updatedCard = page.getByTestId('template-card-lembrete_24h');
    await expect(updatedCard).toBeVisible({ timeout: 10000 });
    const metaBadge = updatedCard.getByTestId('template-meta-status-badge');
    await expect(metaBadge).toHaveText('Em análise', { timeout: 10000 });
  });
});
