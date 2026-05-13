import { test, expect } from '@/__tests__/e2e/seeded/setup/db-fixture';
import { readSeedState, STORAGE_STATE_PATH } from '@/__tests__/e2e/seeded/setup/seed-state';

/**
 * @whatsapp-inbox -- Inbox list and conversation thread E2E test.
 *
 * Flow:
 *   1. Pre-seed: whatsapp_account, 3 unique patients with conversations
 *      and inbound messages.
 *   2. Navigate to /caixa-de-entrada.
 *   3. Verify the list shows the 3 seeded conversations with patient name,
 *      preview, and timestamp.
 *   4. Click the first conversation (most recent).
 *   5. Verify the thread displays messages chronologically.
 *   6. Verify inbound bubbles (left, bg surface-muted) and outbound bubbles
 *      (right, bg brand-100).
 *
 * Uses unique patient IDs (not shared with other inbox tests) to avoid
 * parallel test interference on the whatsapp_conversations unique constraint.
 *
 * Prerequisites:
 *   - storageState provides an authenticated psychologist.
 */

// Deterministic UUIDs — unique to this test file
const WA_ACCOUNT_ID = '00000000-0000-4000-8000-000000000070';

const PATIENTS = {
  alice: {
    id: '00000000-0000-4000-8000-000000001001',
    name: 'Alice Ferreira',
    phone: '+55 11 99999-1001',
  },
  bruno: {
    id: '00000000-0000-4000-8000-000000001002',
    name: 'Bruno Costa',
    phone: '+55 11 99999-1002',
  },
  camila: {
    id: '00000000-0000-4000-8000-000000001003',
    name: 'Camila Rocha',
    phone: '+55 11 99999-1003',
  },
} as const;

const MSG_IDS = {
  alice_inbound1: '00000000-0000-4000-8000-000000001011',
  alice_outbound1: '00000000-0000-4000-8000-000000001012',
  alice_inbound2: '00000000-0000-4000-8000-000000001013',
  bruno_inbound1: '00000000-0000-4000-8000-000000001014',
  bruno_inbound2: '00000000-0000-4000-8000-000000001015',
  camila_inbound1: '00000000-0000-4000-8000-000000001016',
} as const;

const CONV_IDS = {
  alice: '00000000-0000-4000-8000-000000001021',
  bruno: '00000000-0000-4000-8000-000000001022',
  camila: '00000000-0000-4000-8000-000000001023',
} as const;

test.describe('@whatsapp-inbox inbox list and conversation thread', () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(async ({ db }) => {
    const seed = await readSeedState();
    const userId = seed.userId;

    // Clean this test's specific rows by ID
    const convIds = Object.values(CONV_IDS);
    const msgIds = Object.values(MSG_IDS);
    await db.sql`DELETE FROM public.whatsapp_conversations WHERE id = ANY(${convIds})`;
    await db.sql`DELETE FROM public.whatsapp_messages WHERE id = ANY(${msgIds})`;

    // Upsert unique patients for this test
    for (const p of Object.values(PATIENTS)) {
      await db.sql`
        INSERT INTO public.patients (id, user_id, full_name, patient_type, phone, tags, status)
        VALUES (${p.id}, ${userId}, ${p.name}, 'individual', ${p.phone}, '{}'::text[], 'active')
        ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, status = 'active';
      `;
    }

    // Upsert whatsapp_account (shared)
    await db.sql`
      INSERT INTO public.whatsapp_accounts (id, user_id, provider, account_id, phone_number, display_name, status, consent_given_at)
      VALUES (${WA_ACCOUNT_ID}, ${userId}, 'twilio', 'MG00000000000000000000000000000000',
        '+5511987654321', 'Dra. Teste', 'active', now())
      ON CONFLICT (user_id) DO UPDATE SET status = 'active';
    `;

    // Seed messages for Alice (2 inbound + 1 outbound)
    await db.sql`
      INSERT INTO public.whatsapp_messages (id, user_id, patient_id, direction, from_phone, to_phone, body, status, created_at)
      VALUES
        (${MSG_IDS.alice_inbound1}, ${userId}, ${PATIENTS.alice.id}, 'inbound',
         ${PATIENTS.alice.phone}, '+5511987654321', 'Ola doutora, bom dia!', 'delivered',
         now() - interval '30 minutes'),
        (${MSG_IDS.alice_outbound1}, ${userId}, ${PATIENTS.alice.id}, 'outbound',
         '+5511987654321', ${PATIENTS.alice.phone}, 'Bom dia, Alice! Como voce esta?', 'sent',
         now() - interval '25 minutes'),
        (${MSG_IDS.alice_inbound2}, ${userId}, ${PATIENTS.alice.id}, 'inbound',
         ${PATIENTS.alice.phone}, '+5511987654321', 'Estou bem, obrigada por perguntar!', 'delivered',
         now() - interval '20 minutes')
      ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, status = EXCLUDED.status, created_at = EXCLUDED.created_at;
    `;

    // Seed messages for Bruno (2 inbound)
    await db.sql`
      INSERT INTO public.whatsapp_messages (id, user_id, patient_id, direction, from_phone, to_phone, body, status, created_at)
      VALUES
        (${MSG_IDS.bruno_inbound1}, ${userId}, ${PATIENTS.bruno.id}, 'inbound',
         ${PATIENTS.bruno.phone}, '+5511987654321', 'Preciso remarcar minha sessao', 'delivered',
         now() - interval '2 hours'),
        (${MSG_IDS.bruno_inbound2}, ${userId}, ${PATIENTS.bruno.id}, 'inbound',
         ${PATIENTS.bruno.phone}, '+5511987654321', 'Pode ser na quinta?', 'delivered',
         now() - interval '1 hour')
      ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, status = EXCLUDED.status, created_at = EXCLUDED.created_at;
    `;

    // Seed messages for Camila (1 inbound)
    await db.sql`
      INSERT INTO public.whatsapp_messages (id, user_id, patient_id, direction, from_phone, to_phone, body, status, created_at)
      VALUES
        (${MSG_IDS.camila_inbound1}, ${userId}, ${PATIENTS.camila.id}, 'inbound',
         ${PATIENTS.camila.phone}, '+5511987654321', 'Boa tarde, gostaria de agendar', 'delivered',
         now() - interval '3 hours')
      ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, status = EXCLUDED.status, created_at = EXCLUDED.created_at;
    `;

    // Seed conversations
    await db.sql`
      INSERT INTO public.whatsapp_conversations (id, user_id, patient_id, last_message_id, last_message_at, last_message_preview, unread_count, has_risk)
      VALUES
        (${CONV_IDS.alice}, ${userId}, ${PATIENTS.alice.id},
         ${MSG_IDS.alice_inbound2}, now() - interval '20 minutes',
         'Estou bem, obrigada por perguntar!', 1, false),
        (${CONV_IDS.bruno}, ${userId}, ${PATIENTS.bruno.id},
         ${MSG_IDS.bruno_inbound2}, now() - interval '1 hour',
         'Pode ser na quinta?', 2, false),
        (${CONV_IDS.camila}, ${userId}, ${PATIENTS.camila.id},
         ${MSG_IDS.camila_inbound1}, now() - interval '3 hours',
         'Boa tarde, gostaria de agendar', 1, false)
      ON CONFLICT (user_id, patient_id) DO UPDATE SET
        last_message_id      = EXCLUDED.last_message_id,
        last_message_at      = EXCLUDED.last_message_at,
        last_message_preview = EXCLUDED.last_message_preview,
        unread_count         = EXCLUDED.unread_count,
        has_risk             = EXCLUDED.has_risk;
    `;
  });

  test('shows 3 conversations, click first opens thread with chronological bubbles', async ({
    page,
  }) => {
    const cacheBust = Date.now();
    await page.goto(`/caixa-de-entrada?_=${cacheBust}`);

    // Verify page title
    await expect(page.getByTestId('inbox-page-title')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('inbox-page-title')).toHaveText('Caixa de entrada');

    // Verify the 3 seeded conversations are visible
    await expect(page.getByText('Alice Ferreira')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Bruno Costa')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Camila Rocha')).toBeVisible({ timeout: 10000 });

    // Verify previews are visible
    await expect(page.getByText('Estou bem, obrigada por perguntar!')).toBeVisible();
    await expect(page.getByText('Pode ser na quinta?')).toBeVisible();
    await expect(page.getByText('Boa tarde, gostaria de agendar')).toBeVisible();

    // Click on Alice's conversation (most recent)
    const aliceRow = page.locator('[role="button"]').filter({
      hasText: 'Alice Ferreira',
    });
    await aliceRow.click();

    // Wait for the thread to load (desktop panel inside <main>)
    const messageLog = page.locator('main').getByLabel('Historico de mensagens');
    await expect(messageLog).toBeVisible({ timeout: 10000 });

    // Verify thread header shows patient name
    await expect(page.locator('main h3').filter({ hasText: 'Alice Ferreira' })).toBeVisible();

    // Verify messages appear in the thread
    await expect(messageLog.getByText('Ola doutora, bom dia!')).toBeVisible();
    await expect(messageLog.getByText('Bom dia, Alice! Como voce esta?')).toBeVisible();
    await expect(messageLog.getByText('Estou bem, obrigada por perguntar!')).toBeVisible();

    // Verify inbound messages are aligned left (justify-start)
    const inboundBubble = messageLog
      .locator('.justify-start')
      .filter({ hasText: 'Ola doutora, bom dia!' });
    await expect(inboundBubble).toBeVisible();

    // Verify inbound bubble has bg-surface-muted class
    const inboundInner = inboundBubble.locator('.bg-surface-muted');
    await expect(inboundInner).toBeVisible();

    // Verify outbound messages are aligned right (justify-end)
    const outboundBubble = messageLog
      .locator('.justify-end')
      .filter({ hasText: 'Bom dia, Alice! Como voce esta?' });
    await expect(outboundBubble).toBeVisible();

    // Verify outbound bubble has bg-brand-100 class
    const outboundInner = outboundBubble.locator('.bg-brand-100');
    await expect(outboundInner).toBeVisible();

    // Verify chronological order: inbound1 < outbound1 < inbound2
    const allBubbles = messageLog.locator('.rounded-lg.px-3.py-2');
    const firstBubbleText = await allBubbles.first().textContent();
    expect(firstBubbleText).toContain('Ola doutora, bom dia!');

    const lastBubbleText = await allBubbles.last().textContent();
    expect(lastBubbleText).toContain('Estou bem, obrigada por perguntar!');
  });
});
