import { test, expect } from '@/__tests__/e2e/seeded/setup/db-fixture';
import { readSeedState, STORAGE_STATE_PATH } from '@/__tests__/e2e/seeded/setup/seed-state';

/**
 * @whatsapp-inbox -- Risk alert flow E2E test.
 *
 * Flow:
 *   1. Pre-seed: whatsapp_account, a unique patient, an inbound message with
 *      keyword "me matar" (risk_flag=true, risk_keywords populated), and a
 *      whatsapp_conversation with has_risk=true.
 *   2. Navigate to /caixa-de-entrada.
 *   3. Verify the AlertTriangle icon is visible next to the patient name in
 *      the conversation list.
 *   4. Click on the conversation.
 *   5. Verify the danger banner is shown at the top of the thread.
 *
 * Uses a unique patient ID to avoid collision with other parallel inbox tests.
 *
 * Prerequisites:
 *   - storageState provides an authenticated psychologist.
 */

const WA_ACCOUNT_ID = '00000000-0000-4000-8000-000000000100';
const RISK_PATIENT = {
  id: '00000000-0000-4000-8000-000000001100',
  name: 'Diana Risco',
  phone: '+55 11 99999-1100',
} as const;
const RISK_MSG_ID = '00000000-0000-4000-8000-000000000101';
const RISK_CONV_ID = '00000000-0000-4000-8000-000000000102';

test.describe('@whatsapp-inbox risk alert flow', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async ({ db }) => {
    const seed = await readSeedState();
    const userId = seed.userId;

    // Clean this test's specific rows by ID
    await db.sql`DELETE FROM public.whatsapp_conversations WHERE id = ${RISK_CONV_ID}`;
    await db.sql`DELETE FROM public.whatsapp_messages WHERE id = ${RISK_MSG_ID}`;

    // Upsert unique patient for this test
    await db.sql`
      INSERT INTO public.patients (id, user_id, full_name, patient_type, phone, tags, status)
      VALUES (${RISK_PATIENT.id}, ${userId}, ${RISK_PATIENT.name}, 'individual', ${RISK_PATIENT.phone}, '{}'::text[], 'active')
      ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, status = 'active';
    `;

    // Upsert whatsapp_account (shared)
    await db.sql`
      INSERT INTO public.whatsapp_accounts (id, user_id, provider, account_id, phone_number, display_name, status, consent_given_at)
      VALUES (${WA_ACCOUNT_ID}, ${userId}, 'twilio', 'MG00000000000000000000000000000000',
        '+5511987654321', 'Dra. Teste', 'active', now())
      ON CONFLICT (user_id) DO UPDATE SET status = 'active';
    `;

    // Insert risk-flagged inbound message
    await db.sql`
      INSERT INTO public.whatsapp_messages (id, user_id, patient_id, direction, from_phone, to_phone, body, status, risk_flag, risk_keywords, created_at)
      VALUES (
        ${RISK_MSG_ID}, ${userId}, ${RISK_PATIENT.id}, 'inbound',
        ${RISK_PATIENT.phone}, '+5511987654321',
        'Eu nao aguento mais, quero me matar',
        'delivered', true, '["me matar"]'::jsonb, now() - interval '10 minutes'
      )
      ON CONFLICT (id) DO UPDATE SET
        body         = EXCLUDED.body,
        status       = EXCLUDED.status,
        risk_flag    = EXCLUDED.risk_flag,
        risk_keywords = EXCLUDED.risk_keywords,
        created_at   = EXCLUDED.created_at;
    `;

    // Insert conversation with has_risk=true
    await db.sql`
      INSERT INTO public.whatsapp_conversations (id, user_id, patient_id, last_message_id, last_message_at, last_message_preview, unread_count, has_risk)
      VALUES (
        ${RISK_CONV_ID}, ${userId}, ${RISK_PATIENT.id},
        ${RISK_MSG_ID}, now() - interval '10 minutes',
        'Eu nao aguento mais, quero me matar', 1, true
      )
      ON CONFLICT (user_id, patient_id) DO UPDATE SET
        last_message_id      = EXCLUDED.last_message_id,
        last_message_at      = EXCLUDED.last_message_at,
        last_message_preview = EXCLUDED.last_message_preview,
        unread_count         = EXCLUDED.unread_count,
        has_risk             = true;
    `;
  });

  test('shows AlertTriangle in list and danger banner in thread for risk conversation', async ({
    page,
  }) => {
    const cacheBust = Date.now();
    await page.goto(`/caixa-de-entrada?_=${cacheBust}`);

    // Wait for the inbox page
    await expect(page.getByTestId('inbox-page-title')).toBeVisible({ timeout: 15000 });

    // Verify conversation with the risk patient is visible
    await expect(page.getByText(RISK_PATIENT.name)).toBeVisible({ timeout: 10000 });

    // Verify AlertTriangle icon is visible next to the patient name
    const riskIcon = page.locator('[aria-label="Conteúdo de risco"]');
    await expect(riskIcon.first()).toBeVisible({ timeout: 5000 });

    // Click on the conversation
    const conversationRow = page.locator('[role="button"]').filter({
      hasText: RISK_PATIENT.name,
    });
    await conversationRow.click();

    // Wait for thread — scope to <main>
    const messageLog = page.locator('main').getByLabel('Histórico de mensagens');
    await expect(messageLog).toBeVisible({ timeout: 10000 });

    // Verify the danger banner is visible in the thread
    const dangerBanner = page.locator('main [aria-live="assertive"]');
    await expect(dangerBanner).toBeVisible();
    await expect(dangerBanner).toContainText('conteúdo de risco');

    // Verify the risk-flagged message is visible in the thread
    const riskMessage = messageLog.getByText('Eu nao aguento mais, quero me matar');
    await expect(riskMessage).toBeVisible();

    // Verify the risk-flagged message bubble has danger border
    const riskBubble = riskMessage.locator('..');
    await expect(riskBubble).toHaveClass(/border-danger-500/);
  });
});
