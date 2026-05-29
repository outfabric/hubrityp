/**
 * Integration test for the cascade room-cancellation core logic (task 6.2).
 *
 * Exercises `processSessionCancelled` against a real Postgres (Testcontainers +
 * Drizzle migrations + RLS) with a mocked Stream client. Focuses on the two
 * shapes called out by the spec for this task:
 *   - A pending room is cascaded to status 'expired' and a video_session_logs
 *     entry with eventType 'room_expired' is written.
 *   - The no-room-found path returns skipped/no_room without touching Stream.
 *
 * Broader behaviors (active rooms, Stream-failure resilience, IDOR scoping) are
 * covered in cancel-room-on-session-cancel.int.test.ts; this file pins the
 * cascade contract specific to the recording/scheduling fix.
 */

import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
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

function makeDeps(): CancelRoomOnSessionCancelDeps {
  const { db } = openClient();
  return {
    db,
    getStreamClient: () => mockStreamClient,
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
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt: now,
      endAt: new Date(now.getTime() + 3600_000),
      durationMinutes: 50,
      modality: 'online',
      status: 'cancelled',
    });
  });
}

let tokenCounter = 0;

function uniquePatientToken(): string {
  tokenCounter++;
  return tokenCounter.toString(16).padStart(4, '0').repeat(16);
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

describe('cancel-room-cascade: room present', () => {
  it('cascades a pending room to expired and logs room_expired', async () => {
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
});

describe('cancel-room-cascade: no room found', () => {
  it('returns skipped/no_room and does not touch Stream when no room exists', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const result = await processSessionCancelled({ sessionId, userId }, makeDeps());

    expect(result).toEqual({ action: 'skipped', reason: 'no_room' });
    expect(mockEnd).not.toHaveBeenCalled();

    const logs = await runAsService(async (db) =>
      db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId)),
    );
    expect(logs).toHaveLength(0);
  });
});
