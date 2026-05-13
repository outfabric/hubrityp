import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionCancelledEvent } from '@/modules/agenda/lib/session-events';
import {
  processCancellationNotice,
  type CancellationNoticeDeps,
} from '@/modules/whatsapp/inngest/cancellation-notice-sender';
import type {
  SendTemplateInput,
  SendTemplateResult,
} from '@/modules/whatsapp/server/adapters/twilio-bsp';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import {
  messageTemplates,
  whatsappAccounts,
  whatsappMessages,
} from '@/shared/db/schema/whatsapp/tables';

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
      status: 'cancelled',
      ...overrides,
    });
  });
}

async function seedTemplate(
  userId: string,
  templateKey: string,
  body: string,
  metaTemplateId: string,
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(messageTemplates).values({
      userId,
      templateKey,
      body,
      metaTemplateId,
      metaStatus: 'approved',
      variables: dsql`'[]'::jsonb`,
    });
  });
}

function buildCancelledEvent(overrides: Partial<SessionCancelledEvent> = {}): SessionCancelledEvent {
  return {
    sessionId: randomUUID(),
    patientId: randomUUID(),
    userId: randomUUID(),
    cancelledAt: new Date(),
    cancelledBy: 'therapist',
    reason: 'Reagendamento',
    notice: '24h+',
    chargeApplied: false,
    ...overrides,
  };
}

/** Creates a mock sendTemplate that returns success. */
function mockSendTemplateSuccess(
  bspMessageId = 'SM_mock_cancel_001',
): (input: SendTemplateInput) => Promise<SendTemplateResult> {
  return vi.fn().mockResolvedValue({
    ok: true,
    data: { bspMessageId, status: 'queued' },
  } satisfies SendTemplateResult);
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

describe('cancellation-notice-sender — processCancellationNotice()', () => {
  it('sends cancelamento_aviso when therapist cancels a session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });
    await seedTemplate(
      userId,
      'cancelamento_aviso',
      'Ola {nome_paciente}, sua sessao de {data} as {hora} com {nome_psicologo} foi cancelada.',
      'HX_cancel_sid_001',
    );

    const eventData = buildCancelledEvent({
      userId,
      patientId,
      sessionId,
      cancelledBy: 'therapist',
    });
    const sendTemplate = mockSendTemplateSuccess('SM_cancel_001');

    const db = await getServiceDb();
    const deps: CancellationNoticeDeps = { db, sendTemplate };

    const result = await processCancellationNotice(eventData, deps);

    expect(result.status).toBe('sent');
    expect(result.bspMessageId).toBe('SM_cancel_001');

    // Verify message was persisted
    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.sessionId, sessionId));
    });

    expect(messages).toHaveLength(1);
    const msg = messages[0]!;
    expect(msg.status).toBe('sent');
    expect(msg.bspMessageId).toBe('SM_cancel_001');
    expect(msg.templateKey).toBe('cancelamento_aviso');
    expect(msg.direction).toBe('outbound');
    expect(msg.userId).toBe(userId);
    expect(msg.patientId).toBe(patientId);

    // Verify sendTemplate was called
    expect(sendTemplate).toHaveBeenCalledOnce();
    const callArgs = (sendTemplate as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as SendTemplateInput;
    expect(callArgs.to).toBe('+5511988887777');
    expect(callArgs.contentSid).toBe('HX_cancel_sid_001');
    expect(callArgs.templateKey).toBe('cancelamento_aviso');
  });

  it('does NOT send when patient cancels (cancelled_by = patient)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });
    await seedTemplate(
      userId,
      'cancelamento_aviso',
      'Ola {nome_paciente}, sua sessao foi cancelada.',
      'HX_cancel_sid_001',
    );

    const eventData = buildCancelledEvent({
      userId,
      patientId,
      sessionId,
      cancelledBy: 'patient',
    });
    const sendTemplate = mockSendTemplateSuccess();

    const db = await getServiceDb();
    const deps: CancellationNoticeDeps = { db, sendTemplate };

    const result = await processCancellationNotice(eventData, deps);

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('cancelled_by_patient');

    // sendTemplate should NOT have been called
    expect(sendTemplate).not.toHaveBeenCalled();

    // No messages should be inserted
    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.sessionId, sessionId));
    });
    expect(messages).toHaveLength(0);
  });

  it('does NOT send when patient has opted out of WhatsApp', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId);
    await seedPatient(userId, patientId, { whatsappOptOut: true });
    await seedSession(userId, sessionId, { patientId });
    await seedTemplate(
      userId,
      'cancelamento_aviso',
      'Ola {nome_paciente}, sua sessao foi cancelada.',
      'HX_cancel_sid_001',
    );

    const eventData = buildCancelledEvent({
      userId,
      patientId,
      sessionId,
      cancelledBy: 'therapist',
    });
    const sendTemplate = mockSendTemplateSuccess();

    const db = await getServiceDb();
    const deps: CancellationNoticeDeps = { db, sendTemplate };

    const result = await processCancellationNotice(eventData, deps);

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('patient_opted_out');

    // sendTemplate should NOT have been called
    expect(sendTemplate).not.toHaveBeenCalled();

    // No messages should be inserted
    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.sessionId, sessionId));
    });
    expect(messages).toHaveLength(0);
  });

  it('does NOT send when WhatsApp account is in error state', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId, { status: 'error' });
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, { patientId });
    await seedTemplate(
      userId,
      'cancelamento_aviso',
      'Ola {nome_paciente}, sua sessao foi cancelada.',
      'HX_cancel_sid_001',
    );

    const eventData = buildCancelledEvent({
      userId,
      patientId,
      sessionId,
      cancelledBy: 'therapist',
    });
    const sendTemplate = mockSendTemplateSuccess();

    const db = await getServiceDb();
    const deps: CancellationNoticeDeps = { db, sendTemplate };

    const result = await processCancellationNotice(eventData, deps);

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('account_not_active');

    // sendTemplate should NOT have been called
    expect(sendTemplate).not.toHaveBeenCalled();

    // No messages should be inserted
    const messages = await runAsService(async (sdb) => {
      return sdb.select().from(whatsappMessages).where(eq(whatsappMessages.sessionId, sessionId));
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
