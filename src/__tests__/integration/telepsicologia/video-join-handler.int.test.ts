import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { profiles } from '@/shared/db/schema/auth/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';

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
 * Seeds a video room row directly, giving the test full control over status,
 * tokens, JWTs, and time window.
 */
async function seedVideoRoom(
  userId: string,
  opts?: {
    status?: string;
    patientToken?: string;
    patientJwt?: string;
    partnerToken?: string | null;
    partnerJwt?: string | null;
    availableFrom?: Date;
    expiresAt?: Date;
    streamCallId?: string;
  },
): Promise<void> {
  const sessionId = randomUUID();
  const now = new Date();
  await runAsService(async (db) => {
    // Seed a minimal session to satisfy FK
    const { sessions } = await import('@/shared/db/schema/agenda/tables');
    const { patients } = await import('@/shared/db/schema/patients/tables');

    const patientId = randomUUID();
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
      patientType: 'individual',
    });
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt: now,
      endAt: new Date(now.getTime() + 3600_000),
      durationMinutes: 50,
      modality: 'online',
      status: 'scheduled',
    });

    await db.insert(videoRooms).values({
      userId,
      sessionId,
      streamCallId: opts?.streamCallId ?? `session-${sessionId}`,
      patientToken: opts?.patientToken ?? 'a'.repeat(64),
      patientJwt: opts?.patientJwt ?? 'mock-patient-jwt',
      partnerToken: opts?.partnerToken ?? null,
      partnerJwt: opts?.partnerJwt ?? null,
      availableFrom: opts?.availableFrom ?? new Date(now.getTime() - 600_000),
      expiresAt: opts?.expiresAt ?? new Date(now.getTime() + 7200_000),
      status: opts?.status ?? 'pending',
    });
  });
}

/** Auto-incrementing IP counter to avoid triggering the in-memory rate limiter. */
let ipCounter = 0;

/**
 * Constructs a NextRequest for POST /api/video/join with the given JSON body.
 * Each call gets a unique IP via x-forwarded-for to avoid rate-limit collisions
 * across tests sharing the same in-process rate-limit bucket.
 */
function makeRequest(body: unknown): NextRequest {
  ipCounter += 1;
  return new NextRequest('http://localhost/api/video/join', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `10.0.0.${ipCounter}`,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Constructs a NextRequest with a fixed IP (for rate-limit testing).
 */
function makeRequestWithIp(body: unknown, ip: string): NextRequest {
  return new NextRequest('http://localhost/api/video/join', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
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

describe('POST /api/video/join', () => {
  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  it('returns 400 for malformed token (wrong length)', async () => {
    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: 'tooshort' }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('INVALID_INPUT');
  });

  it('returns 400 for malformed token (non-hex characters)', async () => {
    const { POST } = await import('@/app/api/video/join/route');
    // 64 chars but contains uppercase letters (not valid hex per regex)
    const response = await POST(makeRequest({ token: 'G'.repeat(64) }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('INVALID_INPUT');
  });

  it('returns 400 for missing token field', async () => {
    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('INVALID_INPUT');
  });

  it('returns 400 for invalid JSON body', async () => {
    const { POST } = await import('@/app/api/video/join/route');
    const request = new NextRequest('http://localhost/api/video/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('INVALID_BODY');
  });

  // -------------------------------------------------------------------------
  // Token not found
  // -------------------------------------------------------------------------

  it('returns 404 for valid-format token that does not exist', async () => {
    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: 'b'.repeat(64) }));

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // Ended / expired rooms -> 410
  // -------------------------------------------------------------------------

  it('returns 410 for room with status ended (includes psychologistName)', async () => {
    const userId = randomUUID();
    const patientToken = 'c'.repeat(64);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Test');
    await seedVideoRoom(userId, {
      status: 'ended',
      patientToken,
    });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: patientToken }));

    expect(response.status).toBe(410);
    const body = (await response.json()) as { error: string; psychologistName: string };
    expect(body.error).toBe('SESSION_ENDED');
    expect(body.psychologistName).toBe('Dr. Test');
  });

  it('returns 410 for room with status expired (includes psychologistName)', async () => {
    const userId = randomUUID();
    const patientToken = 'd'.repeat(64);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Expired');
    await seedVideoRoom(userId, {
      status: 'expired',
      patientToken,
    });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: patientToken }));

    expect(response.status).toBe(410);
    const body = (await response.json()) as { error: string; psychologistName: string };
    expect(body.error).toBe('SESSION_ENDED');
    expect(body.psychologistName).toBe('Dr. Expired');
  });

  it('returns 410 when now > expiresAt even if status is pending', async () => {
    const userId = randomUUID();
    const patientToken = 'e'.repeat(64);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Test');
    const pastExpiry = new Date(Date.now() - 60_000);
    await seedVideoRoom(userId, {
      status: 'pending',
      patientToken,
      availableFrom: new Date(Date.now() - 7200_000),
      expiresAt: pastExpiry,
    });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: patientToken }));

    expect(response.status).toBe(410);
    const body = (await response.json()) as { error: string; psychologistName: string };
    expect(body.error).toBe('SESSION_ENDED');
    expect(body.psychologistName).toBe('Dr. Test');
  });

  // -------------------------------------------------------------------------
  // Too early
  // -------------------------------------------------------------------------

  it('returns 200 with status too_early when now < availableFrom', async () => {
    const userId = randomUUID();
    const patientToken = 'f'.repeat(64);
    const futureStart = new Date(Date.now() + 3600_000);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Ana');
    await seedVideoRoom(userId, {
      status: 'pending',
      patientToken,
      availableFrom: futureStart,
      expiresAt: new Date(futureStart.getTime() + 7200_000),
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
    expect(body.sessionStartAt).toBe(futureStart.toISOString());
    expect(body.psychologistName).toBe('Dr. Ana');
    expect(body.psychologistPhotoUrl).toBeNull();
    // Must NOT contain streamToken or callId
    expect(body).not.toHaveProperty('streamToken');
    expect(body).not.toHaveProperty('callId');
  });

  // -------------------------------------------------------------------------
  // Active room — returns stream token
  // -------------------------------------------------------------------------

  it('returns 200 with status active including streamToken, apiKey, callId', async () => {
    const userId = randomUUID();
    const patientToken = 'a1b2c3d4'.repeat(8); // 64 hex chars
    const patientJwt = 'real-patient-jwt-token';
    const streamCallId = `session-${randomUUID()}`;
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Carlos');
    await seedVideoRoom(userId, {
      status: 'active',
      patientToken,
      patientJwt,
      streamCallId,
    });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: patientToken }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      streamToken: string;
      apiKey: string;
      callId: string;
      psychologistName: string;
      psychologistPhotoUrl: string | null;
    };
    expect(body.status).toBe('active');
    expect(body.streamToken).toBe(patientJwt);
    expect(body.apiKey).toBeTruthy();
    expect(body.callId).toBe(streamCallId);
    expect(body.psychologistName).toBe('Dr. Carlos');
    expect(body.psychologistPhotoUrl).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Waiting room — pending status within time window
  // -------------------------------------------------------------------------

  it('returns 200 with status waiting for a pending room within time window', async () => {
    const userId = randomUUID();
    const patientToken = 'abcdef01'.repeat(8); // 64 hex chars
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Maria');
    await seedVideoRoom(userId, {
      status: 'pending',
      patientToken,
    });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: patientToken }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      psychologistName: string;
      psychologistPhotoUrl: string | null;
    };
    expect(body.status).toBe('waiting');
    expect(body.psychologistName).toBe('Dr. Maria');
    expect(body.psychologistPhotoUrl).toBeNull();
    // Must NOT contain streamToken, apiKey, or callId in waiting state
    expect(body).not.toHaveProperty('streamToken');
    expect(body).not.toHaveProperty('apiKey');
    expect(body).not.toHaveProperty('callId');
  });

  // -------------------------------------------------------------------------
  // Partner token resolves correctly
  // -------------------------------------------------------------------------

  it('partner_token resolves correctly with partner JWT', async () => {
    const userId = randomUUID();
    const patientToken = '1'.repeat(64);
    const partnerToken = '2'.repeat(64);
    const patientJwt = 'patient-jwt-value';
    const partnerJwt = 'partner-jwt-value';
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Partner Test');
    await seedVideoRoom(userId, {
      status: 'active',
      patientToken,
      patientJwt,
      partnerToken,
      partnerJwt,
    });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: partnerToken }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      streamToken: string;
      apiKey: string;
      callId: string;
    };
    expect(body.status).toBe('active');
    // Partner token should resolve to partner JWT, not patient JWT
    expect(body.streamToken).toBe(partnerJwt);
  });

  // -------------------------------------------------------------------------
  // Response never leaks internal IDs
  // -------------------------------------------------------------------------

  it('does not expose internal IDs or patient data in any response state', async () => {
    const userId = randomUUID();
    const patientToken = '3'.repeat(64);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Privacy');
    await seedVideoRoom(userId, {
      status: 'active',
      patientToken,
    });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: patientToken }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    // None of these internal identifiers should appear
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('roomId');
    expect(body).not.toHaveProperty('userId');
    expect(body).not.toHaveProperty('sessionId');
    expect(body).not.toHaveProperty('patientId');
    expect(body).not.toHaveProperty('patientToken');
    expect(body).not.toHaveProperty('partnerToken');
  });

  // -------------------------------------------------------------------------
  // Cache control
  // -------------------------------------------------------------------------

  it('sets Cache-Control: no-store on all responses', async () => {
    const { POST } = await import('@/app/api/video/join/route');

    // 404 response
    const res404 = await POST(makeRequest({ token: '0'.repeat(64) }));
    expect(res404.headers.get('Cache-Control')).toBe('no-store');

    // 400 response
    const res400 = await POST(makeRequest({ token: 'short' }));
    expect(res400.headers.get('Cache-Control')).toBe('no-store');
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  it('returns 429 with Retry-After header after exceeding rate limit', async () => {
    const { POST } = await import('@/app/api/video/join/route');
    // The join handler rate-limits per IP (10/min). Use a fixed IP.
    const fixedIp = '10.88.88.88';
    const token = '0'.repeat(64);

    // Exhaust the 10-request bucket
    for (let i = 0; i < 10; i++) {
      await POST(makeRequestWithIp({ token }, fixedIp));
    }

    // 11th request should be rate-limited
    const res = await POST(makeRequestWithIp({ token }, fixedIp));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });
});
