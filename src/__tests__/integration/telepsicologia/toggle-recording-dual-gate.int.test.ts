import { randomBytes, randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toggleRecordingImpl } from '@/modules/telepsicologia/server/toggle-recording';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';

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
  opts: {
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
      recordingConsentSignedAt: opts.consentSignedAt ?? null,
      recordingConsentRevokedAt: opts.consentRevokedAt ?? null,
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

async function seedVideoRoom(userId: string, sessionId: string): Promise<string> {
  const roomId = randomUUID();
  const streamCallId = `session-${sessionId}`;
  const now = new Date();
  await runAsService(async (db) => {
    await db.insert(videoRooms).values({
      id: roomId,
      userId,
      sessionId,
      streamCallId,
      patientToken: randomBytes(32).toString('hex'),
      patientJwt: 'mock-patient-jwt',
      availableFrom: new Date(now.getTime() - 600_000),
      expiresAt: new Date(now.getTime() + 7200_000),
      status: 'active',
    });
  });
  return roomId;
}

/**
 * Seeds a signed AI consent term (kind='ai_recording') for the given
 * user+patient pair.
 */
async function seedAiConsentTerm(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(consentTerms).values({
      userId,
      patientId,
      kind: 'ai_recording',
      termText: 'AI recording consent term for test.',
      templateVersion: 1,
      signatureToken: randomBytes(32).toString('hex'),
      signedAt: new Date(),
      revocationTakesEffectImmediately: true,
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
// Tests — dual consent gate matrix
// ---------------------------------------------------------------------------

describe('toggleRecordingImpl — dual consent gate (integration)', () => {
  // Scenario matrix:
  //   legacy=yes, ai=yes → recording starts
  //   legacy=yes, ai=no  → CONSENT_INVALID (no Stream call)
  //   legacy=no,  ai=yes → CONSENT_INVALID (no Stream call)
  //   legacy=no,  ai=no  → CONSENT_INVALID (no Stream call)

  it('(legacy=yes, ai=yes) starts recording — both gates pass', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, {
      consentSignedAt: new Date(),
      consentRevokedAt: null,
    });
    await seedAiConsentTerm(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    const roomId = await seedVideoRoom(userId, sessionId);

    const client = fakeSupabaseClient(userId);
    const result = await toggleRecordingImpl(client, { room_id: roomId, action: 'start' });

    expect(result.ok).toBe(true);
    expect(mockStartRecording).toHaveBeenCalledOnce();
  });

  it('(legacy=yes, ai=no) blocks recording — AI consent missing', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    // Legacy consent is present
    await seedPatient(userId, patientId, {
      consentSignedAt: new Date(),
      consentRevokedAt: null,
    });
    // NO AI consent term seeded
    await seedSession(userId, sessionId, patientId);
    const roomId = await seedVideoRoom(userId, sessionId);

    const client = fakeSupabaseClient(userId);
    const result = await toggleRecordingImpl(client, { room_id: roomId, action: 'start' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CONSENT_INVALID');
    }
    expect(mockStartRecording).not.toHaveBeenCalled();
  });

  it('(legacy=no, ai=yes) blocks recording — legacy consent missing', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    // NO legacy consent
    await seedPatient(userId, patientId, {
      consentSignedAt: null,
      consentRevokedAt: null,
    });
    // AI consent is present
    await seedAiConsentTerm(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    const roomId = await seedVideoRoom(userId, sessionId);

    const client = fakeSupabaseClient(userId);
    const result = await toggleRecordingImpl(client, { room_id: roomId, action: 'start' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CONSENT_INVALID');
    }
    expect(mockStartRecording).not.toHaveBeenCalled();
  });

  it('(legacy=no, ai=no) blocks recording — both gates fail', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    // NO legacy consent
    await seedPatient(userId, patientId, {
      consentSignedAt: null,
      consentRevokedAt: null,
    });
    // NO AI consent term seeded
    await seedSession(userId, sessionId, patientId);
    const roomId = await seedVideoRoom(userId, sessionId);

    const client = fakeSupabaseClient(userId);
    const result = await toggleRecordingImpl(client, { room_id: roomId, action: 'start' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CONSENT_INVALID');
    }
    expect(mockStartRecording).not.toHaveBeenCalled();
  });
});
