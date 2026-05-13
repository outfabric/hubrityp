import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import type { StatusUpdatedEventData } from '@/modules/whatsapp/inngest/client';
import {
  processStatusUpdate,
  type StatusHandlerDeps,
} from '@/modules/whatsapp/inngest/webhook-status-handler';
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

async function seedWhatsappMessage(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const messageId = randomUUID();
  await runAsService(async (db) => {
    await db.insert(whatsappMessages).values({
      id: messageId,
      userId,
      direction: 'outbound',
      status: 'sent',
      bspMessageId: `SM_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      sentAt: new Date(),
      ...overrides,
    });
  });
  return messageId;
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

describe('webhook-status-handler — processStatusUpdate()', () => {
  it('updates status to delivered and sets deliveredAt', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const bspMessageId = `SM_delivered_${randomUUID().slice(0, 8)}`;
    await seedWhatsappMessage(userId, { bspMessageId, status: 'sent' });

    const eventData: StatusUpdatedEventData = {
      bspMessageId,
      status: 'delivered',
    };

    const db = await getServiceDb();
    const deps: StatusHandlerDeps = { db };

    const result = await processStatusUpdate(eventData, deps);

    expect(result.status).toBe('updated');
    expect(result.newStatus).toBe('delivered');

    // Verify DB state
    const [msg] = await runAsService(async (sdb) => {
      return sdb
        .select()
        .from(whatsappMessages)
        .where(eq(whatsappMessages.bspMessageId, bspMessageId));
    });

    expect(msg).toBeDefined();
    expect(msg!.status).toBe('delivered');
    expect(msg!.deliveredAt).toBeInstanceOf(Date);
  });

  it('updates status to read and sets readAt (and deliveredAt if not already set)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const bspMessageId = `SM_read_${randomUUID().slice(0, 8)}`;
    await seedWhatsappMessage(userId, { bspMessageId, status: 'sent' });

    const eventData: StatusUpdatedEventData = {
      bspMessageId,
      status: 'read',
    };

    const db = await getServiceDb();
    const deps: StatusHandlerDeps = { db };

    const result = await processStatusUpdate(eventData, deps);

    expect(result.status).toBe('updated');
    expect(result.newStatus).toBe('read');

    // Verify DB state
    const [msg] = await runAsService(async (sdb) => {
      return sdb
        .select()
        .from(whatsappMessages)
        .where(eq(whatsappMessages.bspMessageId, bspMessageId));
    });

    expect(msg).toBeDefined();
    expect(msg!.status).toBe('read');
    expect(msg!.readAt).toBeInstanceOf(Date);
    // deliveredAt should also be set via COALESCE
    expect(msg!.deliveredAt).toBeInstanceOf(Date);
  });

  it('updates status to failed and records error reason', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const bspMessageId = `SM_failed_${randomUUID().slice(0, 8)}`;
    await seedWhatsappMessage(userId, { bspMessageId, status: 'sent' });

    const eventData: StatusUpdatedEventData = {
      bspMessageId,
      status: 'failed',
      errorCode: 30007,
      errorMessage: 'Message delivery failed',
    };

    const db = await getServiceDb();
    const deps: StatusHandlerDeps = { db };

    const result = await processStatusUpdate(eventData, deps);

    expect(result.status).toBe('updated');
    expect(result.newStatus).toBe('failed');

    // Verify DB state
    const [msg] = await runAsService(async (sdb) => {
      return sdb
        .select()
        .from(whatsappMessages)
        .where(eq(whatsappMessages.bspMessageId, bspMessageId));
    });

    expect(msg).toBeDefined();
    expect(msg!.status).toBe('failed');
    expect(msg!.errorReason).toContain('30007');
    expect(msg!.errorReason).toContain('Message delivery failed');
  });

  it('returns not_found when bsp_message_id does not match any row', async () => {
    const eventData: StatusUpdatedEventData = {
      bspMessageId: 'SM_nonexistent_123',
      status: 'delivered',
    };

    const db = await getServiceDb();
    const deps: StatusHandlerDeps = { db };

    const result = await processStatusUpdate(eventData, deps);

    expect(result.status).toBe('not_found');
  });

  it('returns skipped when bsp_message_id is empty', async () => {
    const eventData: StatusUpdatedEventData = {
      bspMessageId: '',
      status: 'delivered',
    };

    const db = await getServiceDb();
    const deps: StatusHandlerDeps = { db };

    const result = await processStatusUpdate(eventData, deps);

    expect(result.status).toBe('skipped');
  });

  it('preserves existing deliveredAt when updating to read', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const bspMessageId = `SM_readpre_${randomUUID().slice(0, 8)}`;
    const earlierDelivered = new Date('2026-06-10T10:00:00Z');
    await seedWhatsappMessage(userId, {
      bspMessageId,
      status: 'delivered',
      deliveredAt: earlierDelivered,
    });

    const eventData: StatusUpdatedEventData = {
      bspMessageId,
      status: 'read',
    };

    const db = await getServiceDb();
    const deps: StatusHandlerDeps = { db };

    await processStatusUpdate(eventData, deps);

    // Verify deliveredAt was NOT overwritten
    const [msg] = await runAsService(async (sdb) => {
      return sdb
        .select()
        .from(whatsappMessages)
        .where(eq(whatsappMessages.bspMessageId, bspMessageId));
    });

    expect(msg).toBeDefined();
    expect(msg!.status).toBe('read');
    expect(msg!.readAt).toBeInstanceOf(Date);
    // deliveredAt should be the original earlier date (COALESCE preserves it)
    expect(msg!.deliveredAt).toBeInstanceOf(Date);
    expect(msg!.deliveredAt!.getTime()).toBe(earlierDelivered.getTime());
  });
});

// ---------------------------------------------------------------------------
// Signature validation tests (validateTwilioSignature directly)
// ---------------------------------------------------------------------------

describe('webhook — Twilio signature validation', () => {
  it('rejects an invalid signature', async () => {
    // validateTwilioSignature wraps twilio.validateRequest which computes
    // HMAC-SHA1. An incorrect signature returns false.
    const { validateTwilioSignature } =
      await import('@/modules/whatsapp/server/adapters/twilio-signature');

    const authToken = 'test_auth_token_123';
    const url = 'https://example.com/api/webhooks/twilio/whatsapp';
    const params = { MessageSid: 'SM_test_123', MessageStatus: 'delivered' };

    const isValid = validateTwilioSignature(authToken, 'invalid_signature_value', url, params);

    expect(isValid).toBe(false);
  });

  it('accepts a valid HMAC-SHA1 signature', async () => {
    const { createHmac } = await import('node:crypto');
    const { validateTwilioSignature } =
      await import('@/modules/whatsapp/server/adapters/twilio-signature');

    const authToken = 'test_auth_token_123';
    const url = 'https://example.com/api/webhooks/twilio/whatsapp';
    const params: Record<string, string> = {
      MessageSid: 'SM_test_123',
      MessageStatus: 'delivered',
    };

    // Compute valid Twilio signature:
    // 1. Sort params by key
    // 2. Append key+value to URL
    // 3. HMAC-SHA1 with auth token, base64
    const sortedKeys = Object.keys(params).sort();
    let dataToSign = url;
    for (const key of sortedKeys) {
      dataToSign += key + params[key];
    }
    const expectedSignature = createHmac('sha1', authToken)
      .update(dataToSign, 'utf8')
      .digest('base64');

    const isValid = validateTwilioSignature(authToken, expectedSignature, url, params);

    expect(isValid).toBe(true);
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
