import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  reconcileStuckMessages,
  type FetchTwilioMessage,
  type ReconciliationDeps,
  type TwilioMessageResource,
} from '@/modules/whatsapp/inngest/reconciliation-poller';
import { whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

import { runAsService } from '../setup/run-as-service';

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

/** Insert a whatsapp_messages row directly for testing. */
async function seedMessage(
  overrides: {
    id?: string;
    userId: string;
    bspMessageId?: string;
    status?: string;
    sentAt?: Date;
    direction?: string;
  },
): Promise<string> {
  const id = overrides.id ?? randomUUID();
  await runAsService(async (db) => {
    await db.insert(whatsappMessages).values({
      id,
      userId: overrides.userId,
      direction: overrides.direction ?? 'outbound',
      bspMessageId: overrides.bspMessageId ?? `SM_${randomUUID().slice(0, 8)}`,
      status: overrides.status ?? 'sent',
      sentAt: overrides.sentAt ?? new Date(),
    });
  });
  return id;
}

/** Creates a mock FetchTwilioMessage that returns a fixed status. */
function mockFetchTwilio(
  statusMap: Record<string, TwilioMessageResource>,
): FetchTwilioMessage {
  return vi.fn((bspMessageId: string): Promise<TwilioMessageResource> => {
    const resource = statusMap[bspMessageId];
    if (!resource) {
      return Promise.reject(new Error(`Mock: no Twilio resource for ${bspMessageId}`));
    }
    return Promise.resolve(resource);
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(whatsappMessages);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reconciliation-poller — reconcileStuckMessages()', () => {
  it('reconciles a stuck "sent" message to "delivered"', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const bspMessageId = `SM_reconcile_${randomUUID().slice(0, 8)}`;
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const msgId = await seedMessage({
      userId,
      bspMessageId,
      status: 'sent',
      sentAt: tenMinutesAgo,
    });

    const fetchTwilioMessage = mockFetchTwilio({
      [bspMessageId]: { status: 'delivered' },
    });

    const db = await getServiceDb();
    const deps: ReconciliationDeps = {
      db,
      fetchTwilioMessage,
      now: new Date(),
    };

    const result = await reconcileStuckMessages(deps);

    expect(result.stuckMessagesFound).toBe(1);
    expect(result.messagesReconciled).toBe(1);
    expect(result.errors).toBe(0);

    // Verify DB was updated
    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.id, msgId));
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]!.status).toBe('delivered');
    expect(messages[0]!.deliveredAt).not.toBeNull();
  });

  it('reconciles a stuck "queued" message to "read"', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const bspMessageId = `SM_reconcile_${randomUUID().slice(0, 8)}`;
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const msgId = await seedMessage({
      userId,
      bspMessageId,
      status: 'queued',
      sentAt: tenMinutesAgo,
    });

    const fetchTwilioMessage = mockFetchTwilio({
      [bspMessageId]: { status: 'read' },
    });

    const db = await getServiceDb();
    const deps: ReconciliationDeps = {
      db,
      fetchTwilioMessage,
      now: new Date(),
    };

    const result = await reconcileStuckMessages(deps);

    expect(result.stuckMessagesFound).toBe(1);
    expect(result.messagesReconciled).toBe(1);

    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.id, msgId));
    });

    expect(messages[0]!.status).toBe('read');
    expect(messages[0]!.readAt).not.toBeNull();
    expect(messages[0]!.deliveredAt).not.toBeNull();
  });

  it('marks stuck message as "failed" when Twilio reports failure', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const bspMessageId = `SM_reconcile_${randomUUID().slice(0, 8)}`;
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const msgId = await seedMessage({
      userId,
      bspMessageId,
      status: 'sent',
      sentAt: tenMinutesAgo,
    });

    const fetchTwilioMessage = mockFetchTwilio({
      [bspMessageId]: {
        status: 'undelivered',
        errorCode: 30007,
        errorMessage: 'Message filtered',
      },
    });

    const db = await getServiceDb();
    const deps: ReconciliationDeps = {
      db,
      fetchTwilioMessage,
      now: new Date(),
    };

    const result = await reconcileStuckMessages(deps);

    expect(result.stuckMessagesFound).toBe(1);
    expect(result.messagesFailed).toBe(1);
    expect(result.messagesReconciled).toBe(0);

    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.id, msgId));
    });

    expect(messages[0]!.status).toBe('failed');
    expect(messages[0]!.errorReason).toContain('30007');
    expect(messages[0]!.errorReason).toContain('Message filtered');
  });

  it('does NOT regress status (delivered → sent is ignored)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const bspMessageId = `SM_reconcile_${randomUUID().slice(0, 8)}`;
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    // The message is "sent" in our DB, but Twilio also reports "sent"
    // (no advancement — should be skipped)
    await seedMessage({
      userId,
      bspMessageId,
      status: 'sent',
      sentAt: tenMinutesAgo,
    });

    const fetchTwilioMessage = mockFetchTwilio({
      [bspMessageId]: { status: 'sent' },
    });

    const db = await getServiceDb();
    const deps: ReconciliationDeps = {
      db,
      fetchTwilioMessage,
      now: new Date(),
    };

    const result = await reconcileStuckMessages(deps);

    expect(result.stuckMessagesFound).toBe(1);
    // Same status — nothing to reconcile
    expect(result.messagesReconciled).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('ignores messages that are too recent (sent_at < 5 min ago)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const bspMessageId = `SM_reconcile_${randomUUID().slice(0, 8)}`;
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

    await seedMessage({
      userId,
      bspMessageId,
      status: 'sent',
      sentAt: twoMinutesAgo,
    });

    const fetchTwilioMessage = vi.fn();

    const db = await getServiceDb();
    const deps: ReconciliationDeps = {
      db,
      fetchTwilioMessage,
      now: new Date(),
    };

    const result = await reconcileStuckMessages(deps);

    expect(result.stuckMessagesFound).toBe(0);
    // Twilio should never be called for fresh messages
    expect(fetchTwilioMessage).not.toHaveBeenCalled();
  });

  it('ignores messages without bsp_message_id', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    // Insert a message WITHOUT bspMessageId
    await runAsService(async (db) => {
      await db.insert(whatsappMessages).values({
        userId,
        direction: 'outbound',
        bspMessageId: null,
        status: 'queued',
        sentAt: tenMinutesAgo,
      });
    });

    const fetchTwilioMessage = vi.fn();

    const db = await getServiceDb();
    const deps: ReconciliationDeps = {
      db,
      fetchTwilioMessage,
      now: new Date(),
    };

    const result = await reconcileStuckMessages(deps);

    expect(result.stuckMessagesFound).toBe(0);
    expect(fetchTwilioMessage).not.toHaveBeenCalled();
  });

  it('continues processing remaining messages when one Twilio fetch fails', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const bspId1 = `SM_fail_${randomUUID().slice(0, 8)}`;
    const bspId2 = `SM_ok_${randomUUID().slice(0, 8)}`;
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    await seedMessage({ userId, bspMessageId: bspId1, status: 'sent', sentAt: tenMinutesAgo });
    const msgId2 = await seedMessage({
      userId,
      bspMessageId: bspId2,
      status: 'sent',
      sentAt: tenMinutesAgo,
    });

    // bspId1 throws, bspId2 returns delivered
    const fetchTwilioMessage = vi.fn((bspMessageId: string): Promise<TwilioMessageResource> => {
      if (bspMessageId === bspId1) {
        return Promise.reject(new Error('Twilio API timeout'));
      }
      return Promise.resolve({ status: 'delivered' });
    });

    const db = await getServiceDb();
    const deps: ReconciliationDeps = {
      db,
      fetchTwilioMessage,
      now: new Date(),
    };

    const result = await reconcileStuckMessages(deps);

    expect(result.stuckMessagesFound).toBe(2);
    expect(result.errors).toBe(1);
    expect(result.messagesReconciled).toBe(1);

    // Verify second message was updated
    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.id, msgId2));
    });
    expect(messages[0]!.status).toBe('delivered');
  });

  it('handles Twilio "sending" status (maps to queued, no advancement from queued)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const bspMessageId = `SM_sending_${randomUUID().slice(0, 8)}`;
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    await seedMessage({
      userId,
      bspMessageId,
      status: 'queued',
      sentAt: tenMinutesAgo,
    });

    const fetchTwilioMessage = mockFetchTwilio({
      [bspMessageId]: { status: 'sending' },
    });

    const db = await getServiceDb();
    const deps: ReconciliationDeps = {
      db,
      fetchTwilioMessage,
      now: new Date(),
    };

    const result = await reconcileStuckMessages(deps);

    // "sending" maps to "queued" — same level, no advancement
    expect(result.stuckMessagesFound).toBe(1);
    expect(result.messagesReconciled).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Helper: get a DB connection (bypasses RLS)
// ---------------------------------------------------------------------------

async function getServiceDb() {
  const { openClient } = await import('../setup/db');
  const { db } = openClient();
  return db;
}
