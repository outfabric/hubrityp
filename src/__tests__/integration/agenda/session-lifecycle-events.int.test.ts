import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelSessionImpl } from '@/modules/agenda/server/cancel-session';
import { completeRescheduleImpl } from '@/modules/agenda/server/complete-reschedule';
import { confirmSessionImpl } from '@/modules/agenda/server/confirm-session';
import { markSessionDoneImpl } from '@/modules/agenda/server/mark-session-done';
import { markSessionNoShowImpl } from '@/modules/agenda/server/mark-session-no-show';
import { runMissingNoteReminder } from '@/modules/agenda/server/missing-note-reminder';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Mock Inngest client — intercept `inngest.send()` at the module level so the
// real Postgres path runs (Drizzle migrations applied via Testcontainers) but
// no outbound HTTP call leaves the test. `vi.hoisted()` makes the spy
// reference available when the hoisted `vi.mock()` factory executes.
// ---------------------------------------------------------------------------

const { mockInngestSend } = vi.hoisted(() => ({
  mockInngestSend: vi.fn(),
}));

vi.mock('@/modules/agenda/inngest/client', () => ({
  inngest: { send: mockInngestSend },
}));

// ---------------------------------------------------------------------------
// Types for inspecting the captured Inngest payloads
// ---------------------------------------------------------------------------

interface CapturedEvent {
  name: string;
  data: Record<string, unknown>;
}

function capturedEvents(): CapturedEvent[] {
  return mockInngestSend.mock.calls.map((call) => call[0] as CapturedEvent);
}

// ---------------------------------------------------------------------------
// Fixture helpers
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

async function seedPatient(userId: string, patientId: string, name: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: name,
      patientType: 'individual',
    });
  });
}

interface SeedSessionOptions {
  status?: string;
  /** Hours from now for `startAt` — positive = future, negative = past. */
  startHoursFromNow?: number;
  /** Days ago for `updatedAt` (used by the missing-note query). */
  daysAgoUpdated?: number;
  deletedAt?: Date | null;
}

/** Inserts a session row directly (bypasses Server Actions / conflict checks). */
async function seedSession(
  userId: string,
  patientId: string | null,
  options: SeedSessionOptions = {},
): Promise<string> {
  const {
    status = 'scheduled',
    startHoursFromNow = 48,
    daysAgoUpdated,
    deletedAt = null,
  } = options;
  const sessionId = randomUUID();
  const startAt = new Date(Date.now() + startHoursFromNow * 60 * 60 * 1000);
  const endAt = new Date(startAt.getTime() + 50 * 60 * 1000);

  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt,
      endAt,
      durationMinutes: 50,
      modality: 'online',
      status,
      ...(daysAgoUpdated !== undefined
        ? { updatedAt: new Date(Date.now() - daysAgoUpdated * 24 * 60 * 60 * 1000) }
        : {}),
      deletedAt,
    });
  });

  return sessionId;
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof confirmSessionImpl>[0];
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockInngestSend.mockResolvedValue({ ids: ['evt-mock'] });
});

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// (a) confirm session → agenda/session.confirmed
// ---------------------------------------------------------------------------

describe('agenda/session.confirmed — via real Postgres', () => {
  it('(a) emits agenda/session.confirmed after a scheduled session is confirmed', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Maria Silva');
    const sessionId = await seedSession(userId, patientId, { status: 'scheduled' });

    const result = await confirmSessionImpl(fakeSupabaseClient(userId), sessionId);

    expect(result.ok).toBe(true);
    expect(mockInngestSend).toHaveBeenCalledTimes(1);

    const [event] = capturedEvents();
    expect(event!.name).toBe('agenda/session.confirmed');
    expect(event!.data.sessionId).toBe(sessionId);
    expect(event!.data.patientId).toBe(patientId);
    expect(event!.data.userId).toBe(userId);
    expect(event!.data.confirmedBy).toBe('therapist');
    expect(event!.data.confirmedAt).toBeInstanceOf(Date);

    // The status change is persisted in real Postgres.
    const rows = await runAsService(async (db) =>
      db.select().from(sessions).where(eq(sessions.id, sessionId)),
    );
    expect(rows[0]!.status).toBe('confirmed');
  });
});

// ---------------------------------------------------------------------------
// (b) cancel session → agenda/session.cancelled (notice + reason)
// ---------------------------------------------------------------------------

describe('agenda/session.cancelled — via real Postgres', () => {
  it('(b) emits agenda/session.cancelled with notice "24h+" and the given reason', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Pedro Alves');
    // Session starts 48h from now → cancelling now is "24h+" notice.
    const sessionId = await seedSession(userId, patientId, {
      status: 'confirmed',
      startHoursFromNow: 48,
    });

    const result = await cancelSessionImpl(fakeSupabaseClient(userId), {
      sessionId,
      reason: 'patient_cancelled',
      cancelledBy: 'patient',
      chargeCancellation: false,
    });

    expect(result.ok).toBe(true);
    expect(mockInngestSend).toHaveBeenCalledTimes(1);

    const [event] = capturedEvents();
    expect(event!.name).toBe('agenda/session.cancelled');
    expect(event!.data.sessionId).toBe(sessionId);
    expect(event!.data.patientId).toBe(patientId);
    expect(event!.data.userId).toBe(userId);
    expect(event!.data.reason).toBe('patient_cancelled');
    expect(event!.data.cancelledBy).toBe('patient');
    expect(event!.data.notice).toBe('24h+');
    expect(event!.data.chargeApplied).toBe(false);
    expect(event!.data.cancelledAt).toBeInstanceOf(Date);
  });

  it('(b2) computes notice "less_1h" when cancelled shortly before start', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Lucia Mendes');
    // Session starts 30 minutes from now → cancelling now is "less_1h".
    const sessionId = await seedSession(userId, patientId, {
      status: 'confirmed',
      startHoursFromNow: 0.5,
    });

    const result = await cancelSessionImpl(fakeSupabaseClient(userId), {
      sessionId,
      reason: 'unforeseen',
      cancelledBy: 'therapist',
      chargeCancellation: true,
    });

    expect(result.ok).toBe(true);

    const [event] = capturedEvents();
    expect(event!.data.notice).toBe('less_1h');
    expect(event!.data.reason).toBe('unforeseen');
    expect(event!.data.chargeApplied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (c) mark done → agenda/session.done
// ---------------------------------------------------------------------------

describe('agenda/session.done — via real Postgres', () => {
  it('(c) emits agenda/session.done after a session is marked done', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Ana Costa');
    // A past, confirmed session is the natural candidate to be marked done.
    const sessionId = await seedSession(userId, patientId, {
      status: 'confirmed',
      startHoursFromNow: -2,
    });

    const result = await markSessionDoneImpl(fakeSupabaseClient(userId), sessionId);

    expect(result.ok).toBe(true);
    expect(mockInngestSend).toHaveBeenCalledTimes(1);

    const [event] = capturedEvents();
    expect(event!.name).toBe('agenda/session.done');
    expect(event!.data.sessionId).toBe(sessionId);
    expect(event!.data.patientId).toBe(patientId);
    expect(event!.data.userId).toBe(userId);
    expect(event!.data.doneAt).toBeInstanceOf(Date);

    const rows = await runAsService(async (db) =>
      db.select().from(sessions).where(eq(sessions.id, sessionId)),
    );
    expect(rows[0]!.status).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// (d) mark no-show → agenda/session.no_show
// ---------------------------------------------------------------------------

describe('agenda/session.no_show — via real Postgres', () => {
  it('(d) emits agenda/session.no_show after a session is marked no-show', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Fernando Lima');
    const sessionId = await seedSession(userId, patientId, {
      status: 'confirmed',
      startHoursFromNow: -2,
    });

    const result = await markSessionNoShowImpl(fakeSupabaseClient(userId), sessionId);

    expect(result.ok).toBe(true);
    expect(mockInngestSend).toHaveBeenCalledTimes(1);

    const [event] = capturedEvents();
    expect(event!.name).toBe('agenda/session.no_show');
    expect(event!.data.sessionId).toBe(sessionId);
    expect(event!.data.patientId).toBe(patientId);
    expect(event!.data.userId).toBe(userId);
    expect(event!.data.noShowAt).toBeInstanceOf(Date);

    const rows = await runAsService(async (db) =>
      db.select().from(sessions).where(eq(sessions.id, sessionId)),
    );
    expect(rows[0]!.status).toBe('no_show');
  });
});

// ---------------------------------------------------------------------------
// (e) complete reschedule → agenda/session.rescheduled (both session IDs)
// ---------------------------------------------------------------------------

describe('agenda/session.rescheduled — via real Postgres', () => {
  it('(e) emits agenda/session.rescheduled with both old and new session IDs', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Carla Souza');
    const oldSessionId = await seedSession(userId, patientId, {
      status: 'confirmed',
      startHoursFromNow: 48,
    });

    const newStartAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const result = await completeRescheduleImpl(fakeSupabaseClient(userId), oldSessionId, {
      patient_id: patientId,
      start_at: newStartAt,
      duration_minutes: 50,
      modality: 'online',
      force_conflict: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(mockInngestSend).toHaveBeenCalledTimes(1);

    const [event] = capturedEvents();
    expect(event!.name).toBe('agenda/session.rescheduled');
    expect(event!.data.oldSessionId).toBe(oldSessionId);
    expect(event!.data.newSessionId).toBe(result.newSessionId);
    expect(event!.data.patientId).toBe(patientId);
    expect(event!.data.userId).toBe(userId);
    expect(event!.data.rescheduledAt).toBeInstanceOf(Date);

    // Old session is cancelled and linked to the new one in real Postgres.
    const oldRows = await runAsService(async (db) =>
      db.select().from(sessions).where(eq(sessions.id, oldSessionId)),
    );
    expect(oldRows[0]!.status).toBe('cancelled');
    expect(oldRows[0]!.rescheduledToSessionId).toBe(result.newSessionId);

    const newRows = await runAsService(async (db) =>
      db.select().from(sessions).where(eq(sessions.id, result.newSessionId)),
    );
    expect(newRows[0]!.status).toBe('scheduled');
    expect(newRows[0]!.rescheduledFromSessionId).toBe(oldSessionId);
  });
});

// ---------------------------------------------------------------------------
// (f) missing-note reminder → batch agenda/session.missing_note_reminder
// ---------------------------------------------------------------------------

describe('agenda/session.missing_note_reminder — batch via real Postgres', () => {
  it('(f) emits one missing-note reminder per eligible done session', async () => {
    const userId = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientA, 'Patient A');
    await seedPatient(userId, patientB, 'Patient B');

    // Two eligible: done, updated > 7 days ago.
    const eligibleA = await seedSession(userId, patientA, {
      status: 'done',
      startHoursFromNow: -24 * 11,
      daysAgoUpdated: 10,
    });
    const eligibleB = await seedSession(userId, patientB, {
      status: 'done',
      startHoursFromNow: -24 * 15,
      daysAgoUpdated: 14,
    });
    // Not eligible: done but updated within 7 days.
    const recentDone = await seedSession(userId, patientA, {
      status: 'done',
      startHoursFromNow: -24 * 4,
      daysAgoUpdated: 3,
    });

    const result = await runMissingNoteReminder();

    const emitted = capturedEvents();
    const emittedIds = emitted.map((e) => e.data.sessionId);

    expect(emitted.every((e) => e.name === 'agenda/session.missing_note_reminder')).toBe(true);
    expect(emittedIds).toContain(eligibleA);
    expect(emittedIds).toContain(eligibleB);
    expect(emittedIds).not.toContain(recentDone);
    expect(result.sessionsNotified).toBe(emittedIds.length);

    const eventA = emitted.find((e) => e.data.sessionId === eligibleA);
    expect(eventA!.data.patientId).toBe(patientA);
    expect(eventA!.data.userId).toBe(userId);
    expect(typeof eventA!.data.daysSinceDone).toBe('number');
    expect(eventA!.data.daysSinceDone as number).toBeGreaterThanOrEqual(10);
    expect(eventA!.data.doneAt).toBeInstanceOf(Date);
  });
});
