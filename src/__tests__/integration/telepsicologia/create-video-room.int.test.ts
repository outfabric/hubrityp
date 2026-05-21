import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVideoRoomImpl } from '@/modules/telepsicologia/server/create-video-room';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Mock Stream SDK — no real network calls
// ---------------------------------------------------------------------------

const mockGetOrCreate = vi.fn().mockResolvedValue({ call: { cid: 'default:mock-call' } });
const mockGenerateCallToken = vi.fn().mockReturnValue('mock-patient-jwt-token');

vi.mock('@/modules/telepsicologia/server/stream-client', () => ({
  getStreamClient: () => ({
    video: {
      call: () => ({
        getOrCreate: mockGetOrCreate,
      }),
    },
    generateCallToken: mockGenerateCallToken,
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

async function seedPatient(
  userId: string,
  patientId: string,
  opts?: { patientType?: string },
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
      patientType: opts?.patientType ?? 'individual',
    });
  });
}

async function seedSession(
  userId: string,
  sessionId: string,
  patientId: string,
  opts?: { modality?: string; status?: string },
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
      modality: opts?.modality ?? 'online',
      status: opts?.status ?? 'scheduled',
    });
  });
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
  } as unknown as Parameters<typeof createVideoRoomImpl>[0];
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

describe('createVideoRoomImpl', () => {
  it('creates a video room for an online scheduled session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await createVideoRoomImpl(client, { session_id: sessionId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify the room shape
    expect(result.room.userId).toBe(userId);
    expect(result.room.sessionId).toBe(sessionId);
    expect(result.room.streamCallId).toBe(`session-${sessionId}`);
    expect(result.room.patientToken).toMatch(/^[0-9a-f]{64}$/);
    expect(result.room.patientJwt).toBe('mock-patient-jwt-token');
    expect(result.room.status).toBe('pending');
    expect(result.room.availableFrom).toBeInstanceOf(Date);
    expect(result.room.expiresAt).toBeInstanceOf(Date);

    // Verify DB row
    const rows = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.sessionId, sessionId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);

    // Verify Stream SDK calls
    expect(mockGetOrCreate).toHaveBeenCalledOnce();
    expect(mockGenerateCallToken).toHaveBeenCalledOnce();

    // Verify patient JWT is call-scoped
    const tokenCall = mockGenerateCallToken.mock.calls[0]![0] as {
      user_id: string;
      call_cids: string[];
    };
    expect(tokenCall.user_id).toBe(`patient-${patientId}`);
    expect(tokenCall.call_cids).toEqual([`default:session-${sessionId}`]);
  });

  it('creates a video room for a confirmed session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId, { status: 'confirmed' });

    const client = fakeSupabaseClient(userId);
    const result = await createVideoRoomImpl(client, { session_id: sessionId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room.sessionId).toBe(sessionId);
  });

  it('sets max_participants to 3 for couple patients', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, { patientType: 'couple' });
    await seedSession(userId, sessionId, patientId);

    const client = fakeSupabaseClient(userId);
    const result = await createVideoRoomImpl(client, { session_id: sessionId });

    expect(result.ok).toBe(true);

    // Verify Stream call was created with max_participants=3
    const createCallArgs = mockGetOrCreate.mock.calls[0]![0] as {
      data: { settings_override: { limits: { max_participants: number } } };
    };
    expect(createCallArgs.data.settings_override.limits.max_participants).toBe(3);
  });

  // -----------------------------------------------------------------------
  // Idempotency — SPEC AUTHORITATIVE BEHAVIOR
  // -----------------------------------------------------------------------

  it('returns existing room on second call (idempotent)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const client = fakeSupabaseClient(userId);

    // First call creates the room
    const result1 = await createVideoRoomImpl(client, { session_id: sessionId });
    expect(result1.ok).toBe(true);
    if (!result1.ok) return;

    // Reset mocks to verify the second call does NOT call Stream
    vi.clearAllMocks();

    // Second call returns the same room
    const result2 = await createVideoRoomImpl(client, { session_id: sessionId });
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;

    // Same room returned
    expect(result2.room.id).toBe(result1.room.id);
    expect(result2.room.patientToken).toBe(result1.room.patientToken);

    // Stream SDK NOT called again
    expect(mockGetOrCreate).not.toHaveBeenCalled();
    expect(mockGenerateCallToken).not.toHaveBeenCalled();

    // Only one row in DB
    const rows = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.sessionId, sessionId));
    });
    expect(rows).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Negative paths
  // -----------------------------------------------------------------------

  it('rejects unauthenticated requests', async () => {
    const client = fakeSupabaseClient(null);
    const result = await createVideoRoomImpl(client, { session_id: randomUUID() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('rejects invalid input (non-UUID session_id)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createVideoRoomImpl(client, { session_id: 'not-a-uuid' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
  });

  it('rejects session not owned by user (IDOR prevention)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);
    await seedSession(userA, sessionId, patientId);

    // User B tries to create a room for user A's session
    const client = fakeSupabaseClient(userB);
    const result = await createVideoRoomImpl(client, { session_id: sessionId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('session_not_found');

    // No Stream calls or DB rows created
    expect(mockGetOrCreate).not.toHaveBeenCalled();
  });

  it('rejects session with modality in_person', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId, { modality: 'in_person' });

    const client = fakeSupabaseClient(userId);
    const result = await createVideoRoomImpl(client, { session_id: sessionId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('session_not_online');
  });

  it('rejects cancelled session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId, { status: 'cancelled' });

    const client = fakeSupabaseClient(userId);
    const result = await createVideoRoomImpl(client, { session_id: sessionId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('session_not_schedulable');
  });

  it('rejects done session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId, { status: 'done' });

    const client = fakeSupabaseClient(userId);
    const result = await createVideoRoomImpl(client, { session_id: sessionId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('session_not_schedulable');
  });

  it('rejects no_show session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId, { status: 'no_show' });

    const client = fakeSupabaseClient(userId);
    const result = await createVideoRoomImpl(client, { session_id: sessionId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('session_not_schedulable');
  });

  // -----------------------------------------------------------------------
  // RLS cross-user isolation
  // -----------------------------------------------------------------------

  it('user B cannot see user A video room via RLS', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);
    await seedSession(userA, sessionId, patientId);

    // Create room as user A
    const client = fakeSupabaseClient(userA);
    const result = await createVideoRoomImpl(client, { session_id: sessionId });
    expect(result.ok).toBe(true);

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

  // -----------------------------------------------------------------------
  // Token scoping verification
  // -----------------------------------------------------------------------

  it('patient JWT validity_in_seconds is bounded by room expires_at', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const client = fakeSupabaseClient(userId);
    await createVideoRoomImpl(client, { session_id: sessionId });

    const tokenCall = mockGenerateCallToken.mock.calls[0]![0] as {
      validity_in_seconds: number;
    };

    // The validity should be roughly session.endAt + 1h from now (within 5 seconds tolerance)
    // session ends in ~1h from now, plus 1h buffer = ~2h = ~7200s
    expect(tokenCall.validity_in_seconds).toBeGreaterThan(0);
    expect(tokenCall.validity_in_seconds).toBeLessThanOrEqual(7200 + 10);
  });
});
