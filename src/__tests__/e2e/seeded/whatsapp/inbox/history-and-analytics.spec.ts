import { test, expect } from '@/__tests__/e2e/seeded/setup/db-fixture';
import {
  readSeedState,
  SEED_PATIENTS,
  STORAGE_STATE_PATH,
} from '@/__tests__/e2e/seeded/setup/seed-state';

/**
 * @whatsapp-inbox -- History and analytics dashboard E2E test.
 *
 * Flow:
 *   1. Pre-seed: whatsapp_account and multiple outbound messages with various
 *      statuses (sent, delivered, read, failed) within the current month.
 *   2. Navigate to /configuracoes/lembretes/historico.
 *   3. Verify the page title "Historico de Lembretes".
 *   4. Verify summary cards are visible and show non-zero values.
 *   5. Change the period filter to "Mês anterior".
 *   6. Verify the "sent" card updates (should show 0 since all messages
 *      are current-month only).
 *   7. Switch back to "Mês corrente" to verify cards restore.
 *
 * Prerequisites:
 *   - storageState provides an authenticated psychologist.
 *   - WhatsApp account + messages seeded in beforeEach.
 */

const WA_ACCOUNT_ID = '00000000-0000-4000-8000-000000000140';

// Deterministic UUIDs for messages — unique to this test
const MSG_IDS = {
  sent1: '00000000-0000-4000-8000-000000000141',
  delivered1: '00000000-0000-4000-8000-000000000142',
  read1: '00000000-0000-4000-8000-000000000143',
  failed1: '00000000-0000-4000-8000-000000000144',
} as const;

test.describe('@whatsapp-inbox history and analytics dashboard', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async ({ db }) => {
    const seed = await readSeedState();
    const userId = seed.userId;

    // Clean this test's specific rows by ID
    const msgIds = Object.values(MSG_IDS);
    await db.sql`DELETE FROM public.whatsapp_messages WHERE id = ANY(${msgIds})`;

    // Upsert whatsapp_account (shared)
    await db.sql`
      INSERT INTO public.whatsapp_accounts (id, user_id, provider, account_id, phone_number, display_name, status, consent_given_at)
      VALUES (${WA_ACCOUNT_ID}, ${userId}, 'twilio', 'MG00000000000000000000000000000000',
        '+5511987654321', 'Dra. Teste', 'active', now())
      ON CONFLICT (user_id) DO UPDATE SET status = 'active';
    `;

    // Insert 4 outbound messages with distinct statuses, all within the
    // current month. We insert one at a time to ensure reliability.
    // Using `now() - interval '1 hour'` (guaranteed within current month).
    await db.sql`
      INSERT INTO public.whatsapp_messages (id, user_id, patient_id, direction, to_phone, body, template_key, status, sent_at, delivered_at, read_at, created_at)
      VALUES (${MSG_IDS.sent1}, ${userId}, ${SEED_PATIENTS.activeWithPhone.id}, 'outbound',
        '+55 11 99999-0001', 'Lembrete enviado', 'lembrete_24h', 'sent',
        now() - interval '3 hours', NULL, NULL, now() - interval '3 hours')
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, created_at = EXCLUDED.created_at;
    `;

    await db.sql`
      INSERT INTO public.whatsapp_messages (id, user_id, patient_id, direction, to_phone, body, template_key, status, sent_at, delivered_at, read_at, created_at)
      VALUES (${MSG_IDS.delivered1}, ${userId}, ${SEED_PATIENTS.activeWithPhone.id}, 'outbound',
        '+55 11 99999-0001', 'Lembrete entregue', 'lembrete_2h', 'delivered',
        now() - interval '4 hours', now() - interval '4 hours', NULL, now() - interval '4 hours')
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, created_at = EXCLUDED.created_at;
    `;

    await db.sql`
      INSERT INTO public.whatsapp_messages (id, user_id, patient_id, direction, to_phone, body, template_key, status, sent_at, delivered_at, read_at, created_at)
      VALUES (${MSG_IDS.read1}, ${userId}, ${SEED_PATIENTS.activeWithPhone.id}, 'outbound',
        '+55 11 99999-0001', 'Confirmacao lida', 'confirmacao_recebida', 'read',
        now() - interval '5 hours', now() - interval '5 hours', now() - interval '5 hours', now() - interval '5 hours')
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, created_at = EXCLUDED.created_at;
    `;

    await db.sql`
      INSERT INTO public.whatsapp_messages (id, user_id, patient_id, direction, to_phone, body, status, created_at)
      VALUES (${MSG_IDS.failed1}, ${userId}, ${SEED_PATIENTS.activeWithPhone.id}, 'outbound',
        '+55 11 99999-0001', 'Mensagem falhou', 'failed', now() - interval '2 hours')
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, created_at = EXCLUDED.created_at;
    `;
  });

  test('shows summary cards and updates when period changes', async ({ page }) => {
    const cacheBust = Date.now();
    await page.goto(`/configuracoes/lembretes/historico?_=${cacheBust}`);

    // Verify page title
    await expect(page.getByTestId('historico-page-title')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('historico-page-title')).toHaveText('Historico de Lembretes');

    // Verify the analytics dashboard loads
    await expect(page.getByTestId('analytics-dashboard')).toBeVisible({ timeout: 10000 });

    // Verify all summary cards are visible
    const sentCard = page.getByTestId('analytics-card-sent');
    await expect(sentCard).toBeVisible();
    const deliveryCard = page.getByTestId('analytics-card-delivery');
    await expect(deliveryCard).toBeVisible();
    const readCard = page.getByTestId('analytics-card-read');
    await expect(readCard).toBeVisible();
    const costCard = page.getByTestId('analytics-card-cost');
    await expect(costCard).toBeVisible();

    // Verify the sent card shows a non-zero value (at least our 4 seeded
    // messages; may be higher if other tests seeded outbound messages).
    const sentCardText = await sentCard.textContent();
    const sentCountMatch = sentCardText?.match(/(\d+)/);
    const initialSentCount = sentCountMatch ? parseInt(sentCountMatch[1]!, 10) : 0;
    expect(initialSentCount).toBeGreaterThanOrEqual(4);

    // Change period to "Mês anterior"
    const periodSelect = page.getByTestId('analytics-period-select');
    await periodSelect.click();
    await page.getByRole('option', { name: 'Mês anterior' }).click();

    // Wait for the sent card to update — "Mês anterior" should show 0
    // since all our seeded messages are within the current month.
    await expect(sentCard).toContainText('0', { timeout: 10000 });

    // Change back to "Mês corrente" and verify the count is >= 4 again
    await periodSelect.click();
    await page.getByRole('option', { name: 'Mês corrente' }).click();

    // Wait for the card to reload with a non-zero value
    await expect(async () => {
      const text = await sentCard.textContent();
      const match = text?.match(/(\d+)/);
      const count = match ? parseInt(match[1]!, 10) : 0;
      expect(count).toBeGreaterThanOrEqual(4);
    }).toPass({ timeout: 10000 });
  });
});
