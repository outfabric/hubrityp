import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms, videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';

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
 * Builds the columns common to every video room used by these tests. Arrival
 * and liveness timestamps are intentionally omitted so each test can decide
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
// Tests — arrival (immutable) + liveness (mutable) columns
// ---------------------------------------------------------------------------

describe('video_rooms — patient_waiting_at and patient_last_seen_at', () => {
  it('defaults both timestamps to NULL on a fresh room', async () => {
    const { userId, sessionId } = await seedBaseline();

    const values = reservationValues(userId, sessionId);
    await runAsService(async (db) => {
      await db.insert(videoRooms).values(values);
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, values.id));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.patientWaitingAt).toBeNull();
    expect(rows[0]!.patientLastSeenAt).toBeNull();
  });

  it('persists explicit timestamp values for both columns', async () => {
    const { userId, sessionId } = await seedBaseline();

    const arrival = new Date('2026-06-26T12:00:00.000Z');
    const lastSeen = new Date('2026-06-26T12:00:30.000Z');
    const values = reservationValues(userId, sessionId);
    await runAsService(async (db) => {
      await db.insert(videoRooms).values({
        ...values,
        patientWaitingAt: arrival,
        patientLastSeenAt: lastSeen,
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, values.id));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.patientWaitingAt?.getTime()).toBe(arrival.getTime());
    expect(rows[0]!.patientLastSeenAt?.getTime()).toBe(lastSeen.getTime());
  });

  it('advances the liveness heartbeat repeatedly while the first-arrival marker stays fixed', async () => {
    const { userId, sessionId } = await seedBaseline();

    const arrival = new Date('2026-06-26T12:00:00.000Z');
    const values = reservationValues(userId, sessionId);
    await runAsService(async (db) => {
      await db.insert(videoRooms).values({
        ...values,
        patientWaitingAt: arrival,
        patientLastSeenAt: arrival,
      });
    });

    // Simulate three successive waiting-room polls: each advances the
    // liveness heartbeat but must never touch the immutable arrival marker.
    const heartbeats = [
      new Date('2026-06-26T12:00:15.000Z'),
      new Date('2026-06-26T12:00:30.000Z'),
      new Date('2026-06-26T12:00:45.000Z'),
    ];
    for (const beat of heartbeats) {
      await runAsService(async (db) => {
        await db
          .update(videoRooms)
          .set({ patientLastSeenAt: beat })
          .where(eq(videoRooms.id, values.id));
      });
    }

    const rows = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, values.id));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.patientWaitingAt?.getTime()).toBe(arrival.getTime());
    expect(rows[0]!.patientLastSeenAt?.getTime()).toBe(
      heartbeats[heartbeats.length - 1]!.getTime(),
    );
  });

  it('clears the liveness heartbeat to NULL on departure while keeping the arrival marker intact', async () => {
    const { userId, sessionId } = await seedBaseline();

    const arrival = new Date('2026-06-26T12:00:00.000Z');
    const values = reservationValues(userId, sessionId);
    await runAsService(async (db) => {
      await db.insert(videoRooms).values({
        ...values,
        patientWaitingAt: arrival,
        patientLastSeenAt: new Date('2026-06-26T12:00:30.000Z'),
      });
    });

    // Departure resets the liveness heartbeat; the arrival audit marker stays.
    await runAsService(async (db) => {
      await db
        .update(videoRooms)
        .set({ patientLastSeenAt: null })
        .where(eq(videoRooms.id, values.id));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.id, values.id));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.patientLastSeenAt).toBeNull();
    expect(rows[0]!.patientWaitingAt?.getTime()).toBe(arrival.getTime());
  });
});

// ---------------------------------------------------------------------------
// Tests — video_session_logs event_type CHECK admits patient_arrived
// ---------------------------------------------------------------------------

describe('video_session_logs — patient_arrived event type', () => {
  it('accepts an event_type of patient_arrived', async () => {
    const { userId, sessionId } = await seedBaseline();

    const logId = randomUUID();
    await runAsService(async (db) => {
      await db.insert(videoSessionLogs).values({
        id: logId,
        sessionId,
        userId,
        eventType: 'patient_arrived',
        participantRole: 'patient',
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.id, logId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventType).toBe('patient_arrived');
  });

  it('rejects an event_type outside the CHECK constraint set', async () => {
    const { userId, sessionId } = await seedBaseline();

    await expect(
      runAsService(async (db) => {
        await db.insert(videoSessionLogs).values({
          id: randomUUID(),
          sessionId,
          userId,
          eventType: 'patient_teleported',
          participantRole: 'patient',
        });
      }),
    ).rejects.toThrow();
  });
});
