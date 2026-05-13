import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
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

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Inbox Test Patient',
    });
  });
}

async function seedMessage(
  userId: string,
  overrides: Partial<typeof whatsappMessages.$inferInsert> = {},
): Promise<string> {
  const messageId = overrides.id ?? randomUUID();
  await runAsService(async (db) => {
    await db.insert(whatsappMessages).values({
      id: messageId,
      userId,
      direction: 'inbound',
      ...overrides,
    });
  });
  return messageId;
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(whatsappConversations);
    await db.delete(whatsappMessages);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// =====================================================================
// whatsapp_messages — new inbox columns
// =====================================================================

describe('whatsapp_messages — inbox columns', () => {
  it('read_at_by_psychologist column exists and defaults to null', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const messageId = await seedMessage(userId);

    const rows = await runAsService(async (db) => {
      return db.select().from(whatsappMessages).where(eq(whatsappMessages.id, messageId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.readAtByPsychologist).toBeNull();
  });

  it('resolved_at column exists and defaults to null', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const messageId = await seedMessage(userId);

    const rows = await runAsService(async (db) => {
      return db.select().from(whatsappMessages).where(eq(whatsappMessages.id, messageId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolvedAt).toBeNull();
  });

  it('risk_flag column exists and defaults to false', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const messageId = await seedMessage(userId);

    const rows = await runAsService(async (db) => {
      return db.select().from(whatsappMessages).where(eq(whatsappMessages.id, messageId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.riskFlag).toBe(false);
  });

  it('risk_keywords column exists and defaults to null', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const messageId = await seedMessage(userId);

    const rows = await runAsService(async (db) => {
      return db.select().from(whatsappMessages).where(eq(whatsappMessages.id, messageId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.riskKeywords).toBeNull();
  });

  it('inbox columns accept non-default values', async () => {
    const userId = randomUUID();
    const readAt = new Date('2026-06-01T10:00:00Z');
    const resolvedAt = new Date('2026-06-01T11:00:00Z');
    const keywords = ['suicídio', 'automutilação'];
    await seedAuthUser(userId);

    const messageId = await seedMessage(userId, {
      readAtByPsychologist: readAt,
      resolvedAt,
      riskFlag: true,
      riskKeywords: keywords,
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(whatsappMessages).where(eq(whatsappMessages.id, messageId));
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.readAtByPsychologist).toBeInstanceOf(Date);
    expect(row.readAtByPsychologist!.toISOString()).toBe(readAt.toISOString());
    expect(row.resolvedAt).toBeInstanceOf(Date);
    expect(row.resolvedAt!.toISOString()).toBe(resolvedAt.toISOString());
    expect(row.riskFlag).toBe(true);
    expect(row.riskKeywords).toEqual(keywords);
  });
});

// =====================================================================
// whatsapp_conversations — table existence, constraints, defaults
// =====================================================================

describe('whatsapp_conversations table — schema verification', () => {
  it('table whatsapp_conversations exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'whatsapp_conversations'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('RLS is enabled on whatsapp_conversations', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'whatsapp_conversations'`,
      );
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });

  it('UNIQUE(user_id, patient_id) prevents duplicate conversations', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const messageId = await seedMessage(userId, { patientId });

    await runAsService(async (db) => {
      await db.insert(whatsappConversations).values({
        userId,
        patientId,
        lastMessageId: messageId,
        lastMessageAt: new Date(),
        lastMessagePreview: 'Hello',
        unreadCount: 1,
      });
    });

    const messageId2 = await seedMessage(userId, { patientId });

    await expect(
      runAsService(async (db) => {
        await db.insert(whatsappConversations).values({
          userId,
          patientId,
          lastMessageId: messageId2,
          lastMessageAt: new Date(),
          lastMessagePreview: 'World',
          unreadCount: 0,
        });
      }),
    ).rejects.toThrow();
  });

  it('FK constraint with auth.users works — rejects invalid user_id', async () => {
    const fakeUserId = randomUUID();
    const patientId = randomUUID();

    await expect(
      runAsService(async (db) => {
        await db.insert(whatsappConversations).values({
          userId: fakeUserId,
          patientId,
          lastMessageId: randomUUID(),
          lastMessageAt: new Date(),
          lastMessagePreview: 'Test',
          unreadCount: 0,
        });
      }),
    ).rejects.toThrow();
  });

  it('FK constraint with patients works — rejects invalid patient_id', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const messageId = await seedMessage(userId);

    await expect(
      runAsService(async (db) => {
        await db.insert(whatsappConversations).values({
          userId,
          patientId: randomUUID(), // not in patients table
          lastMessageId: messageId,
          lastMessageAt: new Date(),
          lastMessagePreview: 'Test',
          unreadCount: 0,
        });
      }),
    ).rejects.toThrow();
  });

  it('FK constraint with whatsapp_messages works — rejects invalid last_message_id', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await expect(
      runAsService(async (db) => {
        await db.insert(whatsappConversations).values({
          userId,
          patientId,
          lastMessageId: randomUUID(), // not in whatsapp_messages table
          lastMessageAt: new Date(),
          lastMessagePreview: 'Test',
          unreadCount: 0,
        });
      }),
    ).rejects.toThrow();
  });

  it('default values are applied correctly', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    const messageId = await seedMessage(userId, { patientId });

    await runAsService(async (db) => {
      await db.insert(whatsappConversations).values({
        userId,
        patientId,
        lastMessageId: messageId,
        lastMessageAt: new Date(),
        lastMessagePreview: 'Hello test',
      });
    });

    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(whatsappConversations)
        .where(eq(whatsappConversations.userId, userId));
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.unreadCount).toBe(0);
    expect(row.hasRisk).toBe(false);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });
});

// =====================================================================
// whatsapp_conversations — indexes verification
// =====================================================================

describe('whatsapp_conversations — indexes verification', () => {
  it('indexes exist on whatsapp_conversations', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'whatsapp_conversations'
             ORDER BY indexname`,
      );
    });

    const indexNames = result.map((r: Record<string, unknown>) => r.indexname as string);

    expect(indexNames).toContain('whatsapp_conversations_user_id_last_message_at_idx');
    expect(indexNames).toContain('whatsapp_conversations_user_id_has_risk_idx');
  });
});

// =====================================================================
// whatsapp_messages — new indexes verification
// =====================================================================

describe('whatsapp_messages — new indexes verification', () => {
  it('GIN index for full-text search exists on whatsapp_messages', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname, indexdef FROM pg_indexes
             WHERE tablename = 'whatsapp_messages' AND indexname = 'whatsapp_messages_body_fts_idx'`,
      );
    });

    expect(result).toHaveLength(1);
    const indexDef = (result[0] as Record<string, unknown>).indexdef as string;
    expect(indexDef.toLowerCase()).toContain('gin');
    expect(indexDef.toLowerCase()).toContain('tsvector');
  });

  it('composite index (user_id, patient_id, created_at) exists on whatsapp_messages', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'whatsapp_messages'
               AND indexname = 'whatsapp_messages_user_patient_created_at_idx'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});

// =====================================================================
// whatsapp_conversations — RLS policies
// =====================================================================

describe('whatsapp_conversations — RLS policies', () => {
  it('owner can read their own conversations', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    const messageId = await seedMessage(userId, { patientId });

    await runAsService(async (db) => {
      await db.insert(whatsappConversations).values({
        userId,
        patientId,
        lastMessageId: messageId,
        lastMessageAt: new Date(),
        lastMessagePreview: 'Test message',
        unreadCount: 1,
      });
    });

    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(whatsappConversations);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
  });

  it('owner cannot read another user conversations (cross-user blocked)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);
    const messageId = await seedMessage(userA, { patientId });

    await runAsService(async (db) => {
      await db.insert(whatsappConversations).values({
        userId: userA,
        patientId,
        lastMessageId: messageId,
        lastMessageAt: new Date(),
        lastMessagePreview: 'Secret',
        unreadCount: 0,
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(whatsappConversations);
    });

    expect(rows).toHaveLength(0);
  });
});

// =====================================================================
// whatsapp_messages — RLS for inbox update operations
// =====================================================================

describe('whatsapp_messages — RLS update for inbox columns', () => {
  it('owner can update read_at_by_psychologist and resolved_at on their own messages', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const messageId = await seedMessage(userId);

    const now = new Date();
    await runAsUser(userId, async (db) => {
      await db
        .update(whatsappMessages)
        .set({ readAtByPsychologist: now, resolvedAt: now })
        .where(eq(whatsappMessages.id, messageId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(whatsappMessages).where(eq(whatsappMessages.id, messageId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.readAtByPsychologist).toBeInstanceOf(Date);
    expect(rows[0]!.resolvedAt).toBeInstanceOf(Date);
  });

  it('owner cannot update another user messages', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    const messageId = await seedMessage(userA);

    // userB tries to update userA's message — RLS should silently filter it
    await runAsUser(userB, async (db) => {
      await db
        .update(whatsappMessages)
        .set({ readAtByPsychologist: new Date() })
        .where(eq(whatsappMessages.id, messageId));
    });

    // The message should remain untouched
    const rows = await runAsService(async (db) => {
      return db.select().from(whatsappMessages).where(eq(whatsappMessages.id, messageId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.readAtByPsychologist).toBeNull();
  });
});
