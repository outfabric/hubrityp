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
  fullName = 'Carlos Oliveira',
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
// Tests — risk detection flow
// ---------------------------------------------------------------------------

describe('inbox-message-ingest — risk detection flow', () => {
  it('flags message with "me matar" — risk_flag=true, risk_keywords populated in whatsapp_messages', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    const messageId = await seedInboundMessage(
      userId,
      patientId,
      'Eu estou pensando em me matar, nao aguento mais',
    );

    const db = getServiceDb();
    const notify = mockNotify();
    const deps: IngestDeps = { db, notify };

    const eventData: MessagePersistedEventData = { messageId, userId, patientId };
    const result = await processInboxMessageIngest(eventData, deps);

    expect(result.status).toBe('processed');
    expect(result.riskFlagged).toBe(true);
    expect(result.riskKeywords).toContain('me matar');
    expect(result.riskKeywords).toContain('nao aguento mais');

    // Verify the whatsapp_messages row was updated with risk data
    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.id, messageId));
    });

    expect(messages).toHaveLength(1);
    const msg = messages[0]!;
    expect(msg.riskFlag).toBe(true);
    expect(msg.riskKeywords).toEqual(expect.arrayContaining(['me matar', 'nao aguento mais']));
  });

  it('sets has_risk=true on whatsapp_conversations when message is flagged', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    const messageId = await seedInboundMessage(
      userId,
      patientId,
      'Quero morrer, ninguem se importa',
    );

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
    expect(conversations[0]!.hasRisk).toBe(true);
  });

  it('sends variant=danger notification with risk title when message is flagged', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Joana Lima');
    const messageId = await seedInboundMessage(
      userId,
      patientId,
      'Penso em suicidio todos os dias',
    );

    const db = getServiceDb();
    const notify = mockNotify();
    const deps: IngestDeps = { db, notify };

    await processInboxMessageIngest({ messageId, userId, patientId }, deps);

    expect(notify).toHaveBeenCalledOnce();
    const call = notify.mock.calls[0]!;
    const payload = call[1] as IngestNotification;
    expect(payload.userId).toBe(userId);
    expect(payload.type).toBe('inbox_risk_message');
    expect(payload.title).toBe('Mensagem com alerta de risco recebida de Joana Lima');
    expect(payload.body).toContain('suicidio');
  });

  it('message without risk keywords — risk_flag=false, has_risk unchanged', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // First: a risky message to set has_risk=true on the conversation
    const riskyMsgId = await seedInboundMessage(userId, patientId, 'Eu quero morrer');
    const db = getServiceDb();
    const notify = mockNotify();
    const deps: IngestDeps = { db, notify };

    await processInboxMessageIngest({ messageId: riskyMsgId, userId, patientId }, deps);

    // Verify has_risk is true
    const convsBefore = await runAsService(async (sdb) => {
      return sdb
        .select()
        .from(whatsappConversations)
        .where(eq(whatsappConversations.userId, userId));
    });
    expect(convsBefore[0]!.hasRisk).toBe(true);

    // Second: a safe message — has_risk should remain true (never flips back)
    const safeMsgId = await seedInboundMessage(
      userId,
      patientId,
      'Bom dia doutora, estou melhor hoje',
    );
    await processInboxMessageIngest({ messageId: safeMsgId, userId, patientId }, deps);

    // Verify the safe message's risk_flag is false
    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.id, safeMsgId));
    });
    expect(messages[0]!.riskFlag).toBe(false);

    // Verify has_risk on conversation is still true (not flipped back)
    const convsAfter = await runAsService(async (sdb) => {
      return sdb
        .select()
        .from(whatsappConversations)
        .where(eq(whatsappConversations.userId, userId));
    });
    expect(convsAfter[0]!.hasRisk).toBe(true);
    expect(convsAfter[0]!.unreadCount).toBe(2);
  });

  it('false-positive phrase "matar saudade" does NOT trigger risk flag', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    const messageId = await seedInboundMessage(
      userId,
      patientId,
      'Vamos matar saudade semana que vem!',
    );

    const db = getServiceDb();
    const notify = mockNotify();
    const deps: IngestDeps = { db, notify };

    const result = await processInboxMessageIngest({ messageId, userId, patientId }, deps);

    expect(result.riskFlagged).toBe(false);
    expect(result.riskKeywords).toHaveLength(0);

    // Verify the message was NOT flagged
    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.id, messageId));
    });
    expect(messages[0]!.riskFlag).toBe(false);

    // Verify the notification is of type 'inbox_new_message' (not risk)
    const payload = notify.mock.calls[0]![1] as IngestNotification;
    expect(payload.type).toBe('inbox_new_message');
  });
});
