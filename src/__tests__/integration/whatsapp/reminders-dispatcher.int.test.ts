import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  dispatchReminders,
  type DispatcherDeps,
  fetchVideoLink,
  fetchVideoLinksBatch,
  type ReminderSendFanOutEvent,
} from '@/modules/whatsapp/inngest/reminders-dispatcher';
import { generateIdempotencyKey } from '@/modules/whatsapp/lib/reminders/idempotency-key';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';
import {
  messageTemplates,
  reminderSettings,
  whatsappAccounts,
  whatsappMessages,
} from '@/shared/db/schema/whatsapp/tables';
import { serverEnv } from '@/shared/env';

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
      displayName: 'Consultório Teste',
      status: 'active',
      consentGivenAt: new Date(),
      ...overrides,
    });
  });
  return accountId;
}

async function seedReminderSettings(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(reminderSettings).values({
      userId,
      earlyReminderHours: 24,
      finalReminderHours: 2,
      videoLinkMinutes: 30,
      sendDuringNight: false,
      ...overrides,
    });
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
      whatsappOptOut: false,
      ...overrides,
    });
  });
}

async function seedSession(
  userId: string,
  sessionId: string,
  startAt: Date,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      startAt,
      endAt: new Date(startAt.getTime() + 50 * 60 * 1000),
      durationMinutes: 50,
      status: 'scheduled',
      remindersDisabled: false,
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

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(whatsappMessages);
    await db.delete(messageTemplates);
    await db.delete(reminderSettings);
    await db.delete(whatsappAccounts);
    await db.delete(videoRooms);
    await db.delete(sessions);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM profiles WHERE email LIKE 'test-%@example.com'`);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reminders-dispatcher — dispatchReminders()', () => {
  it('emits reminder.send event for a session within the early reminder window', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId);
    await seedReminderSettings(userId);
    await seedPatient(userId, patientId);

    // Session 24 hours from "now", but "now" is set to 24h before session
    // so the early reminder is due. Dates are pinned far in the future so the
    // real wall clock never overtakes the fixture (the DB-default created_at
    // would otherwise land after the RN-04.03 threshold and suppress the early
    // reminder). The explicit createdAt places creation well before startAt so
    // RN-04.03 (skip early when created < early_reminder_hours before start)
    // does not fire.
    const sessionStart = new Date('2030-06-15T14:00:00Z');
    await seedSession(userId, sessionId, sessionStart, {
      patientId,
      createdAt: new Date('2030-06-10T12:00:00Z'),
    });
    // NOTE: no message_templates row is seeded. The dispatcher resolves the
    // Content SID from serverEnv via the platform template contract, so a
    // missing/unseeded template row must NOT block the dispatch.

    // Set "now" to exactly when the early reminder should fire (24h before session)
    const now = new Date('2030-06-14T14:00:00Z');
    const emittedEvents: ReminderSendFanOutEvent[] = [];

    const deps: DispatcherDeps = {
      db: await getServiceDb(),
      now,
      sendEvents: (_stepId, events) => {
        emittedEvents.push(...events);
        return Promise.resolve();
      },
    };

    const result = await dispatchReminders(deps);

    expect(result.psychologistsScanned).toBe(1);
    expect(result.eventsEmitted).toBe(1);
    expect(emittedEvents).toHaveLength(1);

    const ev = emittedEvents[0]!;
    expect(ev.name).toBe('whatsapp/reminder.send');
    expect(ev.data.userId).toBe(userId);
    expect(ev.data.sessionId).toBe(sessionId);
    expect(ev.data.patientId).toBe(patientId);
    expect(ev.data.kind).toBe('early');
    expect(ev.data.templateKey).toBe('lembrete_24h');
    expect(ev.data.patientPhone).toBe('+5511988887777');
    // Content SID comes from serverEnv, not from message_templates.
    expect(ev.data.contentSid).toBe(serverEnv.TWILIO_CONTENT_SID_LEMBRETE_24H);
    expect(ev.data.idempotencyKey).toBe(generateIdempotencyKey(sessionId, 'early'));

    // Slimmed payload — no template body, confirmation link, value, location,
    // or duration (design D2).
    expect(ev.data).not.toHaveProperty('templateBody');
    expect(ev.data).not.toHaveProperty('confirmationLink');
    expect(ev.data).not.toHaveProperty('sessionValue');
    expect(ev.data).not.toHaveProperty('locationName');
    expect(ev.data).not.toHaveProperty('sessionDurationMinutes');
  });

  it('does NOT re-enqueue when idempotency key already exists in DB', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId);
    await seedReminderSettings(userId);
    await seedPatient(userId, patientId);

    const sessionStart = new Date('2026-06-15T14:00:00Z');
    await seedSession(userId, sessionId, sessionStart, { patientId });
    await seedTemplate(
      userId,
      'lembrete_24h',
      'Ola {nome_paciente}, lembrete da sessao.',
      'HX_content_sid_001',
    );

    // Pre-insert a whatsapp_message with the idempotency key (simulating prior send)
    const idempotencyKey = generateIdempotencyKey(sessionId, 'early');
    await runAsService(async (db) => {
      await db.insert(whatsappMessages).values({
        userId,
        patientId,
        sessionId,
        direction: 'outbound',
        idempotencyKey,
        status: 'sent',
      });
    });

    const now = new Date('2026-06-14T14:00:00Z');
    const emittedEvents: ReminderSendFanOutEvent[] = [];

    const deps: DispatcherDeps = {
      db: await getServiceDb(),
      now,
      sendEvents: (_stepId, events) => {
        emittedEvents.push(...events);
        return Promise.resolve();
      },
    };

    const result = await dispatchReminders(deps);

    expect(result.psychologistsScanned).toBe(1);
    // No events emitted because idempotency key already exists
    expect(result.eventsEmitted).toBe(0);
    expect(emittedEvents).toHaveLength(0);
  });

  it('does NOT enqueue for patient with whatsapp_opt_out=true', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId);
    await seedReminderSettings(userId);
    await seedPatient(userId, patientId, { whatsappOptOut: true });

    const sessionStart = new Date('2026-06-15T14:00:00Z');
    await seedSession(userId, sessionId, sessionStart, { patientId });
    await seedTemplate(
      userId,
      'lembrete_24h',
      'Ola {nome_paciente}, lembrete.',
      'HX_content_sid_001',
    );

    const now = new Date('2026-06-14T14:00:00Z');
    const emittedEvents: ReminderSendFanOutEvent[] = [];

    const deps: DispatcherDeps = {
      db: await getServiceDb(),
      now,
      sendEvents: (_stepId, events) => {
        emittedEvents.push(...events);
        return Promise.resolve();
      },
    };

    const result = await dispatchReminders(deps);

    expect(result.eventsEmitted).toBe(0);
    expect(emittedEvents).toHaveLength(0);
  });

  it('does NOT enqueue for session with reminders_disabled=true', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId);
    await seedReminderSettings(userId);
    await seedPatient(userId, patientId);

    const sessionStart = new Date('2026-06-15T14:00:00Z');
    await seedSession(userId, sessionId, sessionStart, {
      patientId,
      remindersDisabled: true,
    });
    await seedTemplate(
      userId,
      'lembrete_24h',
      'Ola {nome_paciente}, lembrete.',
      'HX_content_sid_001',
    );

    const now = new Date('2026-06-14T14:00:00Z');
    const emittedEvents: ReminderSendFanOutEvent[] = [];

    const deps: DispatcherDeps = {
      db: await getServiceDb(),
      now,
      sendEvents: (_stepId, events) => {
        emittedEvents.push(...events);
        return Promise.resolve();
      },
    };

    const result = await dispatchReminders(deps);

    expect(result.eventsEmitted).toBe(0);
    expect(emittedEvents).toHaveLength(0);
  });

  it('does NOT enqueue for account with status=error', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId, { status: 'error' });
    await seedReminderSettings(userId);
    await seedPatient(userId, patientId);

    const sessionStart = new Date('2026-06-15T14:00:00Z');
    await seedSession(userId, sessionId, sessionStart, { patientId });
    await seedTemplate(
      userId,
      'lembrete_24h',
      'Ola {nome_paciente}, lembrete.',
      'HX_content_sid_001',
    );

    const now = new Date('2026-06-14T14:00:00Z');
    const emittedEvents: ReminderSendFanOutEvent[] = [];

    const deps: DispatcherDeps = {
      db: await getServiceDb(),
      now,
      sendEvents: (_stepId, events) => {
        emittedEvents.push(...events);
        return Promise.resolve();
      },
    };

    const result = await dispatchReminders(deps);

    // Account with status='error' is not 'active', so not scanned
    expect(result.psychologistsScanned).toBe(0);
    expect(result.eventsEmitted).toBe(0);
  });

  it('does NOT enqueue for cancelled session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId);
    await seedReminderSettings(userId);
    await seedPatient(userId, patientId);

    const sessionStart = new Date('2026-06-15T14:00:00Z');
    await seedSession(userId, sessionId, sessionStart, {
      patientId,
      status: 'cancelled',
    });
    await seedTemplate(
      userId,
      'lembrete_24h',
      'Ola {nome_paciente}, lembrete.',
      'HX_content_sid_001',
    );

    const now = new Date('2026-06-14T14:00:00Z');
    const emittedEvents: ReminderSendFanOutEvent[] = [];

    const deps: DispatcherDeps = {
      db: await getServiceDb(),
      now,
      sendEvents: (_stepId, events) => {
        emittedEvents.push(...events);
        return Promise.resolve();
      },
    };

    const result = await dispatchReminders(deps);

    expect(result.eventsEmitted).toBe(0);
    expect(emittedEvents).toHaveLength(0);
  });

  it('emits both early and final reminders when both are due', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId);
    await seedReminderSettings(userId, {
      earlyReminderHours: 24,
      finalReminderHours: 2,
    });
    await seedPatient(userId, patientId);

    // Session at 14:00. "now" is 12:30 — both early (24h ago was 12:30 yesterday) and
    // final (2h before = 12:00) are due. Dates are pinned far in the future so the
    // real wall clock never overtakes the fixture; the explicit createdAt places
    // creation well before startAt so RN-04.03 does not suppress the early reminder.
    const sessionStart = new Date('2030-06-15T14:00:00Z');
    await seedSession(userId, sessionId, sessionStart, {
      patientId,
      createdAt: new Date('2030-06-10T12:00:00Z'),
    });
    await seedTemplate(userId, 'lembrete_24h', 'Ola {nome_paciente}', 'HX_early');
    await seedTemplate(userId, 'lembrete_2h', 'Ola {nome_paciente}, faltam 2h', 'HX_final');

    // Set "now" to 12:30 on session day — both early and final are past due
    const now = new Date('2030-06-15T12:30:00Z');
    const emittedEvents: ReminderSendFanOutEvent[] = [];

    const deps: DispatcherDeps = {
      db: await getServiceDb(),
      now,
      sendEvents: (_stepId, events) => {
        emittedEvents.push(...events);
        return Promise.resolve();
      },
    };

    const result = await dispatchReminders(deps);

    expect(result.eventsEmitted).toBe(2);
    expect(emittedEvents).toHaveLength(2);

    const kinds = emittedEvents.map((e) => e.data.kind).sort();
    expect(kinds).toEqual(['early', 'final']);
  });

  it('skips the video reminder when the session link is unavailable, then dispatches once the room appears', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const appUrl = 'https://app.hubrity.com';
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedWhatsappAccount(userId);
    // Only the video reminder is enabled, so this test isolates the video kind.
    await seedReminderSettings(userId, {
      earlyReminderHours: null,
      finalReminderHours: null,
      videoLinkMinutes: 30,
    });
    await seedPatient(userId, patientId);

    // Online session 30 min ahead of the video due time; "now" sits between the
    // video due time (13:30) and the start (14:00) so the video reminder is due.
    const sessionStart = new Date('2030-06-15T14:00:00Z');
    await seedSession(userId, sessionId, sessionStart, {
      patientId,
      modality: 'online',
      createdAt: new Date('2030-06-10T12:00:00Z'),
    });
    const now = new Date('2030-06-15T13:45:00Z');

    // Tick 1: no video_rooms row exists → the session link is unresolved, so
    // the dispatcher skips WITHOUT writing an idempotency record.
    const firstTick: ReminderSendFanOutEvent[] = [];
    const resultNoRoom = await dispatchReminders({
      db: await getServiceDb(),
      now,
      appUrl,
      sendEvents: (_stepId, events) => {
        firstTick.push(...events);
        return Promise.resolve();
      },
    });

    expect(resultNoRoom.eventsEmitted).toBe(0);
    expect(firstTick).toHaveLength(0);

    // No whatsapp_messages idempotency row was written → the next tick retries.
    const messagesAfterSkip = await runAsService(async (db) => {
      return db.select().from(whatsappMessages);
    });
    expect(messagesAfterSkip).toHaveLength(0);

    // Tick 2: the room (and its patient token) now exists → the link resolves
    // and the video reminder dispatches with the env Content SID + link.
    const patientToken = 'd'.repeat(64);
    await runAsService(async (db) => {
      await db.insert(videoRooms).values({
        userId,
        sessionId,
        streamCallId: `session-${sessionId}`,
        patientToken,
        patientJwt: 'fake-jwt-video-skip',
        availableFrom: new Date('2030-06-15T13:00:00Z'),
        expiresAt: new Date('2030-06-15T16:00:00Z'),
        status: 'pending',
      });
    });

    const secondTick: ReminderSendFanOutEvent[] = [];
    const resultWithRoom = await dispatchReminders({
      db: await getServiceDb(),
      now,
      appUrl,
      sendEvents: (_stepId, events) => {
        secondTick.push(...events);
        return Promise.resolve();
      },
    });

    expect(resultWithRoom.eventsEmitted).toBe(1);
    expect(secondTick).toHaveLength(1);
    const ev = secondTick[0]!;
    expect(ev.data.kind).toBe('video');
    expect(ev.data.templateKey).toBe('link_video');
    expect(ev.data.contentSid).toBe(serverEnv.TWILIO_CONTENT_SID_LINK_VIDEO);
    expect(ev.data.videoLink).toBe(`${appUrl}/v/${patientToken}`);
  });
});

// ---------------------------------------------------------------------------
// fetchVideoLink / fetchVideoLinksBatch
// ---------------------------------------------------------------------------

describe('fetchVideoLink()', () => {
  it('returns the correct patient video URL when a video_rooms row exists', async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const patientToken = 'a'.repeat(64);
    const appUrl = 'https://app.hubrity.com';

    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedSession(userId, sessionId, new Date('2026-06-15T14:00:00Z'));

    await runAsService(async (db) => {
      await db.insert(videoRooms).values({
        userId,
        sessionId,
        streamCallId: `session-${sessionId}`,
        patientToken,
        patientJwt: 'fake-jwt-for-test',
        availableFrom: new Date('2026-06-15T13:00:00Z'),
        expiresAt: new Date('2026-06-15T16:00:00Z'),
        status: 'pending',
      });
    });

    const db = await getServiceDb();
    const result = await fetchVideoLink(db, sessionId, appUrl);

    expect(result).toBe(`${appUrl}/v/${patientToken}`);
  });

  it('returns null when no video room exists for the session', async () => {
    const db = await getServiceDb();
    const result = await fetchVideoLink(db, randomUUID(), 'https://app.hubrity.com');

    expect(result).toBeNull();
  });

  it('returns null when appUrl is undefined', async () => {
    const db = await getServiceDb();
    const result = await fetchVideoLink(db, randomUUID(), undefined);

    expect(result).toBeNull();
  });
});

describe('fetchVideoLinksBatch()', () => {
  it('returns a Map with video URLs for all sessions that have rooms', async () => {
    const userId = randomUUID();
    const session1 = randomUUID();
    const session2 = randomUUID();
    const session3 = randomUUID();
    const token1 = 'b'.repeat(64);
    const token2 = 'c'.repeat(64);
    const appUrl = 'https://app.hubrity.com';

    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedSession(userId, session1, new Date('2026-06-15T14:00:00Z'));
    await seedSession(userId, session2, new Date('2026-06-15T15:00:00Z'));
    await seedSession(userId, session3, new Date('2026-06-15T16:00:00Z'));

    await runAsService(async (db) => {
      await db.insert(videoRooms).values([
        {
          userId,
          sessionId: session1,
          streamCallId: `session-${session1}`,
          patientToken: token1,
          patientJwt: 'fake-jwt-1',
          availableFrom: new Date('2026-06-15T13:00:00Z'),
          expiresAt: new Date('2026-06-15T16:00:00Z'),
          status: 'active',
        },
        {
          userId,
          sessionId: session2,
          streamCallId: `session-${session2}`,
          patientToken: token2,
          patientJwt: 'fake-jwt-2',
          availableFrom: new Date('2026-06-15T14:00:00Z'),
          expiresAt: new Date('2026-06-15T17:00:00Z'),
          status: 'pending',
        },
      ]);
    });

    const db = await getServiceDb();
    // session3 has no room — should be absent from the map
    const result = await fetchVideoLinksBatch(db, [session1, session2, session3], appUrl);

    expect(result.size).toBe(2);
    expect(result.get(session1)).toBe(`${appUrl}/v/${token1}`);
    expect(result.get(session2)).toBe(`${appUrl}/v/${token2}`);
    expect(result.has(session3)).toBe(false);
  });

  it('returns an empty Map when sessionIds array is empty', async () => {
    const db = await getServiceDb();
    const result = await fetchVideoLinksBatch(db, [], 'https://app.hubrity.com');

    expect(result.size).toBe(0);
  });

  it('returns an empty Map when appUrl is undefined', async () => {
    const db = await getServiceDb();
    const result = await fetchVideoLinksBatch(db, [randomUUID()], undefined);

    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Helper: get a DB connection for the dispatcher (bypasses RLS)
// ---------------------------------------------------------------------------

async function getServiceDb() {
  const { openClient } = await import('../setup/db');
  const { db } = openClient();
  return db;
}
