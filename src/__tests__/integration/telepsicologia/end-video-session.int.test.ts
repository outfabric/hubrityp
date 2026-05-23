import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { endVideoSessionImpl } from '@/modules/telepsicologia/server/end-video-session';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms, videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Mock Stream SDK — no real network calls
// ---------------------------------------------------------------------------

const mockEnd = vi.fn().mockResolvedValue({});

vi.mock('@/modules/telepsicologia/server/stream-client', () => ({
  getStreamClient: () => ({
    video: {
      call: () => ({
        end: mockEnd,
      }),
    },
  }),
}));

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
  opts?: { status?: string },
): Promise<void> {
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
      status: opts?.status ?? 'scheduled',
    });
  });
}

/**
 * Seeds a video room row directly, giving the test full control over
 * the room's status and other fields.
 */
async function seedVideoRoom(
  userId: string,
  sessionId: string,
  opts?: { status?: string; streamCallId?: string },
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
      patientToken: 'a'.repeat(64),
      patientJwt: 'mock-patient-jwt',
      availableFrom: new Date(now.getTime() - 600_000),
      expiresAt: new Date(now.getTime() + 7200_000),
      status: opts?.status ?? 'active',
    });
  });
  return roomId;
}

/**
 * Build a minimal fake Supabase client that returns a specific user for
 * `auth.getUser()`. Isolates the server action logic from real Supabase Auth.
 */
function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as unknown as Parameters<typeof endVideoSessionImpl>[0];
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
// Tests
// ---------------------------------------------------------------------------

describe('endVideoSessionImpl', () => {
  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('ends Stream call, updates room + session status, and logs event', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, { status: 'active' });

    const client = fakeSupabaseClient(userId);
    const result = await endVideoSessionImpl(client, { room_id: roomId });

    expect(result.ok).toBe(true);

    // Verify Stream call.end() was called
    expect(mockEnd).toHaveBeenCalledOnce();

    // Verify room status was updated to 'ended'
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.status).toBe('ended');

    // Verify session status was updated to 'done'
    const sessionRows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]!.status).toBe('done');

    // Verify log entry was created
    const logs = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId));
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.eventType).toBe('room_ended');
    expect(logs[0]!.userId).toBe(userId);
  });

  it('ends a pending room (not just active)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, { status: 'pending' });

    const client = fakeSupabaseClient(userId);
    const result = await endVideoSessionImpl(client, { room_id: roomId });

    expect(result.ok).toBe(true);

    // Room should be ended
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms[0]!.status).toBe('ended');
  });

  it('succeeds even if Stream call.end() throws (graceful degradation)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, { status: 'active' });

    // Make Stream call.end() throw (simulates already-ended call)
    mockEnd.mockRejectedValueOnce(new Error('Call already ended'));

    const client = fakeSupabaseClient(userId);
    const result = await endVideoSessionImpl(client, { room_id: roomId });

    // Should still succeed — Stream error is caught and logged
    expect(result.ok).toBe(true);

    // DB should still be updated
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms[0]!.status).toBe('ended');
  });

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  it('returns ok when room is already ended (idempotent)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, { status: 'ended' });

    const client = fakeSupabaseClient(userId);
    const result = await endVideoSessionImpl(client, { room_id: roomId });

    expect(result.ok).toBe(true);

    // Stream should NOT be called for an already-ended room
    expect(mockEnd).not.toHaveBeenCalled();

    // No log entry should have been created (idempotent skip)
    const logs = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId));
    });
    expect(logs).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Negative paths
  // -------------------------------------------------------------------------

  it('rejects unauthenticated requests', async () => {
    const client = fakeSupabaseClient(null);
    const result = await endVideoSessionImpl(client, { room_id: randomUUID() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');

    // No Stream calls should have been made
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it('rejects invalid input (non-UUID room_id)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await endVideoSessionImpl(client, { room_id: 'not-a-uuid' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
  });

  it('rejects room not owned by user (IDOR prevention)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);
    await seedSession(userA, sessionId, patientId);

    const roomId = await seedVideoRoom(userA, sessionId);

    // User B tries to end user A's room
    const client = fakeSupabaseClient(userB);
    const result = await endVideoSessionImpl(client, { room_id: roomId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('room_not_found');

    // No Stream or DB operations should have occurred
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it('rejects non-existent room_id', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await endVideoSessionImpl(client, { room_id: randomUUID() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('room_not_found');
  });

  // -------------------------------------------------------------------------
  // RLS cross-user isolation
  // -------------------------------------------------------------------------

  it('user B cannot see user A video session logs via RLS', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);
    await seedSession(userA, sessionId, patientId);

    const roomId = await seedVideoRoom(userA, sessionId, { status: 'active' });

    // End session as user A
    const client = fakeSupabaseClient(userA);
    await endVideoSessionImpl(client, { room_id: roomId });

    // User A can see the log via RLS
    const logsA = await runAsUser(userA, async (db) => {
      return db.select().from(videoSessionLogs);
    });
    expect(logsA).toHaveLength(1);

    // User B sees nothing via RLS
    const logsB = await runAsUser(userB, async (db) => {
      return db.select().from(videoSessionLogs);
    });
    expect(logsB).toHaveLength(0);
  });
});
