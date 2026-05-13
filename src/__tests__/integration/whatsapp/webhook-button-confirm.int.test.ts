import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  processConfirmation,
  type ConfirmationHandlerDeps,
  type WebhookConfirmationEventData,
} from '@/modules/whatsapp/inngest/webhook-confirmation-handler';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
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
      phone: '+5511988887777',
      ...overrides,
    });
  });
}

async function seedSession(
  userId: string,
  sessionId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      startAt: new Date('2026-06-15T14:00:00Z'),
      endAt: new Date('2026-06-15T14:50:00Z'),
      durationMinutes: 50,
      status: 'scheduled',
      ...overrides,
    });
  });
}

async function seedOutboundMessage(
  userId: string,
  sessionId: string,
  bspMessageId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(whatsappMessages).values({
      userId,
      sessionId,
      direction: 'outbound',
      status: 'delivered',
      bspMessageId,
      ...overrides,
    });
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(whatsappMessages);
    await db.delete(sessions);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('webhook-confirmation-handler — processConfirmation()', () => {
  it('confirms a scheduled session and sets confirmed_at', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const originalBspMessageId = `SM_orig_${randomUUID().slice(0, 8)}`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });
    await seedOutboundMessage(userId, sessionId, originalBspMessageId, { patientId });

    const emitAckEvent = vi.fn().mockResolvedValue(undefined);

    const eventData: WebhookConfirmationEventData = {
      bspMessageId: `SM_reply_${randomUUID().slice(0, 8)}`,
      sessionId,
      patientId,
      userId,
    };

    const db = await getServiceDb();
    const deps: ConfirmationHandlerDeps = { db, emitAckEvent };

    const result = await processConfirmation(eventData, deps);

    expect(result.status).toBe('confirmed');
    expect(result.sessionId).toBe(sessionId);

    // Verify DB state
    const [session] = await runAsService(async (sdb) => {
      return sdb.select().from(sessions).where(eq(sessions.id, sessionId));
    });

    expect(session).toBeDefined();
    expect(session!.status).toBe('confirmed');
    expect(session!.confirmedAt).toBeInstanceOf(Date);

    // Verify ack event was emitted
    expect(emitAckEvent).toHaveBeenCalledOnce();
    expect(emitAckEvent).toHaveBeenCalledWith({
      sessionId,
      patientId,
      userId,
    });
  });

  it('resolves session from originalBspMessageId when sessionId is empty', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const originalBspMessageId = `SM_orig_${randomUUID().slice(0, 8)}`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });
    await seedOutboundMessage(userId, sessionId, originalBspMessageId, { patientId });

    const emitAckEvent = vi.fn().mockResolvedValue(undefined);

    const eventData: WebhookConfirmationEventData = {
      bspMessageId: `SM_reply_${randomUUID().slice(0, 8)}`,
      sessionId: '', // Empty — should be resolved from original message
      patientId: '',
      userId: '',
      originalBspMessageId,
    };

    const db = await getServiceDb();
    const deps: ConfirmationHandlerDeps = { db, emitAckEvent };

    const result = await processConfirmation(eventData, deps);

    expect(result.status).toBe('confirmed');
    expect(result.sessionId).toBe(sessionId);

    // Verify DB state
    const [session] = await runAsService(async (sdb) => {
      return sdb.select().from(sessions).where(eq(sessions.id, sessionId));
    });

    expect(session).toBeDefined();
    expect(session!.status).toBe('confirmed');
  });

  it('ignores duplicate confirmation (session already confirmed)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, {
      patientId,
      status: 'confirmed',
      confirmedAt: new Date('2026-06-14T12:00:00Z'),
    });

    const emitAckEvent = vi.fn().mockResolvedValue(undefined);

    const eventData: WebhookConfirmationEventData = {
      bspMessageId: `SM_dup_${randomUUID().slice(0, 8)}`,
      sessionId,
      patientId,
      userId,
    };

    const db = await getServiceDb();
    const deps: ConfirmationHandlerDeps = { db, emitAckEvent };

    const result = await processConfirmation(eventData, deps);

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('already_confirmed');

    // Ack event should NOT be emitted for duplicates
    expect(emitAckEvent).not.toHaveBeenCalled();

    // Session should remain unchanged
    const [session] = await runAsService(async (sdb) => {
      return sdb.select().from(sessions).where(eq(sessions.id, sessionId));
    });

    expect(session!.status).toBe('confirmed');
  });

  it('skips confirmation for a cancelled session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, {
      patientId,
      status: 'cancelled',
      cancelledAt: new Date(),
    });

    const emitAckEvent = vi.fn().mockResolvedValue(undefined);

    const eventData: WebhookConfirmationEventData = {
      bspMessageId: `SM_canc_${randomUUID().slice(0, 8)}`,
      sessionId,
      patientId,
      userId,
    };

    const db = await getServiceDb();
    const deps: ConfirmationHandlerDeps = { db, emitAckEvent };

    const result = await processConfirmation(eventData, deps);

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('session_not_confirmable');
    expect(emitAckEvent).not.toHaveBeenCalled();
  });

  it('returns not_found when session does not exist', async () => {
    const emitAckEvent = vi.fn().mockResolvedValue(undefined);

    const eventData: WebhookConfirmationEventData = {
      bspMessageId: `SM_nf_${randomUUID().slice(0, 8)}`,
      sessionId: randomUUID(),
      patientId: randomUUID(),
      userId: randomUUID(),
    };

    const db = await getServiceDb();
    const deps: ConfirmationHandlerDeps = { db, emitAckEvent };

    const result = await processConfirmation(eventData, deps);

    expect(result.status).toBe('not_found');
    expect(emitAckEvent).not.toHaveBeenCalled();
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
