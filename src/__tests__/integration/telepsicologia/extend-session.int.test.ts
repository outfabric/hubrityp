import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { extendSessionImpl } from '@/modules/telepsicologia/server/extend-session';
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

async function seedVideoRoom(
  userId: string,
  sessionId: string,
  opts?: { status?: string },
): Promise<{ roomId: string; expiresAt: Date }> {
  const roomId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7200_000);
  await runAsService(async (db) => {
    await db.insert(videoRooms).values({
      id: roomId,
      userId,
      sessionId,
      streamCallId: `session-${sessionId}`,
      patientToken: randomUUID().replace(/-/g, '').repeat(2),
      patientJwt: 'mock-patient-jwt',
      availableFrom: new Date(now.getTime() - 600_000),
      expiresAt,
      status: opts?.status ?? 'active',
    });
  });
  return { roomId, expiresAt };
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
  } as unknown as Parameters<typeof extendSessionImpl>[0];
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

describe('extendSessionImpl', () => {
  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('extends expires_at by 15 minutes and logs session_extended event', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    const { roomId, expiresAt: originalExpiresAt } = await seedVideoRoom(userId, sessionId, {
      status: 'active',
    });

    const client = fakeSupabaseClient(userId);
    const result = await extendSessionImpl(client, { room_id: roomId });

    expect(result.ok).toBe(true);

    // Verify expires_at was extended by 15 minutes
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms).toHaveLength(1);
    const newExpiresAt = rooms[0]!.expiresAt;
    const expectedExpiresAt = new Date(originalExpiresAt.getTime() + 15 * 60 * 1000);
    // Allow 2-second tolerance for timestamp comparison
    expect(Math.abs(newExpiresAt.getTime() - expectedExpiresAt.getTime())).toBeLessThan(2000);

    // Verify log entry was created
    const logs = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId));
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.eventType).toBe('session_extended');
    expect(logs[0]!.userId).toBe(userId);
  });

  // -------------------------------------------------------------------------
  // Negative paths
  // -------------------------------------------------------------------------

  it('rejects unauthenticated requests', async () => {
    const client = fakeSupabaseClient(null);
    const result = await extendSessionImpl(client, { room_id: randomUUID() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHENTICATED');
  });

  it('rejects when room is not active (e.g., pending)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    const { roomId } = await seedVideoRoom(userId, sessionId, { status: 'pending' });

    const client = fakeSupabaseClient(userId);
    const result = await extendSessionImpl(client, { room_id: roomId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ROOM_NOT_ACTIVE');
  });

  it('rejects when room is ended', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    const { roomId } = await seedVideoRoom(userId, sessionId, { status: 'ended' });

    const client = fakeSupabaseClient(userId);
    const result = await extendSessionImpl(client, { room_id: roomId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ROOM_NOT_ACTIVE');
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
    const { roomId } = await seedVideoRoom(userA, sessionId, { status: 'active' });

    // User B tries to extend user A's room
    const client = fakeSupabaseClient(userB);
    const result = await extendSessionImpl(client, { room_id: roomId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ROOM_NOT_FOUND');
  });

  it('rejects non-existent room_id', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await extendSessionImpl(client, { room_id: randomUUID() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ROOM_NOT_FOUND');
  });

  it('rejects invalid input (non-UUID room_id)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await extendSessionImpl(client, { room_id: 'not-a-uuid' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
  });
});
