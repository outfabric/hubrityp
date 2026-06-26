/**
 * Integration tests for POST /api/video/depart.
 *
 * Covers the departure-beacon contract (design.md Decision 6):
 *  - a valid token on a `pending` room with a set heartbeat clears
 *    patient_last_seen_at to NULL and leaves patient_waiting_at unchanged;
 *  - a second (duplicate) beacon updates zero rows (idempotent);
 *  - a beacon for an `active` room does NOT clear liveness;
 *  - a malformed token is rejected (400) with no row updated;
 *  - a well-formed but unknown token returns an opaque empty 204 (no oracle)
 *    and updates no row;
 *  - the response body exposes nothing (no ids/tokens/jwt/PII);
 *  - rate limiting rejects over-limit requests before DB work.
 *
 * Runs against real Postgres (Testcontainers) so the guarded UPDATE
 * (status = 'pending' AND patient_last_seen_at IS NOT NULL) is exercised on
 * the actual engine.
 */
import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';

import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (sdb) => {
    await sdb.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

interface SeedRoomOpts {
  status?: string;
  patientToken?: string;
  partnerToken?: string | null;
  patientWaitingAt?: Date | null;
  patientLastSeenAt?: Date | null;
}

async function seedVideoRoom(
  userId: string,
  opts: SeedRoomOpts = {},
): Promise<{ sessionId: string }> {
  const sessionId = randomUUID();
  const patientId = randomUUID();
  const now = new Date();
  await runAsService(async (sdb) => {
    await sdb.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
      patientType: 'individual',
    });
    await sdb.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt: now,
      endAt: new Date(now.getTime() + 3600_000),
      durationMinutes: 50,
      modality: 'online',
      status: 'scheduled',
    });
    await sdb.insert(videoRooms).values({
      userId,
      sessionId,
      streamCallId: `session-${sessionId}`,
      patientToken: opts.patientToken ?? 'a'.repeat(64),
      patientJwt: 'mock-patient-jwt',
      partnerToken: opts.partnerToken ?? null,
      partnerJwt: opts.partnerToken ? 'mock-partner-jwt' : null,
      availableFrom: new Date(now.getTime() - 600_000),
      expiresAt: new Date(now.getTime() + 7200_000),
      status: opts.status ?? 'pending',
      patientWaitingAt: opts.patientWaitingAt ?? null,
      patientLastSeenAt: opts.patientLastSeenAt ?? null,
    });
  });
  return { sessionId };
}

async function readRoom(
  sessionId: string,
): Promise<{ patientWaitingAt: Date | null; patientLastSeenAt: Date | null }> {
  return runAsService(async (sdb) => {
    const [row] = await sdb
      .select({
        patientWaitingAt: videoRooms.patientWaitingAt,
        patientLastSeenAt: videoRooms.patientLastSeenAt,
      })
      .from(videoRooms)
      .where(eq(videoRooms.sessionId, sessionId))
      .limit(1);
    if (!row) throw new Error(`no video_rooms row for session ${sessionId}`);
    return row;
  });
}

let ipCounter = 0;

/** Each request gets a unique IP to avoid the in-process rate-limit bucket. */
function makeRequest(body: unknown, ip?: string): NextRequest {
  ipCounter += 1;
  return new NextRequest('http://localhost/api/video/depart', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip ?? `10.2.0.${ipCounter % 250}`,
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/video/depart', () => {
  it('clears patient_last_seen_at and leaves patient_waiting_at unchanged on a pending room', async () => {
    const userId = randomUUID();
    const patientToken = 'a1'.repeat(32);
    const waitingAt = new Date(Date.now() - 120_000);
    const lastSeenAt = new Date(Date.now() - 5_000);
    await seedAuthUser(userId);
    const { sessionId } = await seedVideoRoom(userId, {
      status: 'pending',
      patientToken,
      patientWaitingAt: waitingAt,
      patientLastSeenAt: lastSeenAt,
    });

    const { POST } = await import('@/app/api/video/depart/route');
    const response = await POST(makeRequest({ token: patientToken }));

    expect(response.status).toBe(204);

    const room = await readRoom(sessionId);
    expect(room.patientLastSeenAt).toBeNull();
    // Audit marker is preserved exactly.
    expect(room.patientWaitingAt?.getTime()).toBe(waitingAt.getTime());
  });

  it('is idempotent — a second beacon updates zero rows', async () => {
    const userId = randomUUID();
    const patientToken = 'b2'.repeat(32);
    const waitingAt = new Date(Date.now() - 120_000);
    await seedAuthUser(userId);
    const { sessionId } = await seedVideoRoom(userId, {
      status: 'pending',
      patientToken,
      patientWaitingAt: waitingAt,
      patientLastSeenAt: new Date(Date.now() - 5_000),
    });

    const { POST } = await import('@/app/api/video/depart/route');

    const first = await POST(makeRequest({ token: patientToken }));
    expect(first.status).toBe(204);
    const afterFirst = await readRoom(sessionId);
    expect(afterFirst.patientLastSeenAt).toBeNull();

    // Second (duplicate) beacon: heartbeat already NULL → guard matches zero
    // rows; nothing changes.
    const second = await POST(makeRequest({ token: patientToken }));
    expect(second.status).toBe(204);
    const afterSecond = await readRoom(sessionId);
    expect(afterSecond.patientLastSeenAt).toBeNull();
    expect(afterSecond.patientWaitingAt?.getTime()).toBe(waitingAt.getTime());
  });

  it('does not clear liveness for an already-active room', async () => {
    const userId = randomUUID();
    const patientToken = 'c3'.repeat(32);
    const waitingAt = new Date(Date.now() - 120_000);
    const lastSeenAt = new Date(Date.now() - 5_000);
    await seedAuthUser(userId);
    const { sessionId } = await seedVideoRoom(userId, {
      status: 'active',
      patientToken,
      patientWaitingAt: waitingAt,
      patientLastSeenAt: lastSeenAt,
    });

    const { POST } = await import('@/app/api/video/depart/route');
    const response = await POST(makeRequest({ token: patientToken }));
    expect(response.status).toBe(204);

    // Liveness preserved — a beacon racing an admission must not clear it.
    const room = await readRoom(sessionId);
    expect(room.patientLastSeenAt?.getTime()).toBe(lastSeenAt.getTime());
    expect(room.patientWaitingAt?.getTime()).toBe(waitingAt.getTime());
  });

  it('rejects a malformed token (400) without updating any row', async () => {
    const userId = randomUUID();
    const patientToken = 'd4'.repeat(32);
    const lastSeenAt = new Date(Date.now() - 5_000);
    await seedAuthUser(userId);
    const { sessionId } = await seedVideoRoom(userId, {
      status: 'pending',
      patientToken,
      patientLastSeenAt: lastSeenAt,
    });

    const { POST } = await import('@/app/api/video/depart/route');
    // Too short → fails Zod length(64).
    const response = await POST(makeRequest({ token: 'abc123' }));
    expect(response.status).toBe(400);

    const room = await readRoom(sessionId);
    expect(room.patientLastSeenAt?.getTime()).toBe(lastSeenAt.getTime());
  });

  it('returns an opaque empty 204 for a well-formed but unknown token (no existence oracle), updating no row', async () => {
    const userId = randomUUID();
    const patientToken = 'e5'.repeat(32);
    const lastSeenAt = new Date(Date.now() - 5_000);
    await seedAuthUser(userId);
    const { sessionId } = await seedVideoRoom(userId, {
      status: 'pending',
      patientToken,
      patientLastSeenAt: lastSeenAt,
    });

    const { POST } = await import('@/app/api/video/depart/route');
    const unknownToken = 'f6'.repeat(32);
    const response = await POST(makeRequest({ token: unknownToken }));

    // Same response as a successful clear — reveals nothing about existence.
    expect(response.status).toBe(204);

    // The seeded room is untouched.
    const room = await readRoom(sessionId);
    expect(room.patientLastSeenAt?.getTime()).toBe(lastSeenAt.getTime());
  });

  it('exposes nothing in the response body', async () => {
    const userId = randomUUID();
    const patientToken = '17'.repeat(32);
    await seedAuthUser(userId);
    await seedVideoRoom(userId, {
      status: 'pending',
      patientToken,
      patientLastSeenAt: new Date(Date.now() - 5_000),
    });

    const { POST } = await import('@/app/api/video/depart/route');
    const response = await POST(makeRequest({ token: patientToken }));

    expect(response.status).toBe(204);
    const text = await response.text();
    expect(text).toBe('');
  });

  it('rate-limits over-limit requests before DB work', async () => {
    const userId = randomUUID();
    const patientToken = '28'.repeat(32);
    await seedAuthUser(userId);
    await seedVideoRoom(userId, {
      status: 'pending',
      patientToken,
      patientLastSeenAt: new Date(Date.now() - 5_000),
    });

    const { POST } = await import('@/app/api/video/depart/route');
    const ip = '203.0.113.7';

    // The limiter allows 10 per minute from the same IP; the 11th is throttled.
    let lastStatus = 0;
    for (let i = 0; i < 11; i += 1) {
      const response = await POST(makeRequest({ token: patientToken }, ip));
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });
});
