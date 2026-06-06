import { randomUUID } from 'node:crypto';

import type { StreamClient } from '@stream-io/node-sdk';
import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createVideoRoomHelper,
  type SessionData,
} from '@/modules/telepsicologia/server/create-video-room-helper';
import { reserveVideoRoom } from '@/modules/telepsicologia/server/reserve-video-room';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Mock Stream SDK — no real network calls. The activation path must register
// users, create the call and mint a JWT; capture those to assert on them.
// ---------------------------------------------------------------------------

const mockGetOrCreate = vi.fn().mockResolvedValue({ call: { cid: 'default:mock-call' } });
const mockGenerateCallToken = vi.fn().mockReturnValue('mock-patient-jwt-token');
const mockUpsertUsers = vi.fn().mockResolvedValue({});

const mockStreamClient = {
  upsertUsers: mockUpsertUsers,
  video: {
    call: () => ({
      getOrCreate: mockGetOrCreate,
    }),
  },
  generateCallToken: mockGenerateCallToken,
} as unknown as StreamClient;

// ---------------------------------------------------------------------------
// Fixtures
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

async function seedPatient(userId: string, patientId: string, fullName: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName,
      patientType: 'individual',
    });
  });
}

async function seedSession(
  userId: string,
  sessionId: string,
  patientId: string,
  startAt: Date,
  endAt: Date,
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt,
      endAt,
      durationMinutes: 50,
      modality: 'online',
      status: 'scheduled',
    });
  });
}

interface Baseline {
  userId: string;
  patientId: string;
  sessionId: string;
  startAt: Date;
  endAt: Date;
  sessionData: SessionData;
}

async function seedBaseline(): Promise<Baseline> {
  const userId = randomUUID();
  const patientId = randomUUID();
  const sessionId = randomUUID();
  // Anchored in the future so the window is independent of wall-clock time.
  const startAt = new Date('2030-01-15T14:00:00.000Z');
  const endAt = new Date('2030-01-15T14:50:00.000Z');

  await seedAuthUser(userId);
  await seedProfile(userId, 'Dr. Ana Souza');
  await seedPatient(userId, patientId, 'João da Silva');
  await seedSession(userId, sessionId, patientId, startAt, endAt);

  return {
    userId,
    patientId,
    sessionId,
    startAt,
    endAt,
    sessionData: {
      id: sessionId,
      userId,
      patientId,
      startAt,
      endAt,
      psychologistName: 'Dr. Ana Souza',
      patientFullName: 'João da Silva',
    },
  };
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

describe('createVideoRoomHelper — activation mode', () => {
  it('(a) activates a reserved row (stream_call_id NULL) via UPDATE, preserving token + window', async () => {
    const baseline = await seedBaseline();
    const { db } = openClient();

    // Reserve first: creates a row with stream_call_id=NULL + patient_jwt=NULL.
    const reservation = await reserveVideoRoom(
      {
        id: baseline.sessionId,
        userId: baseline.userId,
        startAt: baseline.startAt,
        endAt: baseline.endAt,
      },
      db,
    );
    expect(reservation.ok).toBe(true);
    if (!reservation.ok) return;

    const before = await runAsService(async (rdb) =>
      rdb.select().from(videoRooms).where(eq(videoRooms.sessionId, baseline.sessionId)),
    );
    expect(before).toHaveLength(1);
    const reservedRow = before[0]!;
    expect(reservedRow.streamCallId).toBeNull();
    expect(reservedRow.patientJwt).toBeNull();

    // Activate.
    const result = await createVideoRoomHelper(mockStreamClient, baseline.sessionData, db);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Stream side effects ran on activation.
    expect(mockUpsertUsers).toHaveBeenCalledOnce();
    expect(mockGetOrCreate).toHaveBeenCalledOnce();
    expect(mockGenerateCallToken).toHaveBeenCalledOnce();

    // Same row updated in place — no duplicate, same id + token + window.
    const after = await runAsService(async (rdb) =>
      rdb.select().from(videoRooms).where(eq(videoRooms.sessionId, baseline.sessionId)),
    );
    expect(after).toHaveLength(1);
    const activatedRow = after[0]!;

    expect(activatedRow.id).toBe(reservedRow.id);
    expect(activatedRow.streamCallId).toBe(`session-${baseline.sessionId}`);
    expect(activatedRow.patientJwt).toBe('mock-patient-jwt-token');
    // Token + window preserved from the reservation.
    expect(activatedRow.patientToken).toBe(reservation.patientToken);
    expect(activatedRow.availableFrom.getTime()).toBe(reservedRow.availableFrom.getTime());
    expect(activatedRow.expiresAt.getTime()).toBe(reservedRow.expiresAt.getTime());

    expect(result.room.id).toBe(reservedRow.id);
    expect(result.room.streamCallId).toBe(`session-${baseline.sessionId}`);
  });

  it('(b) returns a fully activated room (stream_call_id NOT NULL) untouched, with no Stream calls', async () => {
    const baseline = await seedBaseline();
    const { db } = openClient();

    // First call: no row exists → full creation (INSERT) activates the room.
    const first = await createVideoRoomHelper(mockStreamClient, baseline.sessionData, db);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    vi.clearAllMocks();

    // Second call: row already activated → returned untouched.
    const second = await createVideoRoomHelper(mockStreamClient, baseline.sessionData, db);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.room.id).toBe(first.room.id);
    expect(second.room.patientToken).toBe(first.room.patientToken);

    // No Stream side effects on the idempotent path.
    expect(mockUpsertUsers).not.toHaveBeenCalled();
    expect(mockGetOrCreate).not.toHaveBeenCalled();
    expect(mockGenerateCallToken).not.toHaveBeenCalled();

    const rows = await runAsService(async (rdb) =>
      rdb.select().from(videoRooms).where(eq(videoRooms.sessionId, baseline.sessionId)),
    );
    expect(rows).toHaveLength(1);
  });

  it('(c) runs the full INSERT path when no reserved row exists (backward compat)', async () => {
    const baseline = await seedBaseline();
    const { db } = openClient();

    // No reservation — straight to the helper.
    const result = await createVideoRoomHelper(mockStreamClient, baseline.sessionData, db);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Stream side effects ran; a fresh token was generated.
    expect(mockUpsertUsers).toHaveBeenCalledOnce();
    expect(mockGetOrCreate).toHaveBeenCalledOnce();
    expect(mockGenerateCallToken).toHaveBeenCalledOnce();

    const rows = await runAsService(async (rdb) =>
      rdb.select().from(videoRooms).where(eq(videoRooms.sessionId, baseline.sessionId)),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.streamCallId).toBe(`session-${baseline.sessionId}`);
    expect(row.patientJwt).toBe('mock-patient-jwt-token');
    expect(row.patientToken).toMatch(/^[0-9a-f]{64}$/);
    expect(row.status).toBe('pending');
  });
});
