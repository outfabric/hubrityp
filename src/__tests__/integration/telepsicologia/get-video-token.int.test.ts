import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getVideoTokenImpl } from '@/modules/telepsicologia/server/get-video-token';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Mock Stream SDK — no real network calls
// ---------------------------------------------------------------------------

const mockGenerateCallToken = vi.fn().mockReturnValue('mock-psychologist-jwt-token');
const mockUpsertUsers = vi.fn().mockResolvedValue(undefined);

vi.mock('@/modules/telepsicologia/server/stream-client', () => ({
  getStreamClient: () => ({
    generateCallToken: mockGenerateCallToken,
    upsertUsers: mockUpsertUsers,
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

async function seedProfile(userId: string, fullName: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(profiles).values({
      userId,
      email: `test-${userId}@example.com`,
      fullName,
      crpNumber: '123456',
      crpUf: 'SP',
      status: 'active',
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      sensitiveDataConsentAt: new Date(),
    });
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
 * Seeds a video room row directly (bypassing the createVideoRoomImpl flow),
 * giving the test full control over the room's status and other fields.
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
  } as unknown as Parameters<typeof getVideoTokenImpl>[0];
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

describe('getVideoTokenImpl', () => {
  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns a psychologist JWT for a pending room', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dra. Ana Souza');
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, { status: 'pending' });

    const client = fakeSupabaseClient(userId);
    const result = await getVideoTokenImpl(client, { room_id: roomId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.token).toBe('mock-psychologist-jwt-token');

    // The psychologist's Stream user is refreshed with the current profile
    // name (scoped by the session's userId) before the token is minted.
    expect(mockUpsertUsers).toHaveBeenCalledOnce();
    expect(mockUpsertUsers).toHaveBeenCalledWith([{ id: userId, name: 'Dra. Ana Souza' }]);

    // upsertUsers MUST run before generateCallToken.
    const upsertOrder = mockUpsertUsers.mock.invocationCallOrder[0]!;
    const tokenOrder = mockGenerateCallToken.mock.invocationCallOrder[0]!;
    expect(upsertOrder).toBeLessThan(tokenOrder);

    // Verify the Stream SDK was called with the correct parameters
    expect(mockGenerateCallToken).toHaveBeenCalledOnce();
    const tokenArgs = mockGenerateCallToken.mock.calls[0]![0] as {
      user_id: string;
      call_cids: string[];
      role: string;
      validity_in_seconds: number;
    };
    expect(tokenArgs.user_id).toBe(userId);
    expect(tokenArgs.call_cids).toEqual([`default:session-${sessionId}`]);
    expect(tokenArgs.role).toBe('admin');
    expect(tokenArgs.validity_in_seconds).toBe(7200);
  });

  it('returns a psychologist JWT for an active room', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, { status: 'active' });

    const client = fakeSupabaseClient(userId);
    const result = await getVideoTokenImpl(client, { room_id: roomId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).toBe('mock-psychologist-jwt-token');
  });

  // -------------------------------------------------------------------------
  // Negative paths
  // -------------------------------------------------------------------------

  it('rejects unauthenticated requests', async () => {
    const client = fakeSupabaseClient(null);
    const result = await getVideoTokenImpl(client, { room_id: randomUUID() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');

    // No Stream SDK calls should have been made
    expect(mockGenerateCallToken).not.toHaveBeenCalled();
  });

  it('rejects invalid input (non-UUID room_id)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await getVideoTokenImpl(client, { room_id: 'not-a-uuid' });

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

    // User B tries to get a token for user A's room
    const client = fakeSupabaseClient(userB);
    const result = await getVideoTokenImpl(client, { room_id: roomId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('room_not_found');

    // No token should have been generated
    expect(mockGenerateCallToken).not.toHaveBeenCalled();
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
    const result = await getVideoTokenImpl(client, { room_id: roomId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('room_not_available');

    // No token should have been generated
    expect(mockGenerateCallToken).not.toHaveBeenCalled();
  });

  it('rejects ended room', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const roomId = await seedVideoRoom(userId, sessionId, { status: 'ended' });

    const client = fakeSupabaseClient(userId);
    const result = await getVideoTokenImpl(client, { room_id: roomId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('room_not_available');
  });

  it('rejects non-existent room_id', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await getVideoTokenImpl(client, { room_id: randomUUID() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('room_not_found');
  });

  // -------------------------------------------------------------------------
  // RLS cross-user isolation
  // -------------------------------------------------------------------------

  it('user B cannot see user A video room via RLS', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);
    await seedSession(userA, sessionId, patientId);

    await seedVideoRoom(userA, sessionId);

    // User A can see the room via RLS
    const rowsA = await runAsUser(userA, async (db) => {
      return db.select().from(videoRooms);
    });
    expect(rowsA).toHaveLength(1);

    // User B sees nothing via RLS
    const rowsB = await runAsUser(userB, async (db) => {
      return db.select().from(videoRooms);
    });
    expect(rowsB).toHaveLength(0);
  });
});
