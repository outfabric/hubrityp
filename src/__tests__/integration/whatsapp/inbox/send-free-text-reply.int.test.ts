import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import type { SendFreeTextResult } from '@/modules/whatsapp/server/adapters/twilio-bsp';
import type { SendFreeTextReplyDeps } from '@/modules/whatsapp/server/inbox/send-free-text-reply';
import { patients } from '@/shared/db/schema/patients/tables';
import { whatsappConversations, whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedPatient(
  userId: string,
  patientId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Paciente Teste',
      phone: '+5511988887777',
      ...overrides,
    });
  });
}

/** Seed an inbound message at a specific time. */
async function seedInboundMessage(
  userId: string,
  patientId: string,
  createdAt: Date,
): Promise<string> {
  const messageId = randomUUID();
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO whatsapp_messages (id, user_id, patient_id, direction, body, status, created_at)
           VALUES (${messageId}, ${userId}, ${patientId}, 'inbound', 'Mensagem do paciente', 'delivered', ${createdAt.toISOString()}::timestamptz)`,
    );
  });
  return messageId;
}

function fakeSupabase(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}

function mockSendFreeTextSuccess(bspMessageId = 'SM_mock_free_text_001'): SendFreeTextReplyDeps {
  return {
    sendFreeText: vi.fn().mockResolvedValue({
      ok: true,
      data: { bspMessageId, status: 'queued' },
    } satisfies SendFreeTextResult),
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(whatsappConversations);
    await db.delete(whatsappMessages);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendFreeTextReplyImpl — within 24h window', () => {
  it('sends message successfully and persists as outbound', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Inbound message 2 hours ago
    await seedInboundMessage(userId, patientId, new Date(Date.now() - 2 * 60 * 60 * 1000));

    const { sendFreeTextReplyImpl } =
      await import('@/modules/whatsapp/server/inbox/send-free-text-reply');

    const deps = mockSendFreeTextSuccess('SM_test_001');

    const result = await sendFreeTextReplyImpl(
      fakeSupabase(userId),
      patientId,
      { body: 'Confirmo seu horario de amanha as 14h' },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.direction).toBe('outbound');
    expect(result.message.templateKey).toBeNull();
    expect(result.message.body).toBe('Confirmo seu horario de amanha as 14h');
    expect(result.message.bspMessageId).toBe('SM_test_001');
    expect(result.message.status).toBe('sent');
    expect(result.message.userId).toBe(userId);
    expect(result.message.patientId).toBe(patientId);

    // Verify adapter was called with correct params
    expect(deps.sendFreeText).toHaveBeenCalledOnce();
    const callArgs = (deps.sendFreeText as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      to: string;
      body: string;
    };
    expect(callArgs.to).toBe('+5511988887777');
    expect(callArgs.body).toBe('Confirmo seu horario de amanha as 14h');

    // Verify message is persisted in DB
    const messages = await runAsService(async (db) => {
      return db
        .select()
        .from(whatsappMessages)
        .where(
          and(eq(whatsappMessages.userId, userId), eq(whatsappMessages.direction, 'outbound')),
        );
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toBe('Confirmo seu horario de amanha as 14h');
  });
});

describe('sendFreeTextReplyImpl — outside 24h window', () => {
  it('rejects send when last inbound message is >24h old', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Inbound message 25 hours ago
    await seedInboundMessage(userId, patientId, new Date(Date.now() - 25 * 60 * 60 * 1000));

    const { sendFreeTextReplyImpl } =
      await import('@/modules/whatsapp/server/inbox/send-free-text-reply');

    const deps = mockSendFreeTextSuccess();

    const result = await sendFreeTextReplyImpl(
      fakeSupabase(userId),
      patientId,
      { body: 'Mensagem fora da janela' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('window_expired');

    // Verify adapter was NOT called
    expect(deps.sendFreeText).not.toHaveBeenCalled();
  });

  it('rejects send when no inbound messages exist', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const { sendFreeTextReplyImpl } =
      await import('@/modules/whatsapp/server/inbox/send-free-text-reply');

    const deps = mockSendFreeTextSuccess();

    const result = await sendFreeTextReplyImpl(
      fakeSupabase(userId),
      patientId,
      { body: 'Mensagem sem inbound' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('window_expired');
  });
});

describe('sendFreeTextReplyImpl — clinical content blocked', () => {
  it('rejects when clinical content is detected', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedInboundMessage(userId, patientId, new Date());

    const { sendFreeTextReplyImpl } =
      await import('@/modules/whatsapp/server/inbox/send-free-text-reply');

    const deps = mockSendFreeTextSuccess();

    const result = await sendFreeTextReplyImpl(
      fakeSupabase(userId),
      patientId,
      { body: 'A paciente apresenta transtorno de ansiedade generalizada' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('clinical_content_blocked');

    // Verify adapter was NOT called
    expect(deps.sendFreeText).not.toHaveBeenCalled();
  });

  it('rejects when CID-10 code is detected', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedInboundMessage(userId, patientId, new Date());

    const { sendFreeTextReplyImpl } =
      await import('@/modules/whatsapp/server/inbox/send-free-text-reply');

    const deps = mockSendFreeTextSuccess();

    const result = await sendFreeTextReplyImpl(
      fakeSupabase(userId),
      patientId,
      { body: 'Paciente com codigo F41.1 diagnosticado' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('clinical_content_blocked');
  });
});

describe('sendFreeTextReplyImpl — adapter call verification', () => {
  it('passes correct parameters to sendFreeText adapter', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, { phone: '+5521999991111' });
    await seedInboundMessage(userId, patientId, new Date());

    const { sendFreeTextReplyImpl } =
      await import('@/modules/whatsapp/server/inbox/send-free-text-reply');

    const deps = mockSendFreeTextSuccess('SM_verify_params');

    await sendFreeTextReplyImpl(
      fakeSupabase(userId),
      patientId,
      { body: 'Mensagem de teste para verificar parametros' },
      deps,
    );

    expect(deps.sendFreeText).toHaveBeenCalledOnce();
    expect(deps.sendFreeText).toHaveBeenCalledWith({
      to: '+5521999991111',
      body: 'Mensagem de teste para verificar parametros',
    });
  });
});
