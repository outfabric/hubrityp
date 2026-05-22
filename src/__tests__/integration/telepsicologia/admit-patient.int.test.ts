import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { admitPatientImpl } from '@/modules/telepsicologia/server/admit-patient';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms, videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Mock Stream SDK — admitPatient does not call Stream, but the module
// imports stream-client transitively via barrel; mock to prevent env errors.
// ---------------------------------------------------------------------------

vi.mock('@/modules/telepsicologia/server/stream-client', () => ({
  getStreamClient: () => ({}),
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
      status: opts?.status ?? 'pending',
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
  } as unknown as Parameters<typeof admitPatientImpl>[0];
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

describe('admitPatientImpl', () => {
  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('updates room status to active and logs patient_joined', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, { status: 'pending' });

    const client = fakeSupabaseClient(userId);
    const result = await admitPatientImpl(client, { room_id: roomId });

    expect(result.ok).toBe(true);

    // Verify room status was updated to 'active'
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.status).toBe('active');

    // Verify log entry was created
    const logs = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId));
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.eventType).toBe('patient_joined');
    expect(logs[0]!.participantRole).toBe('patient');
    expect(logs[0]!.userId).toBe(userId);
  });

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  it('returns ok when room is already active (idempotent)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, { status: 'active' });

    const client = fakeSupabaseClient(userId);
    const result = await admitPatientImpl(client, { room_id: roomId });

    expect(result.ok).toBe(true);

    // Room status should remain 'active'
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms[0]!.status).toBe('active');

    // No new log entry should have been created (idempotent skip)
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
    const result = await admitPatientImpl(client, { room_id: randomUUID() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('rejects invalid input (non-UUID room_id)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await admitPatientImpl(client, { room_id: 'not-a-uuid' });

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

    // User B tries to admit on user A's room
    const client = fakeSupabaseClient(userB);
    const result = await admitPatientImpl(client, { room_id: roomId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('room_not_found');
  });

  it('rejects non-existent room_id', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await admitPatientImpl(client, { room_id: randomUUID() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('room_not_found');
  });

  it('rejects ended room (cannot re-admit)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, { status: 'ended' });

    const client = fakeSupabaseClient(userId);
    const result = await admitPatientImpl(client, { room_id: roomId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('room_not_pending');
  });

  it('rejects expired room', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, { status: 'expired' });

    const client = fakeSupabaseClient(userId);
    const result = await admitPatientImpl(client, { room_id: roomId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('room_not_pending');
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

    const roomId = await seedVideoRoom(userA, sessionId, { status: 'pending' });

    // Admit as user A
    const client = fakeSupabaseClient(userA);
    await admitPatientImpl(client, { room_id: roomId });

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
