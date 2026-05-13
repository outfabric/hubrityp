import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { type Mock, afterEach, describe, expect, it, vi } from 'vitest';

import { openClient } from '@/__tests__/integration/setup/db';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import type { MessagePersistedEventData } from '@/modules/whatsapp/inngest/client';
import {
  processInboxMessageIngest,
  type IngestDeps,
  type IngestNotification,
} from '@/modules/whatsapp/inngest/inbox/inbox-message-ingest';
import { patients } from '@/shared/db/schema/patients/tables';
import { whatsappConversations, whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getServiceDb() {
  const { db } = openClient();
  return db;
}

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
  fullName = 'Maria Silva',
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName,
    });
  });
}

async function seedInboundMessage(
  userId: string,
  patientId: string,
  body: string,
  overrides: Partial<typeof whatsappMessages.$inferInsert> = {},
): Promise<string> {
  const messageId = overrides.id ?? randomUUID();
  await runAsService(async (db) => {
    await db.insert(whatsappMessages).values({
      id: messageId,
      userId,
      patientId,
      direction: 'inbound',
      fromPhone: '+5511999998888',
      body,
      status: 'delivered',
      ...overrides,
    });
  });
  return messageId;
}

/** Creates a mock notify function that records calls. */
function mockNotify() {
  return vi.fn().mockImplementation(() => Promise.resolve({ id: randomUUID() })) as Mock &
    IngestDeps['notify'];
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

describe('inbox-message-ingest — processInboxMessageIngest()', () => {
  it('creates a whatsapp_conversations row with unread_count=1 on first inbound message', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    const messageId = await seedInboundMessage(userId, patientId, 'Ola doutora, tudo bem?');

    const db = getServiceDb();
    const notify = mockNotify();
    const deps: IngestDeps = { db, notify };

    const eventData: MessagePersistedEventData = { messageId, userId, patientId };
    const result = await processInboxMessageIngest(eventData, deps);

    expect(result.status).toBe('processed');
    expect(result.riskFlagged).toBe(false);
    expect(result.conversationId).toBeDefined();

    // Verify the conversation was created
    const conversations = await runAsService(async (sdb) => {
      return sdb
        .select()
        .from(whatsappConversations)
        .where(eq(whatsappConversations.userId, userId));
    });

    expect(conversations).toHaveLength(1);
    const conv = conversations[0]!;
    expect(conv.userId).toBe(userId);
    expect(conv.patientId).toBe(patientId);
    expect(conv.lastMessageId).toBe(messageId);
    expect(conv.unreadCount).toBe(1);
    expect(conv.hasRisk).toBe(false);
    expect(conv.lastMessagePreview).toBe('Ola doutora, tudo bem?');
  });

  it('increments unread_count to 2 on second inbound message from same patient', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // First message
    const messageId1 = await seedInboundMessage(userId, patientId, 'Primeira mensagem');
    const db = getServiceDb();
    const notify = mockNotify();
    const deps: IngestDeps = { db, notify };

    await processInboxMessageIngest({ messageId: messageId1, userId, patientId }, deps);

    // Second message
    const messageId2 = await seedInboundMessage(userId, patientId, 'Segunda mensagem');
    await processInboxMessageIngest({ messageId: messageId2, userId, patientId }, deps);

    // Verify conversation was updated (not duplicated)
    const conversations = await runAsService(async (sdb) => {
      return sdb
        .select()
        .from(whatsappConversations)
        .where(eq(whatsappConversations.userId, userId));
    });

    expect(conversations).toHaveLength(1);
    const conv = conversations[0]!;
    expect(conv.unreadCount).toBe(2);
    expect(conv.lastMessageId).toBe(messageId2);
    expect(conv.lastMessagePreview).toBe('Segunda mensagem');
  });

  it('truncates last_message_preview to 80 characters', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const longBody = 'A'.repeat(100);
    const messageId = await seedInboundMessage(userId, patientId, longBody);

    const db = getServiceDb();
    const notify = mockNotify();
    const deps: IngestDeps = { db, notify };

    await processInboxMessageIngest({ messageId, userId, patientId }, deps);

    const conversations = await runAsService(async (sdb) => {
      return sdb
        .select()
        .from(whatsappConversations)
        .where(eq(whatsappConversations.userId, userId));
    });

    expect(conversations).toHaveLength(1);
    const preview = conversations[0]!.lastMessagePreview;
    expect(preview.length).toBe(80);
    expect(preview.endsWith('...')).toBe(true);
  });

  it('returns not_found when messageId does not exist in whatsapp_messages', async () => {
    const db = getServiceDb();
    const notify = mockNotify();
    const deps: IngestDeps = { db, notify };

    const result = await processInboxMessageIngest(
      { messageId: randomUUID(), userId: randomUUID(), patientId: randomUUID() },
      deps,
    );

    expect(result.status).toBe('not_found');
  });

  it('sends a variant=info notification for non-risk messages', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Ana Souza');
    const messageId = await seedInboundMessage(userId, patientId, 'Boa tarde!');

    const db = getServiceDb();
    const notify = mockNotify();
    const deps: IngestDeps = { db, notify };

    await processInboxMessageIngest({ messageId, userId, patientId }, deps);

    expect(notify).toHaveBeenCalledOnce();
    const call = notify.mock.calls[0]!;
    const payload = call[1] as IngestNotification;
    expect(payload.userId).toBe(userId);
    expect(payload.type).toBe('inbox_new_message');
    expect(payload.title).toBe('Nova mensagem de Ana Souza');
  });

  it('updates last_message_at to the message createdAt', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    const messageId = await seedInboundMessage(userId, patientId, 'Test message');

    const db = getServiceDb();
    const notify = mockNotify();
    const deps: IngestDeps = { db, notify };

    await processInboxMessageIngest({ messageId, userId, patientId }, deps);

    // Fetch the message's createdAt for comparison
    const [msg] = await runAsService(async (sdb) => {
      return sdb
        .select({ createdAt: whatsappMessages.createdAt })
        .from(whatsappMessages)
        .where(eq(whatsappMessages.id, messageId));
    });

    const conversations = await runAsService(async (sdb) => {
      return sdb
        .select()
        .from(whatsappConversations)
        .where(eq(whatsappConversations.userId, userId));
    });

    expect(conversations[0]!.lastMessageAt.toISOString()).toBe(msg!.createdAt.toISOString());
  });
});
