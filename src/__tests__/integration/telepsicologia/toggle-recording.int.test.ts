import { randomUUID } from 'node:crypto';

import { and, eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toggleRecordingImpl } from '@/modules/telepsicologia/server/toggle-recording';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import {
  videoRecordings,
  videoRooms,
  videoSessionLogs,
} from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Mock Stream SDK — no real network calls
// ---------------------------------------------------------------------------

const mockStartRecording = vi.fn().mockResolvedValue({});
const mockStopRecording = vi.fn().mockResolvedValue({});

vi.mock('@/modules/telepsicologia/server/stream-client', () => ({
  getStreamClient: () => ({
    video: {
      call: () => ({
        startRecording: mockStartRecording,
        stopRecording: mockStopRecording,
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

async function seedPatient(
  userId: string,
  patientId: string,
  opts?: {
    consentSignedAt?: Date | null;
    consentRevokedAt?: Date | null;
  },
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
      patientType: 'individual',
      recordingConsentSignedAt: opts?.consentSignedAt ?? null,
      recordingConsentRevokedAt: opts?.consentRevokedAt ?? null,
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
      patientToken: randomUUID().replace(/-/g, '').repeat(2),
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
  } as unknown as Parameters<typeof toggleRecordingImpl>[0];
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

describe('toggleRecordingImpl', () => {
  // -------------------------------------------------------------------------
  // Start recording — happy path (valid consent)
  // -------------------------------------------------------------------------

  it('starts recording with valid consent — Stream called, DB updated, log inserted', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, {
      consentSignedAt: new Date(),
      consentRevokedAt: null,
    });
    await seedSession(userId, sessionId, patientId);
    const roomId = await seedVideoRoom(userId, sessionId);

    const client = fakeSupabaseClient(userId);
    const result = await toggleRecordingImpl(client, { room_id: roomId, action: 'start' });

    expect(result.ok).toBe(true);

    // Verify Stream startRecording was called
    expect(mockStartRecording).toHaveBeenCalledOnce();

    // Verify video_recordings row was created with status='recording'
    const recordings = await runAsService(async (db) => {
      return db
        .select()
        .from(videoRecordings)
        .where(and(eq(videoRecordings.sessionId, sessionId), eq(videoRecordings.userId, userId)));
    });
    expect(recordings).toHaveLength(1);
    expect(recordings[0]!.status).toBe('recording');
    expect(recordings[0]!.recordedAt).not.toBeNull();

    // Verify video_rooms recording_enabled was set to true
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms[0]!.recordingEnabled).toBe(true);

    // Verify log entry was created
    const logs = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId));
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.eventType).toBe('recording_started');
    expect(logs[0]!.userId).toBe(userId);
  });

  // -------------------------------------------------------------------------
  // Start recording — consent not signed (never signed)
  // -------------------------------------------------------------------------

  it('returns CONSENT_REQUIRED when patient has never signed consent', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    // No consent signed — both columns null
    await seedPatient(userId, patientId, {
      consentSignedAt: null,
      consentRevokedAt: null,
    });
    await seedSession(userId, sessionId, patientId);
    const roomId = await seedVideoRoom(userId, sessionId);

    const client = fakeSupabaseClient(userId);
    const result = await toggleRecordingImpl(client, { room_id: roomId, action: 'start' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONSENT_REQUIRED');

    // Stream should NOT have been called
    expect(mockStartRecording).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Start recording — consent revoked
  // -------------------------------------------------------------------------

  it('returns CONSENT_REQUIRED when patient has revoked consent', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    // Consent was signed then revoked
    await seedPatient(userId, patientId, {
      consentSignedAt: new Date(Date.now() - 86400_000),
      consentRevokedAt: new Date(),
    });
    await seedSession(userId, sessionId, patientId);
    const roomId = await seedVideoRoom(userId, sessionId);

    const client = fakeSupabaseClient(userId);
    const result = await toggleRecordingImpl(client, { room_id: roomId, action: 'start' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONSENT_REQUIRED');

    // Stream should NOT have been called
    expect(mockStartRecording).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Stop recording — happy path
  // -------------------------------------------------------------------------

  it('stops recording — Stream called, DB updated, log inserted', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, {
      consentSignedAt: new Date(),
    });
    await seedSession(userId, sessionId, patientId);
    const roomId = await seedVideoRoom(userId, sessionId);

    // Seed an existing recording row in 'recording' status
    await runAsService(async (db) => {
      await db.insert(videoRecordings).values({
        sessionId,
        userId,
        status: 'recording',
        recordedAt: new Date(),
      });
    });

    const client = fakeSupabaseClient(userId);
    const result = await toggleRecordingImpl(client, { room_id: roomId, action: 'stop' });

    expect(result.ok).toBe(true);

    // Verify Stream stopRecording was called
    expect(mockStopRecording).toHaveBeenCalledOnce();

    // Verify video_recordings status was updated to 'processing'
    const recordings = await runAsService(async (db) => {
      return db
        .select()
        .from(videoRecordings)
        .where(and(eq(videoRecordings.sessionId, sessionId), eq(videoRecordings.userId, userId)));
    });
    expect(recordings).toHaveLength(1);
    expect(recordings[0]!.status).toBe('processing');

    // Verify video_rooms recording_enabled was set to false
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, roomId));
    });
    expect(rooms[0]!.recordingEnabled).toBe(false);

    // Verify log entry was created
    const logs = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId));
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.eventType).toBe('recording_ended');
  });

  // -------------------------------------------------------------------------
  // Negative paths
  // -------------------------------------------------------------------------

  it('rejects unauthenticated requests', async () => {
    const client = fakeSupabaseClient(null);
    const result = await toggleRecordingImpl(client, {
      room_id: randomUUID(),
      action: 'start',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHENTICATED');

    expect(mockStartRecording).not.toHaveBeenCalled();
  });

  it('rejects room not owned by user (IDOR prevention)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId, { consentSignedAt: new Date() });
    await seedSession(userA, sessionId, patientId);
    const roomId = await seedVideoRoom(userA, sessionId);

    // User B tries to start recording on user A's room
    const client = fakeSupabaseClient(userB);
    const result = await toggleRecordingImpl(client, {
      room_id: roomId,
      action: 'start',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ROOM_NOT_FOUND');

    expect(mockStartRecording).not.toHaveBeenCalled();
  });

  it('rejects invalid input (non-UUID room_id)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await toggleRecordingImpl(client, {
      room_id: 'not-a-uuid',
      action: 'start',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid action value', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await toggleRecordingImpl(client, {
      room_id: randomUUID(),
      action: 'pause',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
  });
});
