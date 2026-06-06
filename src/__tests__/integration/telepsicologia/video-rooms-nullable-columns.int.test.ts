import { randomUUID } from 'node:crypto';

import { and, eq, isNull, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
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

/**
 * Builds the columns common to every video room used by these tests. Stream
 * call id and patient JWT are intentionally omitted so each test can decide
 * whether to populate them.
 */
function reservationValues(userId: string, sessionId: string) {
  const now = new Date();
  return {
    id: randomUUID(),
    userId,
    sessionId,
    patientToken: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
    availableFrom: now,
    expiresAt: new Date(now.getTime() + 7200_000),
    status: 'pending' as const,
  };
}

/**
 * Seeds an owner + patient + online session and returns their ids, so each
 * test starts from a clean, FK-satisfying baseline.
 */
async function seedBaseline(): Promise<{ userId: string; sessionId: string }> {
  const userId = randomUUID();
  const patientId = randomUUID();
  const sessionId = randomUUID();
  await seedAuthUser(userId);
  await seedPatient(userId, patientId);
  await seedSession(userId, sessionId, patientId);
  return { userId, sessionId };
}

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Tests — nullable stream_call_id + patient_jwt (reservation lifecycle)
// ---------------------------------------------------------------------------

describe('video_rooms — nullable stream_call_id and patient_jwt', () => {
  it('(a) inserts a reservation row with NULL stream_call_id and NULL patient_jwt', async () => {
    const { userId, sessionId } = await seedBaseline();

    const values = reservationValues(userId, sessionId);
    await runAsService(async (db) => {
      await db.insert(videoRooms).values({
        ...values,
        streamCallId: null,
        patientJwt: null,
      });
    });

    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(videoRooms)
        .where(
          and(
            eq(videoRooms.id, values.id),
            isNull(videoRooms.streamCallId),
            isNull(videoRooms.patientJwt),
          ),
        );
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.streamCallId).toBeNull();
    expect(rows[0]!.patientJwt).toBeNull();
    expect(rows[0]!.status).toBe('pending');
  });

  it('(b) inserts a fully-activated row with both columns populated (backward compat)', async () => {
    const { userId, sessionId } = await seedBaseline();

    const values = reservationValues(userId, sessionId);
    await runAsService(async (db) => {
      await db.insert(videoRooms).values({
        ...values,
        streamCallId: `session-${sessionId}`,
        patientJwt: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.patient',
        status: 'active',
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, values.id));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.streamCallId).toBe(`session-${sessionId}`);
    expect(rows[0]!.patientJwt).toBe('eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.patient');
    expect(rows[0]!.status).toBe('active');
  });

  it('(c) activates a reserved row: UPDATE NULL columns to non-NULL values', async () => {
    const { userId, sessionId } = await seedBaseline();

    // Phase 1: reservation (NULLs).
    const values = reservationValues(userId, sessionId);
    await runAsService(async (db) => {
      await db.insert(videoRooms).values({
        ...values,
        streamCallId: null,
        patientJwt: null,
      });
    });

    // Phase 2: activation (UPDATE the existing row in place).
    await runAsService(async (db) => {
      await db
        .update(videoRooms)
        .set({
          streamCallId: `session-${sessionId}`,
          patientJwt: 'activated-jwt-token',
          status: 'active',
        })
        .where(eq(videoRooms.id, values.id));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, values.id));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.streamCallId).toBe(`session-${sessionId}`);
    expect(rows[0]!.patientJwt).toBe('activated-jwt-token');
    expect(rows[0]!.status).toBe('active');
  });
});
