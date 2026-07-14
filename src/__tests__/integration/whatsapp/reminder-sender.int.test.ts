import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReminderSendEventData } from '@/modules/whatsapp/inngest/client';
import { processReminderSend, type SenderDeps } from '@/modules/whatsapp/inngest/reminder-sender';
import { generateIdempotencyKey } from '@/modules/whatsapp/lib/reminders/idempotency-key';
import {
  sendTemplate as realSendTemplate,
  type SendTemplateInput,
  type SendTemplateResult,
} from '@/modules/whatsapp/server/adapters/twilio-bsp';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { messageTemplates, whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Twilio SDK mock
// ---------------------------------------------------------------------------
//
// Most tests inject a fake `sendTemplate` via `SenderDeps`. The masked-number
// chain test below instead injects the REAL adapter so its E.164 normalization
// boundary is actually exercised — only Twilio's `messages.create` network call
// is stubbed here.

const { messagesCreate, twilioFactory } = vi.hoisted(() => {
  const messagesCreate = vi.fn();
  return {
    messagesCreate,
    twilioFactory: vi.fn(() => ({ messages: { create: messagesCreate } })),
  };
});

vi.mock('twilio', () => ({ default: twilioFactory }));

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
    sessionModality: 'in_person',
    videoLink: null,
    contentSid: 'HX_content_sid_001',
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
    // Template send — no rendered body persisted (design D9).
    expect(msg.body).toBeNull();
    expect(msg.userId).toBe(userId);
    expect(msg.patientId).toBe(patientId);

    // Verify sendTemplate was called with the Content SID + named variables
    // (no body / consent footer params).
    expect(sendTemplate).toHaveBeenCalledOnce();
    const callArgs = (sendTemplate as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as SendTemplateInput;
    expect(callArgs.to).toBe('+5511988887777');
    expect(callArgs.contentSid).toBe('HX_content_sid_001');
    expect(callArgs.templateKey).toBe('lembrete_24h');
    expect(callArgs.variables).toEqual({
      first_name: 'Maria',
      professional_name: 'Dra. Teste',
      date: '15/06/2026',
      time: '11:00',
    });
    expect(callArgs).not.toHaveProperty('body');
    expect(callArgs).not.toHaveProperty('bodyRendered');
    expect(callArgs).not.toHaveProperty('consentFooter');
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
    // Non-retriable failure still persists no rendered body (design D9).
    expect(messages[0]!.body).toBeNull();
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

  it('normalizes a masked patients.phone to E.164 through the real adapter (chain yields sent, not INVALID_PHONE)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    // The patient's ONLY number is the masked patients.phone (no reminder_phone).
    // This is exactly the shape that produced Twilio 21211 in the incident.
    await seedPatient(userId, patientId, { phone: '+55 86 99578-3867', reminderPhone: null });
    await seedSession(userId, sessionId, { patientId });

    messagesCreate.mockReset();
    messagesCreate.mockResolvedValue({ sid: 'SM_masked_chain_001', status: 'queued' });

    const eventData = buildEventData({
      userId,
      patientId,
      sessionId,
      patientPhone: '+55 86 99578-3867',
    });

    const db = await getServiceDb();
    // Inject the REAL adapter — only Twilio's network call is stubbed, so the
    // adapter's E.164 normalization boundary is genuinely exercised.
    const deps: SenderDeps = { db, sendTemplate: realSendTemplate };

    const result = await processReminderSend(eventData, deps);

    expect(result.status).toBe('sent');

    // Proof the fix works end-to-end: Twilio was addressed with a strict E.164
    // number, not the masked DB value that triggered INVALID_PHONE (21211).
    expect(messagesCreate).toHaveBeenCalledOnce();
    const twilioPayload = messagesCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(twilioPayload.to).toBe('whatsapp:+5586995783867');

    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.sessionId, sessionId));
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]!.status).toBe('sent');
    expect(messages[0]!.bspMessageId).toBe('SM_masked_chain_001');
  });

  it('builds session_link into variables for a video reminder', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });

    const eventData = buildEventData({
      userId,
      patientId,
      sessionId,
      kind: 'video',
      templateKey: 'link_video',
      sessionModality: 'online',
      videoLink: 'https://app.hubrity.com/v/abc123',
    });
    const sendTemplate = mockSendTemplateSuccess();

    const db = await getServiceDb();
    const deps: SenderDeps = { db, sendTemplate };

    await processReminderSend(eventData, deps);

    const callArgs = (sendTemplate as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as SendTemplateInput;
    expect(callArgs.variables).toEqual({
      first_name: 'Maria',
      professional_name: 'Dra. Teste',
      date: '15/06/2026',
      time: '11:00',
      session_link: 'https://app.hubrity.com/v/abc123',
    });
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
