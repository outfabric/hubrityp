import { randomUUID } from 'node:crypto';

import { and, eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AUTO_REPLY_BODY, AUTO_REPLY_TEMPLATE_KEY } from '@/modules/whatsapp/lib/auto-reply';
import type { SendFreeTextResult } from '@/modules/whatsapp/server/adapters/twilio-bsp';
import {
  processInboundAutoReply,
  type ProcessInboundAutoReplyDeps,
} from '@/modules/whatsapp/server/auto-reply-inbound';
import { patients } from '@/shared/db/schema/patients/tables';
import { whatsappConversations, whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_PHONE = '+551140000000';
const PATIENT_PHONE = '+5511988887777';

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
      fullName: 'Maria Silva',
      phone: PATIENT_PHONE,
      whatsappOptOut: false,
      ...overrides,
    });
  });
}

function okSend(bspMessageId: string): SendFreeTextResult {
  return { ok: true, data: { bspMessageId, status: 'queued' } };
}

async function getServiceDb() {
  const { openClient } = await import('../setup/db');
  const { db } = openClient();
  return db;
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

describe('processInboundAutoReply', () => {
  it('sends the fixed auto-reply, persists inbound + outbound, and does NOT touch conversations', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const db = await getServiceDb();
    const sendFreeText = vi.fn(() => Promise.resolve(okSend('SM_out_1')));
    const deps: ProcessInboundAutoReplyDeps = { db, sendFreeText };

    const result = await processInboundAutoReply(
      { fromPhone: PATIENT_PHONE, bspMessageId: 'SM_in_1', platformPhone: PLATFORM_PHONE },
      deps,
    );

    expect(result).toEqual({ status: 'sent', patientId, bspMessageId: 'SM_out_1' });

    // Auto-reply sent with the fixed non-clinical body
    expect(sendFreeText).toHaveBeenCalledTimes(1);
    expect(sendFreeText).toHaveBeenCalledWith({ to: PATIENT_PHONE, body: AUTO_REPLY_BODY });

    const messages = await runAsService(async (sdb) =>
      sdb.select().from(whatsappMessages).where(eq(whatsappMessages.userId, userId)),
    );

    const inbound = messages.find((m) => m.direction === 'inbound');
    const outbound = messages.find((m) => m.direction === 'outbound');

    // Inbound persisted for the audit trail
    expect(inbound).toBeDefined();
    expect(inbound!.bspMessageId).toBe('SM_in_1');
    expect(inbound!.fromPhone).toBe(PATIENT_PHONE);
    expect(inbound!.toPhone).toBe(PLATFORM_PHONE);
    expect(inbound!.patientId).toBe(patientId);

    // Outbound auto-reply persisted with the label + fixed body
    expect(outbound).toBeDefined();
    expect(outbound!.templateKey).toBe(AUTO_REPLY_TEMPLATE_KEY);
    expect(outbound!.body).toBe(AUTO_REPLY_BODY);
    expect(outbound!.toPhone).toBe(PATIENT_PHONE);
    expect(outbound!.bspMessageId).toBe('SM_out_1');
    expect(outbound!.status).toBe('sent');

    // Inbox aggregate untouched
    const conversations = await runAsService(async (sdb) =>
      sdb.select().from(whatsappConversations).where(eq(whatsappConversations.userId, userId)),
    );
    expect(conversations).toHaveLength(0);
  });

  it('throttles a second inbound within 24h (no second send, no second outbound row)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const db = await getServiceDb();
    const sendFreeText = vi.fn(() => Promise.resolve(okSend('SM_out_1')));
    const deps: ProcessInboundAutoReplyDeps = { db, sendFreeText };

    await processInboundAutoReply(
      { fromPhone: PATIENT_PHONE, bspMessageId: 'SM_in_1', platformPhone: PLATFORM_PHONE },
      deps,
    );
    const second = await processInboundAutoReply(
      { fromPhone: PATIENT_PHONE, bspMessageId: 'SM_in_2', platformPhone: PLATFORM_PHONE },
      deps,
    );

    expect(second).toEqual({ status: 'throttled', patientId });
    // Only the first inbound triggered a send
    expect(sendFreeText).toHaveBeenCalledTimes(1);

    const outbound = await runAsService(async (sdb) =>
      sdb
        .select()
        .from(whatsappMessages)
        .where(
          and(eq(whatsappMessages.userId, userId), eq(whatsappMessages.direction, 'outbound')),
        ),
    );
    expect(outbound).toHaveLength(1);

    // Both inbound messages are still recorded for audit
    const inbound = await runAsService(async (sdb) =>
      sdb
        .select()
        .from(whatsappMessages)
        .where(and(eq(whatsappMessages.userId, userId), eq(whatsappMessages.direction, 'inbound'))),
    );
    expect(inbound).toHaveLength(2);
  });

  it('allows a new auto-reply once the previous one is older than 24h', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Seed a prior outbound auto-reply 25h ago (outside the throttle window)
    await runAsService(async (sdb) => {
      await sdb.insert(whatsappMessages).values({
        userId,
        patientId,
        direction: 'outbound',
        toPhone: PATIENT_PHONE,
        fromPhone: PLATFORM_PHONE,
        body: AUTO_REPLY_BODY,
        templateKey: AUTO_REPLY_TEMPLATE_KEY,
        bspMessageId: 'SM_old',
        status: 'sent',
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      });
    });

    const db = await getServiceDb();
    const sendFreeText = vi.fn(() => Promise.resolve(okSend('SM_out_new')));
    const deps: ProcessInboundAutoReplyDeps = { db, sendFreeText };

    const result = await processInboundAutoReply(
      { fromPhone: PATIENT_PHONE, bspMessageId: 'SM_in_new', platformPhone: PLATFORM_PHONE },
      deps,
    );

    expect(result.status).toBe('sent');
    expect(sendFreeText).toHaveBeenCalledTimes(1);
  });

  it('resolves the patient by reminder_phone', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, {
      phone: '+5511900001111',
      reminderPhone: PATIENT_PHONE,
    });

    const db = await getServiceDb();
    const sendFreeText = vi.fn(() => Promise.resolve(okSend('SM_out_1')));
    const deps: ProcessInboundAutoReplyDeps = { db, sendFreeText };

    const result = await processInboundAutoReply(
      { fromPhone: PATIENT_PHONE, bspMessageId: 'SM_in_1', platformPhone: PLATFORM_PHONE },
      deps,
    );

    expect(result.status).toBe('sent');
    expect(sendFreeText).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the phone matches no patient (no send, no rows)', async () => {
    const db = await getServiceDb();
    const sendFreeText = vi.fn(() => Promise.resolve(okSend('SM_out_1')));
    const deps: ProcessInboundAutoReplyDeps = { db, sendFreeText };

    const result = await processInboundAutoReply(
      { fromPhone: '+5511999999999', bspMessageId: 'SM_in_1', platformPhone: PLATFORM_PHONE },
      deps,
    );

    expect(result).toEqual({ status: 'no_patient' });
    expect(sendFreeText).not.toHaveBeenCalled();

    // Nothing was persisted for this unmatched inbound (scoped by its SID).
    const messages = await runAsService(async (sdb) =>
      sdb.select().from(whatsappMessages).where(eq(whatsappMessages.bspMessageId, 'SM_in_1')),
    );
    expect(messages).toHaveLength(0);
  });

  it('ignores a duplicate inbound (ON CONFLICT DO NOTHING on bsp_message_id)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const db = await getServiceDb();
    const sendFreeText = vi.fn(() => Promise.resolve(okSend('SM_out_1')));
    const deps: ProcessInboundAutoReplyDeps = { db, sendFreeText };

    await processInboundAutoReply(
      { fromPhone: PATIENT_PHONE, bspMessageId: 'SM_dup', platformPhone: PLATFORM_PHONE },
      deps,
    );
    // Twilio re-delivers the same inbound — must not create a duplicate row
    await processInboundAutoReply(
      { fromPhone: PATIENT_PHONE, bspMessageId: 'SM_dup', platformPhone: PLATFORM_PHONE },
      deps,
    );

    const inbound = await runAsService(async (sdb) =>
      sdb
        .select()
        .from(whatsappMessages)
        .where(
          and(
            eq(whatsappMessages.direction, 'inbound'),
            eq(whatsappMessages.bspMessageId, 'SM_dup'),
          ),
        ),
    );
    expect(inbound).toHaveLength(1);
  });
});
