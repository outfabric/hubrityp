import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql as dsql } from 'drizzle-orm';
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

/** Seed multiple messages for a conversation. */
async function seedMessages(userId: string, patientId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  await runAsService(async (db) => {
    for (let i = 0; i < count; i++) {
      const msgId = randomUUID();
      ids.push(msgId);
      await db.insert(whatsappMessages).values({
        id: msgId,
        userId,
        patientId,
        direction: i % 2 === 0 ? 'inbound' : 'outbound',
        body: `Mensagem ${i}`,
        status: 'delivered',
      });
    }
  });
  return ids;
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

describe('markConversationResolvedImpl — resolves messages', () => {
  it('sets resolved_at on all messages in the conversation', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedMessages(userId, patientId, 5);

    const { markConversationResolvedImpl } =
      await import('@/modules/whatsapp/server/inbox/mark-conversation-resolved');

    const result = await markConversationResolvedImpl(fakeSupabase(userId), patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolvedCount).toBe(5);

    // Verify all messages have resolved_at set
    const messages = await runAsService(async (db) => {
      return db
        .select({
          id: whatsappMessages.id,
          resolvedAt: whatsappMessages.resolvedAt,
        })
        .from(whatsappMessages)
        .where(and(eq(whatsappMessages.userId, userId), eq(whatsappMessages.patientId, patientId)));
    });

    expect(messages).toHaveLength(5);
    for (const msg of messages) {
      expect(msg.resolvedAt).not.toBeNull();
    }
  });

  it('does not double-resolve already resolved messages', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedMessages(userId, patientId, 3);

    const { markConversationResolvedImpl } =
      await import('@/modules/whatsapp/server/inbox/mark-conversation-resolved');

    // First resolve
    const result1 = await markConversationResolvedImpl(fakeSupabase(userId), patientId);
    expect(result1.ok).toBe(true);
    if (!result1.ok) return;
    expect(result1.resolvedCount).toBe(3);

    // Second resolve — should return 0 since all are already resolved
    const result2 = await markConversationResolvedImpl(fakeSupabase(userId), patientId);
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(result2.resolvedCount).toBe(0);
  });
});

describe('markConversationResolvedImpl — RLS cross-user isolation', () => {
  it('psychologist A cannot resolve messages of psychologist B', async () => {
    const userIdA = randomUUID();
    const userIdB = randomUUID();
    await seedAuthUser(userIdA);
    await seedAuthUser(userIdB);

    const patientB = randomUUID();
    await seedPatient(userIdB, patientB, { fullName: 'Paciente B' });

    await seedMessages(userIdB, patientB, 3);

    // Verify that user B's messages exist and are unresolved
    const beforeMessages = await runAsService(async (db) => {
      return db
        .select({
          id: whatsappMessages.id,
          resolvedAt: whatsappMessages.resolvedAt,
        })
        .from(whatsappMessages)
        .where(eq(whatsappMessages.userId, userIdB));
    });
    expect(beforeMessages).toHaveLength(3);
    for (const msg of beforeMessages) {
      expect(msg.resolvedAt).toBeNull();
    }

    // User A tries to resolve user B's conversation — should resolve 0
    const { markConversationResolvedImpl } =
      await import('@/modules/whatsapp/server/inbox/mark-conversation-resolved');

    const result = await markConversationResolvedImpl(fakeSupabase(userIdA), patientB);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolvedCount).toBe(0);

    // Verify user B's messages are still unresolved
    const afterMessages = await runAsService(async (db) => {
      return db
        .select({
          id: whatsappMessages.id,
          resolvedAt: whatsappMessages.resolvedAt,
        })
        .from(whatsappMessages)
        .where(eq(whatsappMessages.userId, userIdB));
    });
    for (const msg of afterMessages) {
      expect(msg.resolvedAt).toBeNull();
    }
  });

  it('RLS blocks cross-user UPDATE on whatsapp_messages', async () => {
    const userIdA = randomUUID();
    const userIdB = randomUUID();
    await seedAuthUser(userIdA);
    await seedAuthUser(userIdB);

    const patientB = randomUUID();
    await seedPatient(userIdB, patientB, { fullName: 'Paciente B' });

    await seedMessages(userIdB, patientB, 2);

    // User A tries to update user B's messages directly via RLS-enforced connection
    const result = await runAsUser(userIdA, async (db) => {
      return db
        .update(whatsappMessages)
        .set({ resolvedAt: dsql`now()` })
        .where(eq(whatsappMessages.patientId, patientB))
        .returning({ id: whatsappMessages.id });
    });

    // Should affect 0 rows because RLS blocks the update
    expect(result).toHaveLength(0);

    // Verify B's messages remain unresolved
    const messages = await runAsService(async (db) => {
      return db
        .select({ resolvedAt: whatsappMessages.resolvedAt })
        .from(whatsappMessages)
        .where(eq(whatsappMessages.userId, userIdB));
    });
    for (const msg of messages) {
      expect(msg.resolvedAt).toBeNull();
    }
  });
});
