import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ROOM_AVAILABLE_BEFORE_MINUTES,
  ROOM_EXPIRES_AFTER_HOURS,
} from '@/modules/telepsicologia/lib/room-constants';
import {
  reserveVideoRoom,
  type ReserveSessionData,
} from '@/modules/telepsicologia/server/reserve-video-room';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

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

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
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

/**
 * Seeds an owner + patient + online session with a deterministic time window
 * and returns the reservation input the helper expects.
 */
async function seedBaseline(): Promise<ReserveSessionData> {
  const userId = randomUUID();
  const patientId = randomUUID();
  const sessionId = randomUUID();
  // Anchored well in the future so the window is independent of wall-clock time.
  const startAt = new Date('2030-01-15T14:00:00.000Z');
  const endAt = new Date('2030-01-15T14:50:00.000Z');

  await seedAuthUser(userId);
  await seedPatient(userId, patientId);
  await seedSession(userId, sessionId, patientId, startAt, endAt);

  return { id: sessionId, userId, startAt, endAt };
}

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reserveVideoRoom', () => {
  it('(a) reserves a partial room with token, NULL stream columns and computed window', async () => {
    const session = await seedBaseline();
    const { db } = openClient();

    const result = await reserveVideoRoom(session, db);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 64-char lowercase hex token (randomBytes(32) -> 32 bytes -> 64 hex chars).
    expect(result.patientToken).toMatch(/^[0-9a-f]{64}$/);

    const rows = await runAsService(async (rdb) => {
      return rdb.select().from(videoRooms).where(eq(videoRooms.sessionId, session.id));
    });

    expect(rows).toHaveLength(1);
    const room = rows[0]!;
    expect(room.patientToken).toBe(result.patientToken);
    expect(room.userId).toBe(session.userId);
    expect(room.streamCallId).toBeNull();
    expect(room.patientJwt).toBeNull();
    expect(room.status).toBe('pending');

    // availableFrom = startAt − 10 minutes; expiresAt = endAt + 1 hour.
    const expectedAvailableFrom = new Date(
      session.startAt.getTime() - ROOM_AVAILABLE_BEFORE_MINUTES * 60 * 1000,
    );
    const expectedExpiresAt = new Date(
      session.endAt.getTime() + ROOM_EXPIRES_AFTER_HOURS * 60 * 60 * 1000,
    );
    expect(room.availableFrom.getTime()).toBe(expectedAvailableFrom.getTime());
    expect(room.expiresAt.getTime()).toBe(expectedExpiresAt.getTime());
  });

  it('(b) is idempotent: a second call returns the existing token without a duplicate', async () => {
    const session = await seedBaseline();
    const { db } = openClient();

    const first = await reserveVideoRoom(session, db);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await reserveVideoRoom(session, db);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.patientToken).toBe(first.patientToken);

    const rows = await runAsService(async (rdb) => {
      return rdb.select().from(videoRooms).where(eq(videoRooms.sessionId, session.id));
    });
    expect(rows).toHaveLength(1);
  });

  it('(c) concurrent calls do not produce duplicate rows (unique session_id)', async () => {
    const session = await seedBaseline();

    // Each call opens its own short-lived connection — true concurrency racing
    // the unique index on session_id.
    const results = await Promise.all([
      reserveVideoRoom(session, openClient().db),
      reserveVideoRoom(session, openClient().db),
      reserveVideoRoom(session, openClient().db),
    ]);

    for (const result of results) {
      expect(result.ok).toBe(true);
    }

    const tokens = new Set(results.map((r) => (r.ok ? r.patientToken : '')));
    // The unique constraint collapses the race to a single persisted row, so
    // every caller must observe the same winning token.
    expect(tokens.size).toBe(1);

    const rows = await runAsService(async (rdb) => {
      return rdb.select().from(videoRooms).where(eq(videoRooms.sessionId, session.id));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.patientToken).toBe([...tokens][0]);
  });
});
