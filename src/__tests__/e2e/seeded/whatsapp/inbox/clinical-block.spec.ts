import { test, expect } from '@/__tests__/e2e/seeded/setup/db-fixture';
import { readSeedState, STORAGE_STATE_PATH } from '@/__tests__/e2e/seeded/setup/seed-state';

/**
 * @whatsapp-inbox -- Clinical content blocker E2E test.
 *
 * Flow:
 *   1. Pre-seed: whatsapp_account, unique patient, a recent inbound message
 *      (<24h), and a whatsapp_conversation.
 *   2. Navigate to /caixa-de-entrada, open the conversation.
 *   3. Type clinical content: "a paciente apresenta sintomas de ansiedade
 *      generalizada".
 *   4. Verify a warning Alert appears.
 *   5. Verify the "Enviar" button is disabled.
 *
 * Uses a unique patient ID to avoid collision with other parallel inbox tests.
 *
 * Prerequisites:
 *   - storageState provides an authenticated psychologist.
 */

const WA_ACCOUNT_ID = '00000000-0000-4000-8000-000000000130';
const CLINICAL_PATIENT = {
  id: '00000000-0000-4000-8000-000000001400',
  name: 'Gabriela Clinico',
  phone: '+55 11 99999-1400',
} as const;
const INBOUND_MSG_ID = '00000000-0000-4000-8000-000000000131';
const CONV_ID = '00000000-0000-4000-8000-000000000132';

test.describe('@whatsapp-inbox clinical content blocker', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async ({ db }) => {
    const seed = await readSeedState();
    const userId = seed.userId;

    // Clean this test's specific rows by ID
    await db.sql`DELETE FROM public.whatsapp_conversations WHERE id = ${CONV_ID}`;
    await db.sql`DELETE FROM public.whatsapp_messages WHERE id = ${INBOUND_MSG_ID}`;

    // Upsert unique patient for this test
    await db.sql`
      INSERT INTO public.patients (id, user_id, full_name, patient_type, phone, tags, status)
      VALUES (${CLINICAL_PATIENT.id}, ${userId}, ${CLINICAL_PATIENT.name}, 'individual', ${CLINICAL_PATIENT.phone}, '{}'::text[], 'active')
      ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, status = 'active';
    `;

    // Upsert whatsapp_account (shared)
    await db.sql`
      INSERT INTO public.whatsapp_accounts (id, user_id, provider, account_id, phone_number, display_name, status, consent_given_at)
      VALUES (${WA_ACCOUNT_ID}, ${userId}, 'twilio', 'MG00000000000000000000000000000000',
        '+5511987654321', 'Dra. Teste', 'active', now())
      ON CONFLICT (user_id) DO UPDATE SET status = 'active';
    `;

    // Insert recent inbound message (within 24h window)
    await db.sql`
      INSERT INTO public.whatsapp_messages (id, user_id, patient_id, direction, from_phone, to_phone, body, status, created_at)
      VALUES (
        ${INBOUND_MSG_ID}, ${userId}, ${CLINICAL_PATIENT.id}, 'inbound',
        ${CLINICAL_PATIENT.phone}, '+5511987654321',
        'Oi doutora, preciso falar sobre meus sentimentos',
        'delivered', now() - interval '15 minutes'
      )
      ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, status = EXCLUDED.status, created_at = EXCLUDED.created_at;
    `;

    // Insert conversation
    await db.sql`
      INSERT INTO public.whatsapp_conversations (id, user_id, patient_id, last_message_id, last_message_at, last_message_preview, unread_count, has_risk)
      VALUES (
        ${CONV_ID}, ${userId}, ${CLINICAL_PATIENT.id},
        ${INBOUND_MSG_ID}, now() - interval '15 minutes',
        'Oi doutora, preciso falar sobre meus sentimentos', 1, false
      )
      ON CONFLICT (user_id, patient_id) DO UPDATE SET
        last_message_id      = EXCLUDED.last_message_id,
        last_message_at      = EXCLUDED.last_message_at,
        last_message_preview = EXCLUDED.last_message_preview,
        unread_count         = EXCLUDED.unread_count,
        has_risk             = false;
    `;
  });

  test('typing clinical content shows warning alert and disables send button', async ({ page }) => {
    const cacheBust = Date.now();
    await page.goto(`/caixa-de-entrada?_=${cacheBust}`);

    await expect(page.getByTestId('inbox-page-title')).toBeVisible({ timeout: 15000 });

    // Click on the conversation
    const conversationRow = page.locator('[role="button"]').filter({
      hasText: CLINICAL_PATIENT.name,
    });
    await expect(conversationRow).toBeVisible({ timeout: 10000 });
    await conversationRow.click();

    // Wait for thread
    const messageLog = page.locator('main').getByLabel('Historico de mensagens');
    await expect(messageLog).toBeVisible({ timeout: 10000 });

    // Close the mobile Sheet overlay that was opened when we clicked the
    // conversation (it renders even on desktop and intercepts pointer events).
    await page.keyboard.press('Escape');
    await page
      .locator('[data-state="open"][aria-hidden="true"]')
      .waitFor({ state: 'hidden', timeout: 3000 })
      .catch(() => {});

    // Scope all further queries to <main> to avoid strict-mode violations
    // from the mobile Sheet (which also renders the thread components).
    const main = page.locator('main');

    // Verify textarea is enabled (within 24h window)
    const textarea = main.getByPlaceholder('Escreva uma mensagem...');
    await expect(textarea).toBeVisible();
    await expect(textarea).not.toHaveAttribute('readonly');

    // Type clinical content that triggers the blocker
    // "ansiedade generalizada" matches the clinical-content-blocker pattern
    await textarea.fill('a paciente apresenta sintomas de ansiedade generalizada');

    // Verify the warning Alert appears
    const warningAlert = main
      .getByText('conteudo parece ser clinico')
      .or(main.getByText('Esse conteudo parece ser clinico'));
    await expect(warningAlert).toBeVisible({ timeout: 5000 });

    // Verify the Send button is disabled
    const sendButton = main.getByRole('button', { name: 'Enviar mensagem' });
    await expect(sendButton).toBeDisabled();
  });
});
