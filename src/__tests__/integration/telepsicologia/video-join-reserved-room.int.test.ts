import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { profiles } from '@/shared/db/schema/auth/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Stream client mock
// ---------------------------------------------------------------------------
//
// The join handler upserts the patient into Stream before returning the JWT
// for an active room. A reserved (stream_call_id NULL) room never reaches the
// upsert path; we still mock the module so the handler does not hit the real
// Stream API and so we can assert the upsert is NOT called for reserved rooms.

const upsertUsers = vi.fn((): Promise<void> => Promise.resolve());

vi.mock('@/modules/telepsicologia/server/stream-client', () => ({
  getStreamClient: () => ({ upsertUsers }),
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

/**
 * Seeds a video room row directly. Unlike the shared helper in
 * video-join-handler.int.test.ts, this one accepts `streamCallId: null` so a
 * reserved-but-not-activated room can be exercised, and lets the caller set the
 * session `startAt` independently from the room's `availableFrom` window.
 */
async function seedVideoRoom(
  userId: string,
  opts: {
    status?: string;
    patientToken?: string;
    patientJwt?: string;
    availableFrom?: Date;
    expiresAt?: Date;
    streamCallId?: string | null;
    sessionStartAt?: Date;
    patientFullName?: string;
  },
): Promise<{ patientId: string; sessionId: string }> {
  const sessionId = randomUUID();
  const patientId = randomUUID();
  const now = new Date();
  const startAt = opts.sessionStartAt ?? now;

  await runAsService(async (db) => {
    const { sessions } = await import('@/shared/db/schema/agenda/tables');
    const { patients } = await import('@/shared/db/schema/patients/tables');

    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: opts.patientFullName ?? 'Test Patient',
      patientType: 'individual',
    });
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt,
      endAt: new Date(startAt.getTime() + 3600_000),
      durationMinutes: 50,
      modality: 'online',
      status: 'scheduled',
    });

    await db.insert(videoRooms).values({
      userId,
      sessionId,
      // `streamCallId` is explicitly nullable: NULL models a reserved room.
      streamCallId: opts.streamCallId === undefined ? `session-${sessionId}` : opts.streamCallId,
      patientToken: opts.patientToken ?? 'a'.repeat(64),
      patientJwt: opts.patientJwt ?? 'mock-patient-jwt',
      partnerToken: null,
      partnerJwt: null,
      availableFrom: opts.availableFrom ?? new Date(now.getTime() - 600_000),
      expiresAt: opts.expiresAt ?? new Date(now.getTime() + 7200_000),
      status: opts.status ?? 'pending',
    });
  });

  return { patientId, sessionId };
}

let ipCounter = 0;

function makeRequest(body: unknown): NextRequest {
  ipCounter += 1;
  return new NextRequest('http://localhost/api/video/join', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `10.7.0.${ipCounter}`,
    },
    body: JSON.stringify(body),
  });
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

describe('POST /api/video/join — reserved-but-not-activated room', () => {
  it('returns too_early with the session start time for a reserved room (stream_call_id NULL)', async () => {
    const userId = randomUUID();
    const patientToken = 'a1b2c3d4'.repeat(8); // 64 hex chars
    const sessionStartAt = new Date(Date.now() + 3 * 3600_000);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Reserva');
    await seedVideoRoom(userId, {
      status: 'pending',
      patientToken,
      streamCallId: null,
      sessionStartAt,
      // availableFrom is already in the past — proves the NULL check wins over
      // the time-window/status checks and resolves startAt from `sessions`.
      availableFrom: new Date(Date.now() - 600_000),
    });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: patientToken }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      sessionStartAt: string;
      psychologistName: string;
      psychologistPhotoUrl: string | null;
    };
    expect(body.status).toBe('too_early');
    expect(body.sessionStartAt).toBe(sessionStartAt.toISOString());
    expect(body.psychologistName).toBe('Dr. Reserva');
    expect(body.psychologistPhotoUrl).toBeNull();

    // A reserved room must never hand out call credentials nor touch Stream.
    expect(body).not.toHaveProperty('streamToken');
    expect(body).not.toHaveProperty('apiKey');
    expect(body).not.toHaveProperty('callId');
    expect(upsertUsers).not.toHaveBeenCalled();
  });

  it('follows the existing active behavior for an activated room (stream_call_id set)', async () => {
    const userId = randomUUID();
    const patientToken = 'feed1234'.repeat(8); // 64 hex chars
    const patientJwt = 'real-patient-jwt-token';
    const streamCallId = `session-${randomUUID()}`;
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Ativa');
    const { patientId } = await seedVideoRoom(userId, {
      status: 'active',
      patientToken,
      patientJwt,
      streamCallId,
      patientFullName: 'João da Silva',
    });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: patientToken }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      streamToken: string;
      apiKey: string;
      callId: string;
    };
    expect(body.status).toBe('active');
    expect(body.streamToken).toBe(patientJwt);
    expect(body.apiKey).toBeTruthy();
    expect(body.callId).toBe(streamCallId);
    expect(upsertUsers).toHaveBeenCalledTimes(1);
    expect(upsertUsers).toHaveBeenCalledWith([
      { id: `patient-${patientId}`, name: 'João da Silva' },
    ]);
  });

  it('returns 404 for an unrecognized token', async () => {
    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: 'b'.repeat(64) }));

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('NOT_FOUND');
    expect(upsertUsers).not.toHaveBeenCalled();
  });
});
