import { randomUUID } from 'node:crypto';

import { and, eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureSessionMetadata } from '@/modules/telepsicologia/server/capture-session-metadata';
import { getOnlineSessionStatsImpl } from '@/modules/telepsicologia/server/get-online-session-stats';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms, videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
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

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
      patientType: 'individual',
    });
  });
}

async function seedSession(
  userId: string,
  sessionId: string,
  patientId: string,
  opts?: { status?: string; modality?: string; startAt?: Date; endAt?: Date },
): Promise<void> {
  const now = opts?.startAt ?? new Date();
  const later = opts?.endAt ?? new Date(now.getTime() + 3600_000);
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt: now,
      endAt: later,
      durationMinutes: 50,
      modality: opts?.modality ?? 'online',
      status: opts?.status ?? 'done',
    });
  });
}

async function seedVideoRoom(
  userId: string,
  sessionId: string,
  opts?: { status?: string },
): Promise<string> {
  const roomId = randomUUID();
  const now = new Date();
  await runAsService(async (db) => {
    await db.insert(videoRooms).values({
      id: roomId,
      userId,
      sessionId,
      streamCallId: `session-${sessionId}`,
      patientToken: randomUUID().replace(/-/g, '').repeat(2),
      patientJwt: 'mock-patient-jwt',
      availableFrom: new Date(now.getTime() - 600_000),
      expiresAt: new Date(now.getTime() + 7200_000),
      status: opts?.status ?? 'ended',
    });
  });
  return roomId;
}

async function seedVideoLog(
  sessionId: string,
  userId: string,
  eventType: string,
  createdAt: Date,
  opts?: { participantRole?: string },
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(videoSessionLogs).values({
      sessionId,
      userId,
      eventType,
      participantRole: opts?.participantRole ?? null,
      createdAt,
    });
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as unknown as Parameters<typeof getOnlineSessionStatsImpl>[0];
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// captureSessionMetadata
// ---------------------------------------------------------------------------

describe('captureSessionMetadata', () => {
  it('computes correct metadata from session logs and inserts summary entry', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId, { status: 'done' });
    await seedVideoRoom(userId, sessionId, { status: 'ended' });

    // Seed realistic log timeline
    const baseTime = new Date('2025-06-15T14:00:00Z');
    const joinTime = new Date(baseTime.getTime() + 60_000); // +1 min
    const recordStart = new Date(baseTime.getTime() + 120_000); // +2 min
    const screenShareStart = new Date(baseTime.getTime() + 300_000); // +5 min
    const endTime = new Date(baseTime.getTime() + 3_000_000); // +50 min

    await seedVideoLog(sessionId, userId, 'therapist_joined', joinTime, {
      participantRole: 'therapist',
    });
    await seedVideoLog(sessionId, userId, 'recording_started', recordStart);
    await seedVideoLog(sessionId, userId, 'screen_share_started', screenShareStart);
    await seedVideoLog(sessionId, userId, 'room_ended', endTime);

    const result = await runAsService(async (serviceDb) => {
      return captureSessionMetadata(serviceDb, sessionId, userId);
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify computed metadata
    expect(result.metadata.realStart).toEqual(joinTime);
    expect(result.metadata.realEnd).toEqual(endTime);
    expect(result.metadata.effectiveDurationMs).toBe(endTime.getTime() - joinTime.getTime());
    expect(result.metadata.hadRecording).toBe(true);
    expect(result.metadata.hadScreenShare).toBe(true);

    // Verify session_summary log was inserted
    const summaryLogs = await runAsService(async (db) => {
      return db
        .select()
        .from(videoSessionLogs)
        .where(
          and(
            eq(videoSessionLogs.sessionId, sessionId),
            eq(videoSessionLogs.eventType, 'session_summary'),
          ),
        );
    });
    expect(summaryLogs).toHaveLength(1);

    const summaryMetadata = summaryLogs[0]!.metadata as Record<string, unknown>;
    expect(summaryMetadata.real_start).toBe(joinTime.toISOString());
    expect(summaryMetadata.real_end).toBe(endTime.toISOString());
    expect(summaryMetadata.effective_duration_ms).toBe(endTime.getTime() - joinTime.getTime());
    expect(summaryMetadata.had_recording).toBe(true);
    expect(summaryMetadata.had_screen_share).toBe(true);
  });

  it('handles session with no therapist_joined (null realStart)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId, { status: 'done' });
    await seedVideoRoom(userId, sessionId, { status: 'ended' });

    // Only seed a room_ended event — no therapist_joined
    const endTime = new Date('2025-06-15T15:00:00Z');
    await seedVideoLog(sessionId, userId, 'room_ended', endTime);

    const result = await runAsService(async (serviceDb) => {
      return captureSessionMetadata(serviceDb, sessionId, userId);
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.metadata.realStart).toBeNull();
    expect(result.metadata.realEnd).toEqual(endTime);
    // Duration is null because realStart is missing
    expect(result.metadata.effectiveDurationMs).toBeNull();
    expect(result.metadata.hadRecording).toBe(false);
    expect(result.metadata.hadScreenShare).toBe(false);
  });

  it('handles session with no logs (no events)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId, { status: 'done' });
    await seedVideoRoom(userId, sessionId, { status: 'ended' });

    const result = await runAsService(async (serviceDb) => {
      return captureSessionMetadata(serviceDb, sessionId, userId);
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.metadata.realStart).toBeNull();
    expect(result.metadata.realEnd).toBeNull();
    expect(result.metadata.effectiveDurationMs).toBeNull();
    expect(result.metadata.hadRecording).toBe(false);
    expect(result.metadata.hadScreenShare).toBe(false);

    // Summary log should still be inserted
    const summaryLogs = await runAsService(async (db) => {
      return db
        .select()
        .from(videoSessionLogs)
        .where(
          and(
            eq(videoSessionLogs.sessionId, sessionId),
            eq(videoSessionLogs.eventType, 'session_summary'),
          ),
        );
    });
    expect(summaryLogs).toHaveLength(1);
  });

  it('returns no_room when video room does not exist', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId, { status: 'done' });
    // No video room seeded

    const result = await runAsService(async (serviceDb) => {
      return captureSessionMetadata(serviceDb, sessionId, userId);
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_room');
  });

  it('does not capture metadata for another user (IDOR prevention)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);
    await seedSession(userA, sessionId, patientId, { status: 'done' });
    await seedVideoRoom(userA, sessionId, { status: 'ended' });

    // User B tries to capture metadata for user A's session
    const result = await runAsService(async (serviceDb) => {
      return captureSessionMetadata(serviceDb, sessionId, userB);
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_room');
  });

  it('picks the last room_ended when multiple end events exist', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId, { status: 'done' });
    await seedVideoRoom(userId, sessionId, { status: 'ended' });

    const joinTime = new Date('2025-06-15T14:00:00Z');
    const firstEnd = new Date('2025-06-15T14:50:00Z');
    const secondEnd = new Date('2025-06-15T14:55:00Z');

    await seedVideoLog(sessionId, userId, 'therapist_joined', joinTime, {
      participantRole: 'therapist',
    });
    await seedVideoLog(sessionId, userId, 'room_ended', firstEnd);
    await seedVideoLog(sessionId, userId, 'room_ended', secondEnd);

    const result = await runAsService(async (serviceDb) => {
      return captureSessionMetadata(serviceDb, sessionId, userId);
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Should pick the last (most recent) room_ended event
    expect(result.metadata.realEnd).toEqual(secondEnd);
    expect(result.metadata.effectiveDurationMs).toBe(secondEnd.getTime() - joinTime.getTime());
  });
});

// ---------------------------------------------------------------------------
// getOnlineSessionStatsImpl
// ---------------------------------------------------------------------------

describe('getOnlineSessionStatsImpl', () => {
  it('returns correct online/total counts and percentage for a month', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const monthStart = new Date('2025-06-01T00:00:00Z');
    const monthEnd = new Date('2025-07-01T00:00:00Z');

    // Seed 3 done sessions: 2 online, 1 in_person
    await seedSession(userId, randomUUID(), patientId, {
      status: 'done',
      modality: 'online',
      startAt: new Date('2025-06-05T10:00:00Z'),
      endAt: new Date('2025-06-05T11:00:00Z'),
    });
    await seedSession(userId, randomUUID(), patientId, {
      status: 'done',
      modality: 'online',
      startAt: new Date('2025-06-15T10:00:00Z'),
      endAt: new Date('2025-06-15T11:00:00Z'),
    });
    await seedSession(userId, randomUUID(), patientId, {
      status: 'done',
      modality: 'in_person',
      startAt: new Date('2025-06-20T10:00:00Z'),
      endAt: new Date('2025-06-20T11:00:00Z'),
    });
    // Session outside month range (should not be counted)
    await seedSession(userId, randomUUID(), patientId, {
      status: 'done',
      modality: 'online',
      startAt: new Date('2025-07-02T10:00:00Z'),
      endAt: new Date('2025-07-02T11:00:00Z'),
    });
    // Scheduled session in range (should not be counted — not done)
    await seedSession(userId, randomUUID(), patientId, {
      status: 'scheduled',
      modality: 'online',
      startAt: new Date('2025-06-25T10:00:00Z'),
      endAt: new Date('2025-06-25T11:00:00Z'),
    });

    const client = fakeSupabaseClient(userId);
    const result = await getOnlineSessionStatsImpl(client, {
      monthStart: monthStart.toISOString(),
      monthEnd: monthEnd.toISOString(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.stats.onlineCount).toBe(2);
    expect(result.stats.totalDoneCount).toBe(3);
    expect(result.stats.percentage).toBe(67); // Math.round(2/3 * 100) = 67
  });

  it('returns zero counts when no sessions exist in the month', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await getOnlineSessionStatsImpl(client, {
      monthStart: new Date('2025-06-01T00:00:00Z').toISOString(),
      monthEnd: new Date('2025-07-01T00:00:00Z').toISOString(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.stats.onlineCount).toBe(0);
    expect(result.stats.totalDoneCount).toBe(0);
    expect(result.stats.percentage).toBe(0);
  });

  it('rejects unauthenticated requests', async () => {
    const client = fakeSupabaseClient(null);
    const result = await getOnlineSessionStatsImpl(client, {
      monthStart: new Date('2025-06-01T00:00:00Z').toISOString(),
      monthEnd: new Date('2025-07-01T00:00:00Z').toISOString(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('rejects invalid input', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const client = fakeSupabaseClient(userId);
    const result = await getOnlineSessionStatsImpl(client, {
      monthStart: 'not-a-date',
      monthEnd: 'also-not-a-date',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
  });

  it('does not count sessions from other users (tenant isolation)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientA);
    await seedPatient(userB, patientB);

    const monthStart = new Date('2025-06-01T00:00:00Z');
    const monthEnd = new Date('2025-07-01T00:00:00Z');

    // User A has 1 online done session
    await seedSession(userA, randomUUID(), patientA, {
      status: 'done',
      modality: 'online',
      startAt: new Date('2025-06-10T10:00:00Z'),
      endAt: new Date('2025-06-10T11:00:00Z'),
    });
    // User B has 2 online done sessions
    await seedSession(userB, randomUUID(), patientB, {
      status: 'done',
      modality: 'online',
      startAt: new Date('2025-06-10T10:00:00Z'),
      endAt: new Date('2025-06-10T11:00:00Z'),
    });
    await seedSession(userB, randomUUID(), patientB, {
      status: 'done',
      modality: 'online',
      startAt: new Date('2025-06-12T10:00:00Z'),
      endAt: new Date('2025-06-12T11:00:00Z'),
    });

    // User A should only see their own 1 session
    const clientA = fakeSupabaseClient(userA);
    const resultA = await getOnlineSessionStatsImpl(clientA, {
      monthStart: monthStart.toISOString(),
      monthEnd: monthEnd.toISOString(),
    });

    expect(resultA.ok).toBe(true);
    if (!resultA.ok) return;
    expect(resultA.stats.onlineCount).toBe(1);
    expect(resultA.stats.totalDoneCount).toBe(1);
  });
});
