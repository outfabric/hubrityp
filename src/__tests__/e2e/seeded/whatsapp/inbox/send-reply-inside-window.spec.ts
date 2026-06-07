import { test, expect } from '@/__tests__/e2e/seeded/setup/db-fixture';
import { readSeedState, STORAGE_STATE_PATH } from '@/__tests__/e2e/seeded/setup/seed-state';

/**
 * @whatsapp-inbox -- Send free-text reply inside the 24h window E2E test.
 *
 * Flow:
 *   1. Pre-seed: whatsapp_account, unique patient, a recent inbound message
 *      (<24h), and a whatsapp_conversation.
 *   2. Navigate to /caixa-de-entrada, open the conversation.
 *   3. Verify Textarea is enabled (within 24h window).
 *   4. Type "Confirmo seu horario de amanha" and verify Send button enabled.
 *   5. Seed an outbound message directly via DB (simulating Twilio send)
 *      and reload the conversation.
 *   6. Verify the new outbound bubble appears with 'sent' status icon.
 *
 * Uses a unique patient ID to avoid collision with other parallel inbox tests.
 * Twilio API is unavailable in E2E, so we verify UI form state then simulate
 * the send result by seeding directly.
 *
 * Prerequisites:
 *   - storageState provides an authenticated psychologist.
 */

const WA_ACCOUNT_ID = '00000000-0000-4000-8000-000000000110';
const REPLY_PATIENT = {
  id: '00000000-0000-4000-8000-000000001200',
  name: 'Elena Resposta',
  phone: '+55 11 99999-1200',
} as const;
const INBOUND_MSG_ID = '00000000-0000-4000-8000-000000000111';
const OUTBOUND_MSG_ID = '00000000-0000-4000-8000-000000000113';
const CONV_ID = '00000000-0000-4000-8000-000000000112';

test.describe('@whatsapp-inbox send reply inside 24h window', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async ({ db }) => {
    const seed = await readSeedState();
    const userId = seed.userId;

    // Clean this test's specific rows by ID
    await db.sql`DELETE FROM public.whatsapp_conversations WHERE id = ${CONV_ID}`;
    await db.sql`DELETE FROM public.whatsapp_messages WHERE id IN (${INBOUND_MSG_ID}, ${OUTBOUND_MSG_ID})`;

    // Upsert unique patient for this test
    await db.sql`
      INSERT INTO public.patients (id, user_id, full_name, patient_type, phone, tags, status)
      VALUES (${REPLY_PATIENT.id}, ${userId}, ${REPLY_PATIENT.name}, 'individual', ${REPLY_PATIENT.phone}, '{}'::text[], 'active')
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
        ${INBOUND_MSG_ID}, ${userId}, ${REPLY_PATIENT.id}, 'inbound',
        ${REPLY_PATIENT.phone}, '+5511987654321',
        'Bom dia, posso confirmar o horario?',
        'delivered', now() - interval '30 minutes'
      )
      ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, status = EXCLUDED.status, created_at = EXCLUDED.created_at;
    `;

    // Insert conversation
    await db.sql`
      INSERT INTO public.whatsapp_conversations (id, user_id, patient_id, last_message_id, last_message_at, last_message_preview, unread_count, has_risk)
      VALUES (
        ${CONV_ID}, ${userId}, ${REPLY_PATIENT.id},
        ${INBOUND_MSG_ID}, now() - interval '30 minutes',
        'Bom dia, posso confirmar o horario?', 1, false
      )
      ON CONFLICT (user_id, patient_id) DO UPDATE SET
        last_message_id      = EXCLUDED.last_message_id,
        last_message_at      = EXCLUDED.last_message_at,
        last_message_preview = EXCLUDED.last_message_preview,
        unread_count         = EXCLUDED.unread_count,
        has_risk             = false;
    `;
  });

  test('textarea enabled inside window, send button works, outbound bubble appears after seeding', async ({
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
      hasText: REPLY_PATIENT.name,
    });
    await expect(conversationRow).toBeVisible({ timeout: 10000 });
    await conversationRow.click();

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

    // Wait for thread
    const messageLog = main.getByLabel('Histórico de mensagens');
    await expect(messageLog).toBeVisible({ timeout: 10000 });

    // Verify Textarea is enabled (inside 24h window — not readonly)
    const textarea = main.getByPlaceholder('Escreva uma mensagem...');
    await expect(textarea).toBeVisible();
    await expect(textarea).not.toHaveAttribute('readonly');

    // Verify the "A janela de 24h expirou" info alert is NOT visible
    await expect(main.getByText('A janela de 24h expirou')).not.toBeVisible();

    // Type the reply
    await textarea.fill('Confirmo seu horario de amanha');

    // Verify Send button is enabled
    const sendButton = main.getByRole('button', { name: 'Enviar mensagem' });
    await expect(sendButton).toBeEnabled();

    // Simulate the send result: seed an outbound message directly via DB
    await db.sql`
      INSERT INTO public.whatsapp_messages (id, user_id, patient_id, direction, to_phone, body, status, sent_at, created_at)
      VALUES (
        ${OUTBOUND_MSG_ID}, ${userId}, ${REPLY_PATIENT.id}, 'outbound',
        ${REPLY_PATIENT.phone}, 'Confirmo seu horario de amanha', 'sent', now(), now()
      )
      ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, status = EXCLUDED.status, created_at = EXCLUDED.created_at;
    `;

    // Reload the page to see the new message
    const cacheBust2 = Date.now();
    await page.goto(`/caixa-de-entrada?_=${cacheBust2}`);
    await expect(page.getByTestId('inbox-page-title')).toBeVisible({ timeout: 15000 });

    // Click on the conversation again
    const conversationRow2 = page.locator('[role="button"]').filter({
      hasText: REPLY_PATIENT.name,
    });
    await expect(conversationRow2).toBeVisible({ timeout: 10000 });
    await conversationRow2.click();

    // Wait for thread (re-scope to main)
    const main2 = page.locator('main');
    const messageLog2 = main2.getByLabel('Histórico de mensagens');
    await expect(messageLog2).toBeVisible({ timeout: 10000 });

    // Verify the new outbound bubble appears
    const newBubble = messageLog2.getByText('Confirmo seu horario de amanha');
    await expect(newBubble).toBeVisible({ timeout: 10000 });

    // Verify it is right-aligned (outbound)
    const outboundContainer = messageLog2
      .locator('.justify-end')
      .filter({ hasText: 'Confirmo seu horario de amanha' });
    await expect(outboundContainer).toBeVisible();

    // Verify outbound bubble has bg-brand-100
    await expect(outboundContainer.locator('.bg-brand-100')).toBeVisible();

    // Verify the status icon for 'sent' (Check icon with aria-label "Enviado")
    await expect(outboundContainer.locator('[aria-label="Enviado"]')).toBeVisible();
  });
});
