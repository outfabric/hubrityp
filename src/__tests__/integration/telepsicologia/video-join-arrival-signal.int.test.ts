/**
 * Integration tests for the arrival + liveness signal on POST /api/video/join.
 *
 * Covers the `waiting` branch contract added in the waiting-room arrival
 * signal change:
 *  - first waiting poll sets BOTH patient_waiting_at and patient_last_seen_at
 *    and inserts exactly one `patient_arrived` log;
 *  - repeated polls advance patient_last_seen_at while patient_waiting_at stays
 *    fixed and no duplicate log is inserted;
 *  - a re-arrival poll after a departure (heartbeat NULL, waiting_at still set)
 *    re-stamps patient_last_seen_at and inserts no second log;
 *  - partner-token first arrival records participant_role='partner';
 *  - too_early/active/ended branches touch neither timestamp;
 *  - the waiting response body exposes only the three allowed fields.
 *
 * Runs against real Postgres (Testcontainers) so the COALESCE/RETURNING
 * arrival-detection runs on the actual server clock.
 */
import { randomUUID } from 'node:crypto';

import { and, eq, sql as dsql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessions } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms, videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Stream client mock — the waiting branch never upserts, but importing the
// route pulls in the Stream client module; mock it so no real client is built.
// ---------------------------------------------------------------------------

const upsertUsers = vi.fn((): Promise<void> => Promise.resolve());

vi.mock('@/modules/telepsicologia/server/stream-client', () => ({
  getStreamClient: () => ({ upsertUsers }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (sdb) => {
    await sdb.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedProfile(userId: string, fullName: string): Promise<void> {
  await runAsService(async (sdb) => {
    await sdb.insert(profiles).values({
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

interface SeedRoomOpts {
  status?: string;
  patientToken?: string;
  partnerToken?: string | null;
  streamCallId?: string | null;
  availableFrom?: Date;
  expiresAt?: Date;
  patientWaitingAt?: Date | null;
  patientLastSeenAt?: Date | null;
}

/** Seeds a session + patient + video_rooms row with full control over the
 * arrival/liveness columns and time window. */
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
      streamCallId: opts.streamCallId === undefined ? `session-${sessionId}` : opts.streamCallId,
      patientToken: opts.patientToken ?? 'a'.repeat(64),
      patientJwt: 'mock-patient-jwt',
      partnerToken: opts.partnerToken ?? null,
      partnerJwt: opts.partnerToken ? 'mock-partner-jwt' : null,
      availableFrom: opts.availableFrom ?? new Date(now.getTime() - 600_000),
      expiresAt: opts.expiresAt ?? new Date(now.getTime() + 7200_000),
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

async function readArrivalLogs(
  sessionId: string,
): Promise<Array<{ participantRole: string | null }>> {
  return runAsService(async (sdb) => {
    return sdb
      .select({ participantRole: videoSessionLogs.participantRole })
      .from(videoSessionLogs)
      .where(
        and(
          eq(videoSessionLogs.sessionId, sessionId),
          eq(videoSessionLogs.eventType, 'patient_arrived'),
        ),
      );
  });
}

let ipCounter = 0;

/** Each request gets a unique IP to avoid the in-process rate-limit bucket. */
function makeRequest(body: unknown): NextRequest {
  ipCounter += 1;
  return new NextRequest('http://localhost/api/video/join', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': `10.1.0.${ipCounter % 250}`,
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

describe('POST /api/video/join — arrival + liveness signal', () => {
  it('first waiting poll sets both timestamps and inserts exactly one patient_arrived log', async () => {
    const userId = randomUUID();
    const patientToken = 'a1'.repeat(32);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Arrival');
    const { sessionId } = await seedVideoRoom(userId, { status: 'pending', patientToken });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: patientToken }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('waiting');

    const room = await readRoom(sessionId);
    expect(room.patientWaitingAt).not.toBeNull();
    expect(room.patientLastSeenAt).not.toBeNull();
    // First poll: both set to the same server now().
    expect(room.patientWaitingAt?.getTime()).toBe(room.patientLastSeenAt?.getTime());

    const logs = await readArrivalLogs(sessionId);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.participantRole).toBe('patient');
  });

  it('repeated polls advance patient_last_seen_at while patient_waiting_at stays fixed, no duplicate log', async () => {
    const userId = randomUUID();
    const patientToken = 'b2'.repeat(32);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Heartbeat');
    const { sessionId } = await seedVideoRoom(userId, { status: 'pending', patientToken });

    const { POST } = await import('@/app/api/video/join/route');

    await POST(makeRequest({ token: patientToken }));
    const afterFirst = await readRoom(sessionId);

    // Ensure a measurable clock gap before the second poll.
    await sleep(15);

    await POST(makeRequest({ token: patientToken }));
    const afterSecond = await readRoom(sessionId);

    // waiting_at is immutable across polls.
    expect(afterSecond.patientWaitingAt?.getTime()).toBe(afterFirst.patientWaitingAt?.getTime());
    // last_seen advances.
    expect(afterSecond.patientLastSeenAt?.getTime()).toBeGreaterThan(
      afterFirst.patientLastSeenAt?.getTime() ?? 0,
    );

    const logs = await readArrivalLogs(sessionId);
    expect(logs).toHaveLength(1);
  });

  it('re-arrival after departure re-stamps last_seen and does not insert a second log', async () => {
    const userId = randomUUID();
    const patientToken = 'c3'.repeat(32);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Return');
    // Departed state: waiting_at set in the past, heartbeat NULL.
    const waitingAt = new Date(Date.now() - 300_000);
    const { sessionId } = await seedVideoRoom(userId, {
      status: 'pending',
      patientToken,
      patientWaitingAt: waitingAt,
      patientLastSeenAt: null,
    });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: patientToken }));
    expect(response.status).toBe(200);

    const room = await readRoom(sessionId);
    // waiting_at preserved (immutable).
    expect(room.patientWaitingAt?.getTime()).toBe(waitingAt.getTime());
    // Heartbeat re-established to a fresh, recent value.
    expect(room.patientLastSeenAt).not.toBeNull();
    expect(room.patientLastSeenAt!.getTime()).toBeGreaterThan(waitingAt.getTime());

    // No new arrival log — re-arrival is not a first arrival.
    const logs = await readArrivalLogs(sessionId);
    expect(logs).toHaveLength(0);
  });

  it('partner-token first arrival records participant_role=partner', async () => {
    const userId = randomUUID();
    const patientToken = 'd4'.repeat(32);
    const partnerToken = 'e5'.repeat(32);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Couple');
    const { sessionId } = await seedVideoRoom(userId, {
      status: 'pending',
      patientToken,
      partnerToken,
    });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: partnerToken }));
    expect(response.status).toBe(200);

    const room = await readRoom(sessionId);
    expect(room.patientWaitingAt).not.toBeNull();
    expect(room.patientLastSeenAt).not.toBeNull();

    const logs = await readArrivalLogs(sessionId);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.participantRole).toBe('partner');
  });

  it('too_early branch writes neither timestamp nor a log', async () => {
    const userId = randomUUID();
    const patientToken = 'f6'.repeat(32);
    const futureStart = new Date(Date.now() + 3600_000);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Early');
    const { sessionId } = await seedVideoRoom(userId, {
      status: 'pending',
      patientToken,
      availableFrom: futureStart,
      expiresAt: new Date(futureStart.getTime() + 7200_000),
    });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: patientToken }));
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('too_early');

    const room = await readRoom(sessionId);
    expect(room.patientWaitingAt).toBeNull();
    expect(room.patientLastSeenAt).toBeNull();
    expect(await readArrivalLogs(sessionId)).toHaveLength(0);
  });

  it('active branch writes neither timestamp nor a log', async () => {
    const userId = randomUUID();
    const patientToken = '17'.repeat(32);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Active');
    const { sessionId } = await seedVideoRoom(userId, { status: 'active', patientToken });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: patientToken }));
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('active');

    const room = await readRoom(sessionId);
    expect(room.patientWaitingAt).toBeNull();
    expect(room.patientLastSeenAt).toBeNull();
    expect(await readArrivalLogs(sessionId)).toHaveLength(0);
  });

  it('ended branch writes neither timestamp nor a log', async () => {
    const userId = randomUUID();
    const patientToken = '28'.repeat(32);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Ended');
    const { sessionId } = await seedVideoRoom(userId, { status: 'ended', patientToken });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: patientToken }));
    expect(response.status).toBe(410);

    const room = await readRoom(sessionId);
    expect(room.patientWaitingAt).toBeNull();
    expect(room.patientLastSeenAt).toBeNull();
    expect(await readArrivalLogs(sessionId)).toHaveLength(0);
  });

  it('waiting response body exposes only status, psychologistName, psychologistPhotoUrl', async () => {
    const userId = randomUUID();
    const patientToken = '39'.repeat(32);
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Lean');
    await seedVideoRoom(userId, { status: 'pending', patientToken });

    const { POST } = await import('@/app/api/video/join/route');
    const response = await POST(makeRequest({ token: patientToken }));

    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'psychologistName',
      'psychologistPhotoUrl',
      'status',
    ]);
    // No internal identifiers, tokens, JWTs, or timestamps leak.
    for (const forbidden of [
      'id',
      'roomId',
      'userId',
      'sessionId',
      'patientId',
      'patientToken',
      'partnerToken',
      'streamToken',
      'jwt',
      'patientJwt',
      'partnerJwt',
      'patientWaitingAt',
      'patientLastSeenAt',
      'patient_waiting_at',
      'patient_last_seen_at',
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });
});
