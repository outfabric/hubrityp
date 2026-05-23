import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers (mirrored from video-join-handler.int.test.ts)
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
  const { profiles } = await import('@/shared/db/schema/auth/tables');
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
 * tokens, and time window.
 */
async function seedVideoRoom(
  userId: string,
  opts?: {
    status?: string;
    patientToken?: string;
    partnerToken?: string | null;
    availableFrom?: Date;
    expiresAt?: Date;
    streamCallId?: string;
  },
): Promise<{ sessionId: string }> {
  const sessionId = randomUUID();
  const now = new Date();
  await runAsService(async (db) => {
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

    const { videoRooms } = await import('@/shared/db/schema/telepsicologia/tables');
    await db.insert(videoRooms).values({
      userId,
      sessionId,
      streamCallId: opts?.streamCallId ?? `session-${sessionId}`,
      patientToken: opts?.patientToken ?? 'a'.repeat(64),
      patientJwt: 'mock-patient-jwt',
      partnerToken: opts?.partnerToken ?? null,
      partnerJwt: opts?.partnerToken ? 'mock-partner-jwt' : null,
      availableFrom: opts?.availableFrom ?? new Date(now.getTime() - 600_000),
      expiresAt: opts?.expiresAt ?? new Date(now.getTime() + 7200_000),
      status: opts?.status ?? 'pending',
    });
  });
  return { sessionId };
}

/** Auto-incrementing IP counter to avoid rate-limit collisions. */
let ipCounter = 0;

/**
 * Constructs a NextRequest for POST /api/video/log with the given JSON body.
 * Each call gets a unique IP via x-forwarded-for.
 */
function makeRequest(body: unknown): NextRequest {
  ipCounter += 1;
  return new NextRequest('http://localhost/api/video/log', {
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
  return new NextRequest('http://localhost/api/video/log', {
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

describe('POST /api/video/log', () => {
  // -------------------------------------------------------------------------
  // Valid token + valid event_type → inserts log row
  // -------------------------------------------------------------------------

  it('inserts a log row for a valid token and event_type', async () => {
    const userId = randomUUID();
    const patientToken = 'a1b2c3d4'.repeat(8); // 64 hex chars
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Log Test');
    const { sessionId } = await seedVideoRoom(userId, {
      status: 'active',
      patientToken,
    });

    const { POST } = await import('@/app/api/video/log/route');
    const response = await POST(
      makeRequest({
        token: patientToken,
        event_type: 'patient_joined',
        metadata: { device: 'mobile' },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Verify the row was inserted
    const rows = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventType).toBe('patient_joined');
    expect(rows[0]!.participantRole).toBe('patient');
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.metadata).toEqual({ device: 'mobile' });
  });

  it('derives participant_role as partner when partner_token is used', async () => {
    const userId = randomUUID();
    const patientToken = 'b1b2c3d4'.repeat(8);
    const partnerToken = 'c1c2c3d4'.repeat(8);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Partner Log');
    const { sessionId } = await seedVideoRoom(userId, {
      status: 'active',
      patientToken,
      partnerToken,
    });

    const { POST } = await import('@/app/api/video/log/route');
    const response = await POST(
      makeRequest({
        token: partnerToken,
        event_type: 'partner_joined',
      }),
    );

    expect(response.status).toBe(200);

    const rows = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.participantRole).toBe('partner');
    expect(rows[0]!.eventType).toBe('partner_joined');
  });

  it('inserts log without metadata when metadata is omitted', async () => {
    const userId = randomUUID();
    const patientToken = 'd1d2d3d4'.repeat(8);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. No Meta');
    const { sessionId } = await seedVideoRoom(userId, {
      status: 'active',
      patientToken,
    });

    const { POST } = await import('@/app/api/video/log/route');
    const response = await POST(
      makeRequest({
        token: patientToken,
        event_type: 'connection_drop',
      }),
    );

    expect(response.status).toBe(200);

    const rows = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.sessionId, sessionId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Invalid token → 404
  // -------------------------------------------------------------------------

  it('returns 404 for a valid-format token that does not exist', async () => {
    const { POST } = await import('@/app/api/video/log/route');
    const response = await POST(
      makeRequest({
        token: 'b'.repeat(64),
        event_type: 'patient_joined',
      }),
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // Invalid event_type → 400
  // -------------------------------------------------------------------------

  it('returns 400 for an invalid event_type', async () => {
    const { POST } = await import('@/app/api/video/log/route');
    const response = await POST(
      makeRequest({
        token: 'a'.repeat(64),
        event_type: 'invalid_event',
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('INVALID_INPUT');
  });

  it('returns 400 for missing event_type field', async () => {
    const { POST } = await import('@/app/api/video/log/route');
    const response = await POST(
      makeRequest({
        token: 'a'.repeat(64),
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('INVALID_INPUT');
  });

  it('returns 400 for invalid token format', async () => {
    const { POST } = await import('@/app/api/video/log/route');
    const response = await POST(
      makeRequest({
        token: 'tooshort',
        event_type: 'patient_joined',
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('INVALID_INPUT');
  });

  it('returns 400 for invalid JSON body', async () => {
    const { POST } = await import('@/app/api/video/log/route');
    const request = new NextRequest('http://localhost/api/video/log', {
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
  // Ended room → 404
  // -------------------------------------------------------------------------

  it('returns 404 for room with status ended', async () => {
    const userId = randomUUID();
    const patientToken = 'e1e2e3e4'.repeat(8);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Ended');
    await seedVideoRoom(userId, {
      status: 'ended',
      patientToken,
    });

    const { POST } = await import('@/app/api/video/log/route');
    const response = await POST(
      makeRequest({
        token: patientToken,
        event_type: 'patient_left',
      }),
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('NOT_FOUND');
  });

  it('returns 404 for room with status expired', async () => {
    const userId = randomUUID();
    const patientToken = 'f1f2f3f4'.repeat(8);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Expired');
    await seedVideoRoom(userId, {
      status: 'expired',
      patientToken,
    });

    const { POST } = await import('@/app/api/video/log/route');
    const response = await POST(
      makeRequest({
        token: patientToken,
        event_type: 'patient_left',
      }),
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('NOT_FOUND');
  });

  it('returns 404 when now > expiresAt even if status is pending', async () => {
    const userId = randomUUID();
    const patientToken = 'a2b2c2d2'.repeat(8);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Past Expiry');
    await seedVideoRoom(userId, {
      status: 'pending',
      patientToken,
      availableFrom: new Date(Date.now() - 7200_000),
      expiresAt: new Date(Date.now() - 60_000),
    });

    const { POST } = await import('@/app/api/video/log/route');
    const response = await POST(
      makeRequest({
        token: patientToken,
        event_type: 'reconnected',
      }),
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // Cache control
  // -------------------------------------------------------------------------

  it('sets Cache-Control: no-store on all responses', async () => {
    const { POST } = await import('@/app/api/video/log/route');

    // 404 response (non-existent token)
    const res404 = await POST(
      makeRequest({
        token: '0'.repeat(64),
        event_type: 'patient_joined',
      }),
    );
    expect(res404.headers.get('Cache-Control')).toBe('no-store');

    // 400 response (invalid input)
    const res400 = await POST(
      makeRequest({
        token: 'short',
        event_type: 'patient_joined',
      }),
    );
    expect(res400.headers.get('Cache-Control')).toBe('no-store');
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  it('returns 429 with Retry-After header after exceeding rate limit', async () => {
    const { POST } = await import('@/app/api/video/log/route');
    // The log handler rate-limits per token (10/min). Use a fixed token
    // that does not exist — the rate limiter fires before the DB query.
    const token = 'f'.repeat(64);
    const fixedIp = '10.99.99.99';

    // Exhaust the 10-request bucket
    for (let i = 0; i < 10; i++) {
      await POST(makeRequestWithIp({ token, event_type: 'patient_joined' }, fixedIp));
    }

    // 11th request should be rate-limited
    const res = await POST(makeRequestWithIp({ token, event_type: 'patient_joined' }, fixedIp));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  // -------------------------------------------------------------------------
  // Metadata bounds (storage DoS prevention)
  // -------------------------------------------------------------------------

  it('returns 400 when metadata has more than 20 keys', async () => {
    const { POST } = await import('@/app/api/video/log/route');

    const metadata: Record<string, string> = {};
    for (let i = 0; i < 21; i++) {
      metadata[`key${i}`] = 'value';
    }

    const response = await POST(
      makeRequest({
        token: 'a'.repeat(64),
        event_type: 'patient_joined',
        metadata,
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('INVALID_INPUT');
  });

  it('returns 400 when a metadata value exceeds 512 characters', async () => {
    const { POST } = await import('@/app/api/video/log/route');

    const response = await POST(
      makeRequest({
        token: 'a'.repeat(64),
        event_type: 'patient_joined',
        metadata: { device: 'x'.repeat(513) },
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('INVALID_INPUT');
  });

  it('returns 400 when a metadata key exceeds 64 characters', async () => {
    const { POST } = await import('@/app/api/video/log/route');

    const response = await POST(
      makeRequest({
        token: 'a'.repeat(64),
        event_type: 'patient_joined',
        metadata: { ['k'.repeat(65)]: 'value' },
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('INVALID_INPUT');
  });
});
