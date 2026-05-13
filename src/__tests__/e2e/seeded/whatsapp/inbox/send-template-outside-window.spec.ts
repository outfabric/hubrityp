import { test, expect } from '@/__tests__/e2e/seeded/setup/db-fixture';
import { readSeedState, STORAGE_STATE_PATH } from '@/__tests__/e2e/seeded/setup/seed-state';

/**
 * @whatsapp-inbox -- Send template reply outside the 24h window E2E test.
 *
 * Flow:
 *   1. Pre-seed: whatsapp_account, unique patient, an old inbound message
 *      (>24h ago), a whatsapp_conversation, and an approved message template.
 *   2. Navigate to /caixa-de-entrada, open the conversation.
 *   3. Verify Textarea is disabled/readonly with info Alert "A janela de
 *      24h expirou".
 *   4. Click "Enviar template...", verify dialog opens with Select + variables.
 *   5. Seed an outbound template message directly via DB and reload.
 *   6. Verify the outbound bubble appears in the thread.
 *
 * Uses a unique patient ID to avoid collision with other parallel inbox tests.
 * Twilio API is unavailable in E2E, so we test the dialog UI then simulate
 * the send result by seeding directly.
 *
 * Prerequisites:
 *   - storageState provides an authenticated psychologist.
 */

const WA_ACCOUNT_ID = '00000000-0000-4000-8000-000000000120';
const TEMPLATE_PATIENT = {
  id: '00000000-0000-4000-8000-000000001300',
  name: 'Fernanda Template',
  phone: '+55 11 99999-1300',
} as const;
const OLD_MSG_ID = '00000000-0000-4000-8000-000000000121';
const OUTBOUND_MSG_ID = '00000000-0000-4000-8000-000000000123';
const CONV_ID = '00000000-0000-4000-8000-000000000122';

test.describe('@whatsapp-inbox send template outside 24h window', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async ({ db }) => {
    const seed = await readSeedState();
    const userId = seed.userId;

    // Clean this test's specific rows by ID
    await db.sql`DELETE FROM public.whatsapp_conversations WHERE id = ${CONV_ID}`;
    await db.sql`DELETE FROM public.whatsapp_messages WHERE id IN (${OLD_MSG_ID}, ${OUTBOUND_MSG_ID})`;

    // Upsert unique patient for this test
    await db.sql`
      INSERT INTO public.patients (id, user_id, full_name, patient_type, phone, tags, status)
      VALUES (${TEMPLATE_PATIENT.id}, ${userId}, ${TEMPLATE_PATIENT.name}, 'individual', ${TEMPLATE_PATIENT.phone}, '{}'::text[], 'active')
      ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, status = 'active';
    `;

    // Upsert whatsapp_account (shared)
    await db.sql`
      INSERT INTO public.whatsapp_accounts (id, user_id, provider, account_id, phone_number, display_name, status, consent_given_at)
      VALUES (${WA_ACCOUNT_ID}, ${userId}, 'twilio', 'MG00000000000000000000000000000000',
        '+5511987654321', 'Dra. Teste', 'active', now())
      ON CONFLICT (user_id) DO UPDATE SET status = 'active';
    `;

    // Insert old inbound message (>24h ago — outside session window)
    await db.sql`
      INSERT INTO public.whatsapp_messages (id, user_id, patient_id, direction, from_phone, to_phone, body, status, created_at)
      VALUES (
        ${OLD_MSG_ID}, ${userId}, ${TEMPLATE_PATIENT.id}, 'inbound',
        ${TEMPLATE_PATIENT.phone}, '+5511987654321',
        'Ola, tudo bem?',
        'delivered', now() - interval '48 hours'
      )
      ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, status = EXCLUDED.status, created_at = EXCLUDED.created_at;
    `;

    // Insert conversation
    await db.sql`
      INSERT INTO public.whatsapp_conversations (id, user_id, patient_id, last_message_id, last_message_at, last_message_preview, unread_count, has_risk)
      VALUES (
        ${CONV_ID}, ${userId}, ${TEMPLATE_PATIENT.id},
        ${OLD_MSG_ID}, now() - interval '48 hours',
        'Ola, tudo bem?', 0, false
      )
      ON CONFLICT (user_id, patient_id) DO UPDATE SET
        last_message_id      = EXCLUDED.last_message_id,
        last_message_at      = EXCLUDED.last_message_at,
        last_message_preview = EXCLUDED.last_message_preview,
        unread_count         = EXCLUDED.unread_count,
        has_risk             = false;
    `;

    // Insert an approved template
    await db.sql`
      INSERT INTO public.message_templates (user_id, template_key, body, variables, meta_template_id, meta_status, is_default)
      VALUES (
        ${userId},
        'lembrete_24h',
        'Ola, {nome_paciente}! Lembrando da sua sessao amanha as {hora}.',
        '["nome_paciente", "hora"]'::jsonb,
        'HX22222222222222222222222222222222',
        'approved',
        true
      )
      ON CONFLICT (user_id, template_key) DO UPDATE SET
        body            = EXCLUDED.body,
        meta_template_id = EXCLUDED.meta_template_id,
        meta_status     = 'approved',
        variables       = EXCLUDED.variables;
    `;
  });

  test('shows expired window alert, template dialog with select and variables, outbound appears after seeding', async ({
    page,
    db,
  }) => {
    const seed = await readSeedState();
    const userId = seed.userId;

    const cacheBust = Date.now();
    await page.goto(`/caixa-de-entrada?_=${cacheBust}`);

    await expect(page.getByTestId('inbox-page-title')).toBeVisible({ timeout: 15000 });

    // Click on the conversation
    const conversationRow = page.locator('[role="button"]').filter({
      hasText: TEMPLATE_PATIENT.name,
    });
    await expect(conversationRow).toBeVisible({ timeout: 10000 });
    await conversationRow.click();

    // Scope all further queries to <main> to avoid strict-mode violations
    // from the mobile Sheet (which also renders the thread components).
    const main = page.locator('main');

    // Wait for thread
    const messageLog = main.getByLabel('Historico de mensagens');
    await expect(messageLog).toBeVisible({ timeout: 10000 });

    // Verify Textarea is readonly (outside 24h window)
    const textarea = main.locator('textarea[readonly]');
    await expect(textarea).toBeVisible();

    // Verify the info Alert about expired window
    await expect(main.getByText('A janela de 24h expirou')).toBeVisible();

    // Close the mobile Sheet overlay that was opened when we clicked the
    // conversation (it renders even on desktop and intercepts pointer events).
    await page.keyboard.press('Escape');
    // Wait for the overlay to close
    await page
      .locator('[data-state="open"][aria-hidden="true"]')
      .waitFor({ state: 'hidden', timeout: 3000 })
      .catch(() => {});

    // Click "Enviar template..." button (scoped to main)
    const templateButton = main.getByText('Enviar template...');
    await expect(templateButton).toBeVisible();
    await templateButton.click();

    // Verify desktop dialog opens with title "Enviar template".
    // The TemplateReplyDialog renders both a Dialog (desktop, hidden on md:)
    // and a Sheet (mobile). Scope to the visible Dialog.
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText('Enviar template')).toBeVisible();

    // Select the template — scope to the visible dialog.
    // The conversation Sheet overlay may sit on top, so use dispatchEvent
    // to bypass overlay interception (the dialog is verified visible above).
    const templateSelect = dialog.locator('#template-select');
    await templateSelect.dispatchEvent('click');

    // Select the "Lembrete 24h" option
    await page.getByRole('option', { name: 'Lembrete 24h' }).click();

    // Fill in the variables (scoped to dialog)
    const nomePacienteInput = dialog.locator('#var-nome_paciente');
    await expect(nomePacienteInput).toBeVisible({ timeout: 5000 });
    await nomePacienteInput.fill('Fernanda');

    const horaInput = dialog.locator('#var-hora');
    await expect(horaInput).toBeVisible();
    await horaInput.fill('14:00');

    // Close the dialog
    await page.keyboard.press('Escape');

    // Simulate the send: seed an outbound template message directly via DB
    const renderedBody = 'Ola, Fernanda! Lembrando da sua sessao amanha as 14:00.';
    await db.sql`
      INSERT INTO public.whatsapp_messages (id, user_id, patient_id, direction, to_phone, body, template_key, status, sent_at, created_at)
      VALUES (
        ${OUTBOUND_MSG_ID}, ${userId}, ${TEMPLATE_PATIENT.id}, 'outbound',
        ${TEMPLATE_PATIENT.phone}, ${renderedBody}, 'lembrete_24h', 'sent', now(), now()
      )
      ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, status = EXCLUDED.status, created_at = EXCLUDED.created_at;
    `;

    // Reload to see the seeded outbound message
    const cacheBust2 = Date.now();
    await page.goto(`/caixa-de-entrada?_=${cacheBust2}`);
    await expect(page.getByTestId('inbox-page-title')).toBeVisible({ timeout: 15000 });

    const conversationRow2 = page.locator('[role="button"]').filter({
      hasText: TEMPLATE_PATIENT.name,
    });
    await expect(conversationRow2).toBeVisible({ timeout: 10000 });
    await conversationRow2.click();

    const main2 = page.locator('main');
    const messageLog2 = main2.getByLabel('Historico de mensagens');
    await expect(messageLog2).toBeVisible({ timeout: 10000 });

    // Verify the outbound bubble with the rendered template text
    await expect(messageLog2.getByText(renderedBody)).toBeVisible({ timeout: 10000 });
  });
});
