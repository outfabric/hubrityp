import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  processRoomExpiry,
  type RoomExpiryDeps,
} from '@/modules/telepsicologia/inngest/room-expiry';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms, videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Mock Stream SDK — no real network calls
// ---------------------------------------------------------------------------

const mockEnd = vi.fn().mockResolvedValue({});

const mockStreamClient = {
  video: {
    call: () => ({
      end: mockEnd,
    }),
  },
};

vi.mock('@/modules/telepsicologia/server/stream-client', () => ({
  getStreamClient: () => mockStreamClient,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(): RoomExpiryDeps {
  const { db } = openClient();
  return {
    db,
    getStreamClient: () => mockStreamClient,
  };
}

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

async function seedSession(userId: string, sessionId: string, patientId: string): Promise<void> {
  const now = new Date();
  const later = new Date(now.getTime() + 3600_000);
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt: now,
      endAt: later,
      durationMinutes: 50,
      modality: 'online',
      status: 'scheduled',
    });
  });
}

/** Counter to generate unique 64-char patient tokens per room. */
let tokenCounter = 0;

function uniquePatientToken(): string {
  tokenCounter++;
  const base = tokenCounter.toString(16).padStart(4, '0');
  return base.repeat(16);
}

async function seedVideoRoom(
  userId: string,
  sessionId: string,
  opts?: {
    status?: string;
    streamCallId?: string;
    expiresAt?: Date;
    availableFrom?: Date;
  },
): Promise<string> {
  const roomId = randomUUID();
  const streamCallId = opts?.streamCallId ?? `session-${sessionId}`;
  const now = new Date();
  await runAsService(async (db) => {
    await db.insert(videoRooms).values({
      id: roomId,
      userId,
      sessionId,
      streamCallId,
      patientToken: uniquePatientToken(),
      patientJwt: 'mock-patient-jwt',
      availableFrom: opts?.availableFrom ?? new Date(now.getTime() - 600_000),
      expiresAt: opts?.expiresAt ?? new Date(now.getTime() + 7200_000),
      status: opts?.status ?? 'pending',
    });
  });
  return roomId;
}

async function seedSessionLog(
  sessionId: string,
  userId: string,
  eventType: string,
  createdAt?: Date,
): Promise<void> {
  await runAsService(async (db) => {
    if (createdAt) {
      // Use raw SQL to set a specific created_at (bypasses column default)
      await db.execute(
        dsql`INSERT INTO video_session_logs (id, session_id, user_id, event_type, created_at)
             VALUES (${randomUUID()}, ${sessionId}, ${userId}, ${eventType}, ${createdAt.toISOString()}::timestamptz)`,
      );
    } else {
      await db.insert(videoSessionLogs).values({
        sessionId,
        userId,
        eventType,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  tokenCounter = 0;
});

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Tests — time-based expiry
// ---------------------------------------------------------------------------

describe('room-expiry cron: time-based expiry', () => {
  it('expires a pending room past its expires_at', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, {
      status: 'pending',
      expiresAt: new Date(Date.now() - 60_000), // 1 min in the past
    });

    const deps = makeDeps();
    const result = await processRoomExpiry(deps);

    expect(result.timeExpiredCount).toBe(1);
    expect(result.emptyExpiredCount).toBe(0);

    // Verify room status is 'expired'
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.status).toBe('expired');

    // Verify log entry was created
    const logs = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId));
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.eventType).toBe('room_expired');
    expect(logs[0]!.userId).toBe(userId);

    // Verify Stream call.end() was called
    expect(mockEnd).toHaveBeenCalledOnce();
  });

  it('expires an active room past its expires_at', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, {
      status: 'active',
      expiresAt: new Date(Date.now() - 120_000), // 2 min in the past
    });

    const deps = makeDeps();
    const result = await processRoomExpiry(deps);

    expect(result.timeExpiredCount).toBe(1);

    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms[0]!.status).toBe('expired');
  });

  it('skips rooms not yet expired', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, {
      status: 'active',
      expiresAt: new Date(Date.now() + 3600_000), // 1 hour in the future
    });

    const deps = makeDeps();
    const result = await processRoomExpiry(deps);

    expect(result.timeExpiredCount).toBe(0);

    // Room should still be active
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms[0]!.status).toBe('active');
  });

  it('skips already-ended rooms', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    await seedVideoRoom(userId, sessionId, {
      status: 'ended',
      expiresAt: new Date(Date.now() - 60_000), // past, but already ended
    });

    const deps = makeDeps();
    const result = await processRoomExpiry(deps);

    expect(result.timeExpiredCount).toBe(0);
    expect(result.emptyExpiredCount).toBe(0);

    // Stream should NOT be called
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it('skips already-expired rooms', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    await seedVideoRoom(userId, sessionId, {
      status: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const deps = makeDeps();
    const result = await processRoomExpiry(deps);

    expect(result.timeExpiredCount).toBe(0);
    expect(result.emptyExpiredCount).toBe(0);
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it('continues processing when Stream end() throws (non-fatal)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, {
      status: 'pending',
      expiresAt: new Date(Date.now() - 60_000),
    });

    // Make Stream throw
    mockEnd.mockRejectedValueOnce(new Error('Call already ended'));

    const deps = makeDeps();
    const result = await processRoomExpiry(deps);

    expect(result.timeExpiredCount).toBe(1);
    expect(result.streamErrors).toBe(1);

    // Room should still be marked expired despite Stream error
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms[0]!.status).toBe('expired');
  });
});

// ---------------------------------------------------------------------------
// Tests — empty-for-5min expiry
// ---------------------------------------------------------------------------

describe('room-expiry cron: empty-for-5min expiry', () => {
  it('expires an active room where last participant left > 5 min ago', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, {
      status: 'active',
      expiresAt: new Date(Date.now() + 3600_000), // not time-expired
    });

    // Seed participant events: joined, then left 10 min ago
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
    await seedSessionLog(sessionId, userId, 'therapist_joined', fifteenMinAgo);
    await seedSessionLog(sessionId, userId, 'therapist_left', tenMinAgo);

    const deps = makeDeps();
    const result = await processRoomExpiry(deps);

    expect(result.timeExpiredCount).toBe(0);
    expect(result.emptyExpiredCount).toBe(1);

    // Verify room status is 'expired'
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms[0]!.status).toBe('expired');

    // Verify log entry
    const logs = await runAsService(async (db) => {
      return db
        .select()
        .from(videoSessionLogs)
        .where(eq(videoSessionLogs.eventType, 'room_expired'));
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.sessionId).toBe(sessionId);
  });

  it('does NOT expire an active room where last event is *_joined', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, {
      status: 'active',
      expiresAt: new Date(Date.now() + 3600_000),
    });

    // Last event is a join — room is NOT empty
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    await seedSessionLog(sessionId, userId, 'therapist_joined', tenMinAgo);

    const deps = makeDeps();
    const result = await processRoomExpiry(deps);

    expect(result.emptyExpiredCount).toBe(0);

    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms[0]!.status).toBe('active');
  });

  it('does NOT expire when last participant left < 5 min ago', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, {
      status: 'active',
      expiresAt: new Date(Date.now() + 3600_000),
    });

    // Last participant left 2 min ago — not yet empty long enough
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    await seedSessionLog(sessionId, userId, 'therapist_joined', tenMinAgo);
    await seedSessionLog(sessionId, userId, 'therapist_left', twoMinAgo);

    const deps = makeDeps();
    const result = await processRoomExpiry(deps);

    expect(result.emptyExpiredCount).toBe(0);

    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms[0]!.status).toBe('active');
  });

  it('does NOT expire a pending room (only active rooms checked)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, {
      status: 'pending',
      expiresAt: new Date(Date.now() + 3600_000),
    });

    // Even with an old left event, pending rooms are not checked for emptiness
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    await seedSessionLog(sessionId, userId, 'therapist_left', tenMinAgo);

    const deps = makeDeps();
    const result = await processRoomExpiry(deps);

    expect(result.emptyExpiredCount).toBe(0);

    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms[0]!.status).toBe('pending');
  });

  it('handles re-join scenario: left then joined again is NOT empty', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, {
      status: 'active',
      expiresAt: new Date(Date.now() + 3600_000),
    });

    // Sequence: joined -> left -> joined again (most recent is a join)
    const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000);
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    await seedSessionLog(sessionId, userId, 'therapist_joined', twentyMinAgo);
    await seedSessionLog(sessionId, userId, 'therapist_left', fifteenMinAgo);
    await seedSessionLog(sessionId, userId, 'therapist_joined', tenMinAgo);

    const deps = makeDeps();
    const result = await processRoomExpiry(deps);

    expect(result.emptyExpiredCount).toBe(0);

    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms[0]!.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Tests — edge cases and combined scenarios
// ---------------------------------------------------------------------------

describe('room-expiry cron: combined and edge cases', () => {
  it('returns zero counts when no rooms exist', async () => {
    const deps = makeDeps();
    const result = await processRoomExpiry(deps);

    expect(result.timeExpiredCount).toBe(0);
    expect(result.emptyExpiredCount).toBe(0);
    expect(result.streamErrors).toBe(0);
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it('does not double-expire a room that is both time-expired and empty', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, {
      status: 'active',
      expiresAt: new Date(Date.now() - 60_000), // time-expired
    });

    // Also empty for > 5 min
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    await seedSessionLog(sessionId, userId, 'therapist_left', tenMinAgo);

    const deps = makeDeps();
    const result = await processRoomExpiry(deps);

    // Should be caught by time-based expiry first, and NOT by empty check
    // because the room is already 'expired' by the time empty check runs.
    expect(result.timeExpiredCount).toBe(1);
    expect(result.emptyExpiredCount).toBe(0);

    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms[0]!.status).toBe('expired');

    // Only one room_expired log should exist (not two)
    const logs = await runAsService(async (db) => {
      return db
        .select()
        .from(videoSessionLogs)
        .where(eq(videoSessionLogs.eventType, 'room_expired'));
    });
    expect(logs).toHaveLength(1);
  });
});
