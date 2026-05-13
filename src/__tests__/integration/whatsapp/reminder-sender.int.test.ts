import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReminderSendEventData } from '@/modules/whatsapp/inngest/client';
import { processReminderSend, type SenderDeps } from '@/modules/whatsapp/inngest/reminder-sender';
import { generateIdempotencyKey } from '@/modules/whatsapp/lib/reminders/idempotency-key';
import type {
  SendTemplateInput,
  SendTemplateResult,
} from '@/modules/whatsapp/server/adapters/twilio-bsp';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { messageTemplates, whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

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

function buildEventData(overrides: Partial<ReminderSendEventData> = {}): ReminderSendEventData {
  const sessionId = overrides.sessionId ?? randomUUID();
  const kind = overrides.kind ?? 'early';

  return {
    userId: randomUUID(),
    sessionId,
    patientId: randomUUID(),
    kind,
    idempotencyKey: generateIdempotencyKey(sessionId, kind),
    whatsappAccountId: randomUUID(),
    templateKey: 'lembrete_24h',
    patientPhone: '+5511988887777',
    patientFirstName: 'Maria',
    patientFullName: 'Maria Silva',
    psychologistDisplayName: 'Dra. Teste',
    sessionStartAt: '2026-06-15T14:00:00.000Z',
    sessionDurationMinutes: 50,
    sessionModality: 'in_person',
    videoLink: null,
    confirmationLink: null,
    sessionValue: null,
    locationName: null,
    locationAddress: null,
    locationArrivalInstructions: null,
    contentSid: 'HX_content_sid_001',
    templateBody: 'Ola {nome_paciente}, lembrete da sua sessao em {data} as {hora}.',
    ...overrides,
  };
}

/** Creates a mock sendTemplate that returns success. */
function mockSendTemplateSuccess(
  bspMessageId = 'SM_mock_success_001',
): (input: SendTemplateInput) => Promise<SendTemplateResult> {
  return vi.fn().mockResolvedValue({
    ok: true,
    data: { bspMessageId, status: 'queued' },
  } satisfies SendTemplateResult);
}

/** Creates a mock sendTemplate that returns a BSP error. */
function mockSendTemplateFailure(
  errorCode: 'INVALID_PHONE' | 'BLOCKED_BY_USER' | 'UNKNOWN',
  message = 'Mock error',
): (input: SendTemplateInput) => Promise<SendTemplateResult> {
  return vi.fn().mockResolvedValue({
    ok: false,
    error: { code: errorCode, twilioCode: undefined, message },
  } satisfies SendTemplateResult);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(whatsappMessages);
    await db.delete(messageTemplates);
    await db.delete(sessions);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reminder-sender — processReminderSend()', () => {
  it('sends a message and inserts whatsapp_messages with status=sent', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });

    const eventData = buildEventData({ userId, patientId, sessionId });
    const sendTemplate = mockSendTemplateSuccess('SM_test_001');

    const db = await getServiceDb();
    const deps: SenderDeps = { db, sendTemplate };

    const result = await processReminderSend(eventData, deps);

    expect(result.status).toBe('sent');
    expect(result.bspMessageId).toBe('SM_test_001');

    // Verify the message was inserted
    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.sessionId, sessionId));
    });

    expect(messages).toHaveLength(1);
    const msg = messages[0]!;
    expect(msg.status).toBe('sent');
    expect(msg.bspMessageId).toBe('SM_test_001');
    expect(msg.idempotencyKey).toBe(eventData.idempotencyKey);
    expect(msg.direction).toBe('outbound');
    expect(msg.templateKey).toBe('lembrete_24h');
    expect(msg.userId).toBe(userId);
    expect(msg.patientId).toBe(patientId);

    // Verify sendTemplate was called with correct args
    expect(sendTemplate).toHaveBeenCalledOnce();
    const callArgs = (sendTemplate as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as SendTemplateInput;
    expect(callArgs.to).toBe('+5511988887777');
    expect(callArgs.contentSid).toBe('HX_content_sid_001');
  });

  it('INVALID_PHONE error results in status=unable_to_send without retry', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });

    const eventData = buildEventData({ userId, patientId, sessionId });
    const sendTemplate = mockSendTemplateFailure('INVALID_PHONE', 'Invalid phone number');

    const db = await getServiceDb();
    const deps: SenderDeps = { db, sendTemplate };

    const result = await processReminderSend(eventData, deps);

    expect(result.status).toBe('unable_to_send');
    expect(result.errorCode).toBe('INVALID_PHONE');

    // Verify the message was inserted with unable_to_send status
    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.sessionId, sessionId));
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]!.status).toBe('unable_to_send');
    expect(messages[0]!.errorReason).toContain('INVALID_PHONE');
  });

  it('BLOCKED_BY_USER error results in status=unable_to_send without retry', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });

    const eventData = buildEventData({ userId, patientId, sessionId });
    const sendTemplate = mockSendTemplateFailure('BLOCKED_BY_USER', 'Blocked');

    const db = await getServiceDb();
    const deps: SenderDeps = { db, sendTemplate };

    const result = await processReminderSend(eventData, deps);

    expect(result.status).toBe('unable_to_send');
    expect(result.errorCode).toBe('BLOCKED_BY_USER');
  });

  it('UNKNOWN BSP error throws (retriable) rather than returning', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });

    const eventData = buildEventData({ userId, patientId, sessionId });
    const sendTemplate = mockSendTemplateFailure('UNKNOWN', 'Temporary failure');

    const db = await getServiceDb();
    const deps: SenderDeps = { db, sendTemplate };

    await expect(processReminderSend(eventData, deps)).rejects.toThrow('Twilio send failed');

    // No message should be inserted (Inngest will retry)
    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.sessionId, sessionId));
    });

    expect(messages).toHaveLength(0);
  });

  it('skips sending if idempotency key already exists in DB', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });

    const eventData = buildEventData({ userId, patientId, sessionId });

    // Pre-insert a message with the same idempotency key
    await runAsService(async (sdb) => {
      await sdb.insert(whatsappMessages).values({
        userId,
        patientId,
        sessionId,
        direction: 'outbound',
        idempotencyKey: eventData.idempotencyKey,
        status: 'sent',
      });
    });

    const sendTemplate = mockSendTemplateSuccess();
    const db = await getServiceDb();
    const deps: SenderDeps = { db, sendTemplate };

    const result = await processReminderSend(eventData, deps);

    expect(result.status).toBe('skipped');
    // sendTemplate should NOT have been called
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('adds consent footer on first message to a patient', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });

    const eventData = buildEventData({ userId, patientId, sessionId });
    const sendTemplate = mockSendTemplateSuccess();

    const db = await getServiceDb();
    const deps: SenderDeps = { db, sendTemplate };

    await processReminderSend(eventData, deps);

    // Verify consent footer was included
    const callArgs = (sendTemplate as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as SendTemplateInput;
    expect(callArgs.consentFooter).toBeDefined();
    expect(callArgs.consentFooter).toContain('PARAR');
  });

  it('omits consent footer on second message to the same patient', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId1 = randomUUID();
    const sessionId2 = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId1, { patientId });
    await seedSession(userId, sessionId2, { patientId });

    // First message — insert a prior outbound message
    await runAsService(async (sdb) => {
      await sdb.insert(whatsappMessages).values({
        userId,
        patientId,
        sessionId: sessionId1,
        direction: 'outbound',
        status: 'sent',
      });
    });

    // Now send a second message
    const eventData = buildEventData({
      userId,
      patientId,
      sessionId: sessionId2,
    });
    const sendTemplate = mockSendTemplateSuccess();

    const db = await getServiceDb();
    const deps: SenderDeps = { db, sendTemplate };

    await processReminderSend(eventData, deps);

    // Verify consent footer was NOT included
    const callArgs = (sendTemplate as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as SendTemplateInput;
    expect(callArgs.consentFooter).toBeUndefined();
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
