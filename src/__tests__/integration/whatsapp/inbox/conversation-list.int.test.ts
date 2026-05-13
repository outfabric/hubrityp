import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { runAsUser } from '@/__tests__/integration/setup/run-as-user';
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

/** Seed a message and its conversation aggregate for a (user, patient) pair. */
async function seedConversation(
  userId: string,
  patientId: string,
  overrides: {
    unreadCount?: number;
    hasRisk?: boolean;
    lastMessageAt?: Date;
    preview?: string;
  } = {},
): Promise<string> {
  const messageId = randomUUID();
  const now = overrides.lastMessageAt ?? new Date();
  const preview = overrides.preview ?? 'Olá, como vai?';

  await runAsService(async (db) => {
    // Insert a message row (required by FK on whatsapp_conversations.last_message_id)
    await db.insert(whatsappMessages).values({
      id: messageId,
      userId,
      patientId,
      direction: 'inbound',
      body: preview,
      status: 'delivered',
    });

    await db.insert(whatsappConversations).values({
      userId,
      patientId,
      lastMessageId: messageId,
      lastMessageAt: now,
      lastMessagePreview: preview.slice(0, 80),
      unreadCount: overrides.unreadCount ?? 0,
      hasRisk: overrides.hasRisk ?? false,
    });
  });

  return messageId;
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

describe('listConversations — pagination', () => {
  it('page 1 returns 50 items and page 2 returns remaining 10 when 60 conversations exist', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // Seed 60 patients + conversations with staggered timestamps
    for (let i = 0; i < 60; i++) {
      const patientId = randomUUID();
      await seedPatient(userId, patientId, { fullName: `Paciente ${String(i).padStart(3, '0')}` });
      await seedConversation(userId, patientId, {
        lastMessageAt: new Date(Date.now() - i * 60_000), // each 1 minute apart
      });
    }

    const { listConversationsImpl } =
      await import('@/modules/whatsapp/server/inbox/list-conversations');

    const fakeSupabase = {
      auth: {
        // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation
        getUser: async () => ({ data: { user: { id: userId } }, error: null }),
      },
    } as Parameters<typeof listConversationsImpl>[0];

    // Page 1
    const page1 = await listConversationsImpl(fakeSupabase, { page: 1 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.conversations).toHaveLength(50);
    expect(page1.total).toBe(60);
    expect(page1.page).toBe(1);

    // Page 2
    const page2 = await listConversationsImpl(fakeSupabase, { page: 2 });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.conversations).toHaveLength(10);
    expect(page2.total).toBe(60);
    expect(page2.page).toBe(2);
  });

  it('returns conversations ordered by last_message_at DESC', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const now = Date.now();
    const patientIds = [randomUUID(), randomUUID(), randomUUID()];

    for (let i = 0; i < 3; i++) {
      await seedPatient(userId, patientIds[i]!, { fullName: `Paciente ${i}` });
      await seedConversation(userId, patientIds[i]!, {
        lastMessageAt: new Date(now - i * 3_600_000), // 0h, 1h, 2h ago
      });
    }

    const { listConversationsImpl } =
      await import('@/modules/whatsapp/server/inbox/list-conversations');

    const fakeSupabase = {
      auth: {
        // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation
        getUser: async () => ({ data: { user: { id: userId } }, error: null }),
      },
    } as Parameters<typeof listConversationsImpl>[0];

    const result = await listConversationsImpl(fakeSupabase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Should be ordered newest first
    for (let i = 1; i < result.conversations.length; i++) {
      expect(result.conversations[i - 1]!.lastMessageAt.getTime()).toBeGreaterThanOrEqual(
        result.conversations[i]!.lastMessageAt.getTime(),
      );
    }
  });
});

describe('listConversations — filters', () => {
  it('only_unread filter returns conversations with unread_count > 0', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const readPatient = randomUUID();
    const unreadPatient = randomUUID();

    await seedPatient(userId, readPatient, { fullName: 'Lido' });
    await seedPatient(userId, unreadPatient, { fullName: 'Nao Lido' });

    await seedConversation(userId, readPatient, { unreadCount: 0 });
    await seedConversation(userId, unreadPatient, { unreadCount: 3 });

    const { listConversationsImpl } =
      await import('@/modules/whatsapp/server/inbox/list-conversations');

    const fakeSupabase = {
      auth: {
        // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation
        getUser: async () => ({ data: { user: { id: userId } }, error: null }),
      },
    } as Parameters<typeof listConversationsImpl>[0];

    const result = await listConversationsImpl(fakeSupabase, { onlyUnread: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]!.patientId).toBe(unreadPatient);
    expect(result.conversations[0]!.unreadCount).toBe(3);
  });

  it('only_risk filter returns conversations with has_risk=true', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const normalPatient = randomUUID();
    const riskPatient = randomUUID();

    await seedPatient(userId, normalPatient, { fullName: 'Normal' });
    await seedPatient(userId, riskPatient, { fullName: 'Risco' });

    await seedConversation(userId, normalPatient, { hasRisk: false });
    await seedConversation(userId, riskPatient, { hasRisk: true });

    const { listConversationsImpl } =
      await import('@/modules/whatsapp/server/inbox/list-conversations');

    const fakeSupabase = {
      auth: {
        // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation
        getUser: async () => ({ data: { user: { id: userId } }, error: null }),
      },
    } as Parameters<typeof listConversationsImpl>[0];

    const result = await listConversationsImpl(fakeSupabase, { onlyRisk: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]!.patientId).toBe(riskPatient);
    expect(result.conversations[0]!.hasRisk).toBe(true);
  });

  it('search by patient name returns matching conversations', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const marinaId = randomUUID();
    const joaoId = randomUUID();

    await seedPatient(userId, marinaId, { fullName: 'Marina Silva' });
    await seedPatient(userId, joaoId, { fullName: 'Joao Santos' });

    await seedConversation(userId, marinaId);
    await seedConversation(userId, joaoId);

    const { listConversationsImpl } =
      await import('@/modules/whatsapp/server/inbox/list-conversations');

    const fakeSupabase = {
      auth: {
        // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation
        getUser: async () => ({ data: { user: { id: userId } }, error: null }),
      },
    } as Parameters<typeof listConversationsImpl>[0];

    const result = await listConversationsImpl(fakeSupabase, { search: 'Marina' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]!.patientName).toBe('Marina Silva');
  });
});

describe('listConversations — RLS cross-user isolation', () => {
  it('psychologist A cannot see conversations of psychologist B', async () => {
    const userIdA = randomUUID();
    const userIdB = randomUUID();
    await seedAuthUser(userIdA);
    await seedAuthUser(userIdB);

    const patientA = randomUUID();
    const patientB = randomUUID();

    await seedPatient(userIdA, patientA, { fullName: 'Paciente A' });
    await seedPatient(userIdB, patientB, { fullName: 'Paciente B' });

    await seedConversation(userIdA, patientA);
    await seedConversation(userIdB, patientB);

    // Verify at DB level with RLS: user A can only see their own conversations
    const rowsA = await runAsUser(userIdA, async (db) => {
      return db.select().from(whatsappConversations);
    });

    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]!.userId).toBe(userIdA);

    // User B can only see their own
    const rowsB = await runAsUser(userIdB, async (db) => {
      return db.select().from(whatsappConversations);
    });

    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]!.userId).toBe(userIdB);
  });
});
