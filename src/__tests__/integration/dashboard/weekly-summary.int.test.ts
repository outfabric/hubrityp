import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { getWeeklySummary } from '@/modules/dashboard';
import { startOfSaoPauloWeek } from '@/modules/dashboard/lib/sao-paulo-windows';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { evolutions } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

const MS_PER_HOUR = 60 * 60 * 1000;

// Anchor seeded rows to noon of the current SP week's Monday so they always
// fall inside the [weekStart, weekEnd) window regardless of when the suite
// runs (avoids the "ran near midnight / week rollover" flake class).
function weekAnchor(offsetHours = 0): Date {
  const now = new Date();
  const monday = startOfSaoPauloWeek(now);
  return new Date(monday.getTime() + 12 * MS_PER_HOUR + offsetHours * MS_PER_HOUR);
}

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

async function seedPatient(userId: string, patientId: string, createdAt?: Date): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
      ...(createdAt ? { createdAt } : {}),
    });
  });
}

async function seedSession(opts: {
  userId: string;
  patientId: string;
  startAt: Date;
  status: string;
}): Promise<string> {
  const id = randomUUID();
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id,
      userId: opts.userId,
      patientId: opts.patientId,
      startAt: opts.startAt,
      endAt: new Date(opts.startAt.getTime() + 50 * 60 * 1000),
      durationMinutes: 50,
      status: opts.status,
    });
  });
  return id;
}

async function seedEvolution(opts: {
  userId: string;
  patientId: string;
  sessionId: string;
  createdAt: Date;
}): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(evolutions).values({
      id: randomUUID(),
      userId: opts.userId,
      patientId: opts.patientId,
      sessionId: opts.sessionId,
      templateType: 'livre',
      content: { text: 'evolution' },
      createdAt: opts.createdAt,
    });
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as Parameters<typeof getWeeklySummary>[0];
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

// A clean slate before the suite: the reused container retains rows from
// prior suites that would otherwise pollute owner-scoped counts.
beforeAll(async () => {
  await cleanTestData();
});

// Shared FK-ordered cleaner — see the note in today-sessions.int.test.ts.
afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getWeeklySummary — real Postgres', () => {
  it('returns UNAUTHORIZED when there is no session', async () => {
    const result = await getWeeklySummary(fakeSupabaseClient(null));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('computes owner-only done / scheduled / new-patient / evolution counts', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, new Date()); // created this month

    await seedSession({ userId, patientId, startAt: weekAnchor(0), status: 'done' });
    await seedSession({ userId, patientId, startAt: weekAnchor(1), status: 'done' });
    await seedSession({ userId, patientId, startAt: weekAnchor(2), status: 'scheduled' });
    await seedSession({ userId, patientId, startAt: weekAnchor(3), status: 'confirmed' });

    const evoSession = await seedSession({
      userId,
      patientId,
      startAt: weekAnchor(4),
      status: 'done',
    });
    await seedEvolution({ userId, patientId, sessionId: evoSession, createdAt: weekAnchor(5) });

    const result = await getWeeklySummary(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionsDoneThisWeek).toBe(3); // two done + the evo session
    expect(result.sessionsScheduledThisWeek).toBe(2); // scheduled + confirmed
    expect(result.newPatientsThisMonth).toBe(1);
    expect(result.evolutionsThisWeek).toBe(1);
  });

  it('returns no-show rate null below threshold', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Only 3 resolved (done + no_show) — below the 5-session threshold.
    await seedSession({ userId, patientId, startAt: weekAnchor(0), status: 'done' });
    await seedSession({ userId, patientId, startAt: weekAnchor(1), status: 'done' });
    await seedSession({ userId, patientId, startAt: weekAnchor(2), status: 'no_show' });

    const result = await getWeeklySummary(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.noShowRatePercent).toBeNull();
  });

  it('computes no-show rate at or above threshold', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // 8 done + 2 no_show = 10 resolved; rate = 20%.
    for (let i = 0; i < 8; i++) {
      await seedSession({ userId, patientId, startAt: weekAnchor(i), status: 'done' });
    }
    await seedSession({ userId, patientId, startAt: weekAnchor(9), status: 'no_show' });
    await seedSession({ userId, patientId, startAt: weekAnchor(10), status: 'no_show' });

    const result = await getWeeklySummary(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.noShowRatePercent).toBe(20);
  });

  it("isolates tenants: B's sessions never contribute to A's summary", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientA, new Date());
    await seedPatient(userB, patientB, new Date());

    await seedSession({
      userId: userA,
      patientId: patientA,
      startAt: weekAnchor(0),
      status: 'done',
    });
    // B accrues a lot — none should leak into A.
    for (let i = 0; i < 6; i++) {
      await seedSession({
        userId: userB,
        patientId: patientB,
        startAt: weekAnchor(i),
        status: 'done',
      });
    }
    await seedSession({
      userId: userB,
      patientId: patientB,
      startAt: weekAnchor(7),
      status: 'no_show',
    });

    const result = await getWeeklySummary(fakeSupabaseClient(userA));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionsDoneThisWeek).toBe(1);
    expect(result.newPatientsThisMonth).toBe(1);
    expect(result.noShowRatePercent).toBeNull(); // A has only 1 resolved
  });
});
