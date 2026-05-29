/**
 * Integration tests for the cascade room-cancellation logic.
 *
 * Exercises `processSessionCancelled` against a real Postgres (Testcontainers +
 * Drizzle migrations + RLS), verifying the three behaviors from the spec:
 *   - Room exists (pending/active) → Stream call ended, status='expired', log inserted.
 *   - No room exists → returns { action: 'skipped', reason: 'no_room' }.
 *   - Stream .end() fails → DB cleanup still happens (status='expired', log inserted).
 *
 * The function is also scoped by user_id: a forged event with a different
 * userId must NOT touch the room.
 */

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  processSessionCancelled,
  type CancelRoomOnSessionCancelDeps,
} from '@/modules/telepsicologia/inngest/cancel-room-on-session-cancel';
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

function makeDeps(
  overrides?: Partial<CancelRoomOnSessionCancelDeps>,
): CancelRoomOnSessionCancelDeps {
  const { db } = openClient();
  return {
    db,
    getStreamClient: () => mockStreamClient,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Seed helpers
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
      status: 'cancelled',
    });
  });
}

let tokenCounter = 0;

function uniquePatientToken(): string {
  tokenCounter++;
  const base = tokenCounter.toString(16).padStart(4, '0');
  return base.repeat(16);
}

async function seedVideoRoom(userId: string, sessionId: string, status: string): Promise<string> {
  const roomId = randomUUID();
  const now = new Date();
  await runAsService(async (db) => {
    await db.insert(videoRooms).values({
      id: roomId,
      userId,
      sessionId,
      streamCallId: `session-${sessionId}`,
      patientToken: uniquePatientToken(),
      patientJwt: 'mock-patient-jwt',
      availableFrom: new Date(now.getTime() - 600_000),
      expiresAt: new Date(now.getTime() + 7200_000),
      status,
    });
  });
  return roomId;
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
// Tests
// ---------------------------------------------------------------------------

describe('cancel-room-on-session-cancel: room exists', () => {
  it('expires a pending room: ends Stream call, sets status=expired, inserts log', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    const roomId = await seedVideoRoom(userId, sessionId, 'pending');

    const result = await processSessionCancelled({ sessionId, userId }, makeDeps());

    expect(result).toEqual({ action: 'expired_room', roomId });
    expect(mockEnd).toHaveBeenCalledOnce();

    const rooms = await runAsService(async (db) =>
      db.select().from(videoRooms).where(eq(videoRooms.id, roomId)),
    );
    expect(rooms[0]!.status).toBe('expired');

    const logs = await runAsService(async (db) =>
      db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId)),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]!.eventType).toBe('room_expired');
    expect(logs[0]!.userId).toBe(userId);
  });

  it('expires an active room', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    const roomId = await seedVideoRoom(userId, sessionId, 'active');

    const result = await processSessionCancelled({ sessionId, userId }, makeDeps());

    expect(result).toEqual({ action: 'expired_room', roomId });

    const rooms = await runAsService(async (db) =>
      db.select().from(videoRooms).where(eq(videoRooms.id, roomId)),
    );
    expect(rooms[0]!.status).toBe('expired');
  });
});

describe('cancel-room-on-session-cancel: no cleanable room', () => {
  it('returns skipped/no_room when no room exists for the session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    // No room seeded.

    const result = await processSessionCancelled({ sessionId, userId }, makeDeps());

    expect(result).toEqual({ action: 'skipped', reason: 'no_room' });
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it('returns skipped/no_room when the only room is already ended', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    await seedVideoRoom(userId, sessionId, 'ended');

    const result = await processSessionCancelled({ sessionId, userId }, makeDeps());

    expect(result).toEqual({ action: 'skipped', reason: 'no_room' });
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it('does not touch a room owned by a different user (IDOR guard)', async () => {
    const ownerId = randomUUID();
    const attackerId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(ownerId);
    await seedAuthUser(attackerId);
    await seedPatient(ownerId, patientId);
    await seedSession(ownerId, sessionId, patientId);
    const roomId = await seedVideoRoom(ownerId, sessionId, 'pending');

    // Forged event: correct sessionId but the wrong userId.
    const result = await processSessionCancelled({ sessionId, userId: attackerId }, makeDeps());

    expect(result).toEqual({ action: 'skipped', reason: 'no_room' });
    expect(mockEnd).not.toHaveBeenCalled();

    const rooms = await runAsService(async (db) =>
      db.select().from(videoRooms).where(eq(videoRooms.id, roomId)),
    );
    expect(rooms[0]!.status).toBe('pending');
  });
});

describe('cancel-room-on-session-cancel: Stream failure', () => {
  it('still expires the room and logs when Stream .end() throws', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    const roomId = await seedVideoRoom(userId, sessionId, 'active');

    const throwingStreamClient = {
      video: {
        call: () => ({
          end: vi.fn().mockRejectedValue(new Error('Stream unavailable')),
        }),
      },
    };
    const onStreamError = vi.fn();

    const result = await processSessionCancelled(
      { sessionId, userId },
      makeDeps({ getStreamClient: () => throwingStreamClient, onStreamError }),
    );

    expect(result).toEqual({ action: 'expired_room', roomId });
    expect(onStreamError).toHaveBeenCalledOnce();

    const rooms = await runAsService(async (db) =>
      db.select().from(videoRooms).where(eq(videoRooms.id, roomId)),
    );
    expect(rooms[0]!.status).toBe('expired');

    const logs = await runAsService(async (db) =>
      db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId)),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]!.eventType).toBe('room_expired');
  });
});
