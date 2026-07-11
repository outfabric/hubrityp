import { randomUUID } from 'node:crypto';

import { eq, isNull, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConfirmationAckEventData } from '@/modules/whatsapp/inngest/client';
import {
  processConfirmationAck,
  type ConfirmationAckDeps,
} from '@/modules/whatsapp/inngest/confirmation-ack-sender';
import { generateIdempotencyKey } from '@/modules/whatsapp/lib/reminders/idempotency-key';
import type {
  SendFreeTextInput,
  SendFreeTextResult,
} from '@/modules/whatsapp/server/adapters/twilio-bsp';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import {
  messageTemplates,
  whatsappAccounts,
  whatsappMessages,
} from '@/shared/db/schema/whatsapp/tables';

import { runAsService } from '../setup/run-as-service';

const KIND = 'confirmed_ack';

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

async function seedProfile(userId: string, fullName = 'Dra. Teste'): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO profiles (user_id, email, full_name, crp_number, crp_uf, status, terms_accepted_at, privacy_accepted_at, sensitive_data_consent_at)
           VALUES (${userId}, ${`test-${userId}@example.com`}, ${fullName}, '01/12345', 'SP', 'active', now(), now(), now())
           ON CONFLICT (user_id) DO NOTHING`,
    );
  });
}

async function seedWhatsappAccount(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const accountId = randomUUID();
  await runAsService(async (db) => {
    await db.insert(whatsappAccounts).values({
      id: accountId,
      userId,
      provider: 'twilio',
      accountId: `MG${randomUUID().replace(/-/g, '')}`,
      phoneNumber: '+5511999999999',
      displayName: 'Consultorio Teste',
      status: 'active',
      consentGivenAt: new Date(),
      ...overrides,
    });
  });
  return accountId;
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
      whatsappOptOut: false,
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

function buildEventData(
  overrides: Partial<ConfirmationAckEventData> = {},
): ConfirmationAckEventData {
  return {
    sessionId: randomUUID(),
    patientId: randomUUID(),
    userId: randomUUID(),
    ...overrides,
  };
}

/** Creates a mock sendFreeText that returns success. */
function mockSendFreeTextSuccess(
  bspMessageId = 'SM_mock_ack_001',
): (input: SendFreeTextInput) => Promise<SendFreeTextResult> {
  return vi.fn().mockResolvedValue({
    ok: true,
    data: { bspMessageId, status: 'queued' },
  } satisfies SendFreeTextResult);
}

/** Creates a mock sendFreeText that returns a BSP error. */
function mockSendFreeTextFailure(
  errorCode: 'INVALID_PHONE' | 'BLOCKED_BY_USER' | 'UNKNOWN',
  message = 'Mock error',
): (input: SendFreeTextInput) => Promise<SendFreeTextResult> {
  return vi.fn().mockResolvedValue({
    ok: false,
    error: { code: errorCode, twilioCode: undefined, message },
  } satisfies SendFreeTextResult);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(whatsappMessages);
    await db.delete(messageTemplates);
    await db.delete(whatsappAccounts);
    await db.delete(sessions);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM profiles WHERE email LIKE 'test-%@example.com'`);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('confirmation-ack-sender — processConfirmationAck()', () => {
  it('sends a free-form ack and persists body + template_key IS NULL (no message_templates rows)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dra. Ana');
    await seedWhatsappAccount(userId);
    await seedPatient(userId, patientId, { fullName: 'Maria Silva' });
    await seedSession(userId, sessionId, { patientId });
    // NOTE: no message_templates row is seeded — the ack body is a code
    // constant, so a zero-template account must still send.

    const eventData = buildEventData({ userId, patientId, sessionId });
    const sendFreeText = mockSendFreeTextSuccess('SM_ack_001');

    const db = await getServiceDb();
    const deps: ConfirmationAckDeps = { db, sendFreeText };

    const result = await processConfirmationAck(eventData, deps);

    expect(result.status).toBe('sent');
    expect(result.bspMessageId).toBe('SM_ack_001');

    // Free-form send — no contentSid, body carries the rendered text.
    expect(sendFreeText).toHaveBeenCalledOnce();
    const callArgs = (sendFreeText as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as SendFreeTextInput;
    expect(callArgs.to).toBe('+5511988887777');
    expect(callArgs).not.toHaveProperty('contentSid');
    expect(callArgs).not.toHaveProperty('variables');
    // Rendered from the code constant with first_name / professional_name.
    expect(callArgs.body).toContain(
      'Obrigado, Maria! Sua presença na sessão com Dra. Ana está confirmada.',
    );

    // The whatsapp_messages row keeps the sent text and a NULL template_key.
    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.sessionId, sessionId));
    });

    expect(messages).toHaveLength(1);
    const msg = messages[0]!;
    expect(msg.status).toBe('sent');
    expect(msg.bspMessageId).toBe('SM_ack_001');
    expect(msg.direction).toBe('outbound');
    expect(msg.templateKey).toBeNull();
    expect(msg.body).toBe(callArgs.body);
    expect(msg.body).toContain('Obrigado, Maria!');
    expect(msg.userId).toBe(userId);
    expect(msg.patientId).toBe(patientId);
    expect(msg.idempotencyKey).toBe(generateIdempotencyKey(sessionId, KIND));
  });

  it('appends the consent footer only on the first outbound message', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dra. Ana');
    await seedWhatsappAccount(userId);
    await seedPatient(userId, patientId, { fullName: 'Maria Silva' });
    await seedSession(userId, sessionId, { patientId });

    // First ack → footer present.
    const firstEvent = buildEventData({ userId, patientId, sessionId });
    const firstSend = mockSendFreeTextSuccess('SM_first');
    const db = await getServiceDb();

    const firstResult = await processConfirmationAck(firstEvent, { db, sendFreeText: firstSend });
    expect(firstResult.status).toBe('sent');

    const firstBody = (firstSend as ReturnType<typeof vi.fn>).mock.calls[0]![0].body as string;
    expect(firstBody).toContain('responda PARAR.');

    // Second outbound (different session) → footer absent, prior outbound exists.
    const secondSessionId = randomUUID();
    await seedSession(userId, secondSessionId, { patientId });
    const secondEvent = buildEventData({ userId, patientId, sessionId: secondSessionId });
    const secondSend = mockSendFreeTextSuccess('SM_second');

    const secondResult = await processConfirmationAck(secondEvent, {
      db,
      sendFreeText: secondSend,
    });
    expect(secondResult.status).toBe('sent');

    const secondBody = (secondSend as ReturnType<typeof vi.fn>).mock.calls[0]![0].body as string;
    expect(secondBody).not.toContain('responda PARAR.');
    expect(secondBody).toContain('Obrigado, Maria!');
  });

  it('short-circuits a duplicate ack event via the idempotency key', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });

    const eventData = buildEventData({ userId, patientId, sessionId });

    // Pre-insert a message with the same idempotency key (prior successful send).
    await runAsService(async (sdb) => {
      await sdb.insert(whatsappMessages).values({
        userId,
        patientId,
        sessionId,
        direction: 'outbound',
        idempotencyKey: generateIdempotencyKey(sessionId, KIND),
        status: 'sent',
      });
    });

    const sendFreeText = mockSendFreeTextSuccess();
    const db = await getServiceDb();

    const result = await processConfirmationAck(eventData, { db, sendFreeText });

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('already_sent');
    expect(sendFreeText).not.toHaveBeenCalled();

    // No new row was inserted (still exactly the pre-seeded one).
    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.sessionId, sessionId));
    });
    expect(messages).toHaveLength(1);
  });

  it('records unable_to_send with populated body and NULL template_key on a non-retriable error', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });

    const eventData = buildEventData({ userId, patientId, sessionId });
    const sendFreeText = mockSendFreeTextFailure('INVALID_PHONE', 'Invalid phone number');

    const db = await getServiceDb();
    const result = await processConfirmationAck(eventData, { db, sendFreeText });

    expect(result.status).toBe('unable_to_send');
    expect(result.errorCode).toBe('INVALID_PHONE');

    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.sessionId, sessionId));
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.status).toBe('unable_to_send');
    expect(messages[0]!.errorReason).toContain('INVALID_PHONE');
    expect(messages[0]!.templateKey).toBeNull();
    // Free-form record keeps the text that was attempted.
    expect(messages[0]!.body).toContain('Obrigado');
  });

  it('throws (retriable) on an UNKNOWN BSP error without persisting a row', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });

    const eventData = buildEventData({ userId, patientId, sessionId });
    const sendFreeText = mockSendFreeTextFailure('UNKNOWN', 'Temporary failure');

    const db = await getServiceDb();

    await expect(processConfirmationAck(eventData, { db, sendFreeText })).rejects.toThrow(
      'Twilio send failed',
    );

    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.sessionId, sessionId));
    });
    expect(messages).toHaveLength(0);
  });

  it('skips when the patient has opted out of WhatsApp', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId);
    await seedPatient(userId, patientId, { whatsappOptOut: true });
    await seedSession(userId, sessionId, { patientId });

    const eventData = buildEventData({ userId, patientId, sessionId });
    const sendFreeText = mockSendFreeTextSuccess();

    const db = await getServiceDb();
    const result = await processConfirmationAck(eventData, { db, sendFreeText });

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('patient_opted_out');
    expect(sendFreeText).not.toHaveBeenCalled();

    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(isNull(whatsappMessages.bspMessageId));
    });
    expect(messages).toHaveLength(0);
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
