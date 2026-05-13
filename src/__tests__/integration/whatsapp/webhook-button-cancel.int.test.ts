import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  processCancellation,
  type CancellationHandlerDeps,
  type WebhookCancellationEventData,
} from '@/modules/whatsapp/inngest/webhook-cancellation-handler';
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

describe('webhook-cancellation-handler — processCancellation()', () => {
  it('cancels a scheduled session with cancelled_by=patient', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    // Session is 48h in the future for "24h+" notice
    const futureDate = new Date();
    futureDate.setHours(futureDate.getHours() + 48);
    const endDate = new Date(futureDate.getTime() + 50 * 60 * 1000);

    await seedSession(userId, sessionId, {
      patientId,
      startAt: futureDate,
      endAt: endDate,
    });

    const eventData: WebhookCancellationEventData = {
      bspMessageId: `SM_cancel_${randomUUID().slice(0, 8)}`,
      sessionId,
      patientId,
      userId,
      message: 'Nao posso comparecer',
    };

    const db = await getServiceDb();
    const deps: CancellationHandlerDeps = { db };

    const result = await processCancellation(eventData, deps);

    expect(result.status).toBe('cancelled');
    expect(result.sessionId).toBe(sessionId);
    expect(result.cancellationNotice).toBe('24h+');

    // Verify DB state
    const [session] = await runAsService(async (sdb) => {
      return sdb.select().from(sessions).where(eq(sessions.id, sessionId));
    });

    expect(session).toBeDefined();
    expect(session!.status).toBe('cancelled');
    expect(session!.cancelledBy).toBe('patient');
    expect(session!.cancelledAt).toBeInstanceOf(Date);
    expect(session!.cancellationReason).toBe('Nao posso comparecer');
    expect(session!.cancellationNotice).toBe('24h+');
  });

  it('applies correct cancellation notice for less than 2h advance', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    // Session starts in 1 hour
    const nearFuture = new Date();
    nearFuture.setHours(nearFuture.getHours() + 1);
    const endDate = new Date(nearFuture.getTime() + 50 * 60 * 1000);

    await seedSession(userId, sessionId, {
      patientId,
      startAt: nearFuture,
      endAt: endDate,
    });

    const eventData: WebhookCancellationEventData = {
      bspMessageId: `SM_late_${randomUUID().slice(0, 8)}`,
      sessionId,
      patientId,
      userId,
    };

    const db = await getServiceDb();
    const deps: CancellationHandlerDeps = { db };

    const result = await processCancellation(eventData, deps);

    expect(result.status).toBe('cancelled');
    expect(result.cancellationNotice).toBe('less_than_2h');
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

    const eventData: WebhookCancellationEventData = {
      bspMessageId: `SM_reply_${randomUUID().slice(0, 8)}`,
      sessionId: '', // Empty — resolve from original message
      patientId: '',
      userId: '',
      originalBspMessageId,
    };

    const db = await getServiceDb();
    const deps: CancellationHandlerDeps = { db };

    const result = await processCancellation(eventData, deps);

    expect(result.status).toBe('cancelled');
    expect(result.sessionId).toBe(sessionId);
  });

  it('ignores duplicate cancellation (session already cancelled)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, {
      patientId,
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy: 'patient',
    });

    const eventData: WebhookCancellationEventData = {
      bspMessageId: `SM_dup_${randomUUID().slice(0, 8)}`,
      sessionId,
      patientId,
      userId,
    };

    const db = await getServiceDb();
    const deps: CancellationHandlerDeps = { db };

    const result = await processCancellation(eventData, deps);

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('already_cancelled');

    // Session should remain unchanged
    const [session] = await runAsService(async (sdb) => {
      return sdb.select().from(sessions).where(eq(sessions.id, sessionId));
    });

    expect(session!.status).toBe('cancelled');
    expect(session!.cancelledBy).toBe('patient');
  });

  it('skips cancellation for a done session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, {
      patientId,
      status: 'done',
    });

    const eventData: WebhookCancellationEventData = {
      bspMessageId: `SM_done_${randomUUID().slice(0, 8)}`,
      sessionId,
      patientId,
      userId,
    };

    const db = await getServiceDb();
    const deps: CancellationHandlerDeps = { db };

    const result = await processCancellation(eventData, deps);

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('session_already_done');
  });

  it('returns not_found when session does not exist', async () => {
    const eventData: WebhookCancellationEventData = {
      bspMessageId: `SM_nf_${randomUUID().slice(0, 8)}`,
      sessionId: randomUUID(),
      patientId: randomUUID(),
      userId: randomUUID(),
    };

    const db = await getServiceDb();
    const deps: CancellationHandlerDeps = { db };

    const result = await processCancellation(eventData, deps);

    expect(result.status).toBe('not_found');
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
