import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { getPatientSessionSummary } from '@/modules/sessions/server/get-patient-session-summary';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { evolutions } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

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
      fullName: 'Seed Patient',
      patientType: 'individual',
    });
  });
}

interface SessionSeed {
  id?: string;
  userId: string;
  patientId: string | null;
  status: 'scheduled' | 'confirmed' | 'done' | 'cancelled' | 'no_show';
  startAt: Date;
  cancelledBy?: string | null;
  deletedAt?: Date | null;
  isBlocking?: boolean;
}

async function seedSession(seed: SessionSeed): Promise<string> {
  const id = seed.id ?? randomUUID();
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id,
      userId: seed.userId,
      patientId: seed.patientId,
      status: seed.status,
      startAt: seed.startAt,
      endAt: new Date(seed.startAt.getTime() + 50 * 60 * 1000),
      durationMinutes: 50,
      cancelledBy: seed.cancelledBy ?? null,
      deletedAt: seed.deletedAt ?? null,
      isBlocking: seed.isBlocking ?? false,
    });
  });
  return id;
}

async function seedEvolution(userId: string, patientId: string, sessionId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(evolutions).values({
      userId,
      patientId,
      sessionId,
      templateType: 'free_text',
      content: { text: 'seed' },
    });
  });
}

/** Minimal fake Supabase client whose `getUser` resolves to `userId` (or null). */
function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof getPatientSessionSummary>[0];
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// The Testcontainers DB is reused across suites (E2E, medical-records, …), so a
// hand-rolled FK-unsafe DELETE trips constraints like `video_rooms_session_id_fk`.
// Use the shared FK-ordered cleaner and wipe once up front for a clean slate.
beforeAll(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
});

// =====================================================================
// getPatientSessionSummary
// =====================================================================

describe('getPatientSessionSummary', () => {
  it('rejects an unauthenticated caller before touching the DB', async () => {
    const result = await getPatientSessionSummary(fakeSupabaseClient(null), randomUUID());
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('rejects a non-UUID patient id with INVALID_INPUT', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const result = await getPatientSessionSummary(fakeSupabaseClient(userId), 'not-a-uuid');
    expect(result).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });

  it('returns zeroed counts and null lastDoneAt for a patient with no sessions', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await getPatientSessionSummary(fakeSupabaseClient(userId), patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toEqual({
      doneTotal: 0,
      attendanceRate: 0,
      doneWithoutEvolution: 0,
      lastDoneAt: null,
    });
  });

  it('counts doneTotal and excludes therapist/NULL cancellations from the attendance denominator (RN-13.03)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Attendance buckets: 3 done, 1 patient cancellation, 1 no_show.
    // Denominator = 3 + 1 + 1 = 5 → rate = round(3/5*100) = 60.
    await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(10) });
    await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(9) });
    await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(8) });
    await seedSession({
      userId,
      patientId,
      status: 'cancelled',
      cancelledBy: 'patient',
      startAt: daysAgo(7),
    });
    await seedSession({ userId, patientId, status: 'no_show', startAt: daysAgo(6) });

    // Excluded from the denominator: therapist-initiated and NULL-attributed
    // cancellations must NOT lower the attendance rate.
    await seedSession({
      userId,
      patientId,
      status: 'cancelled',
      cancelledBy: 'psychologist',
      startAt: daysAgo(5),
    });
    await seedSession({
      userId,
      patientId,
      status: 'cancelled',
      cancelledBy: null,
      startAt: daysAgo(4),
    });
    // Non-terminal statuses never count toward the denominator either.
    await seedSession({ userId, patientId, status: 'scheduled', startAt: daysAgo(1) });

    const result = await getPatientSessionSummary(fakeSupabaseClient(userId), patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.doneTotal).toBe(3);
    expect(result.summary.attendanceRate).toBe(60);
  });

  it('counts doneWithoutEvolution via the evolution join (RN-13.04)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const withEvolution = await seedSession({
      userId,
      patientId,
      status: 'done',
      startAt: daysAgo(5),
    });
    await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(4) });
    await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(3) });
    // A no_show without an evolution must NOT count — only `done` rows do.
    await seedSession({ userId, patientId, status: 'no_show', startAt: daysAgo(2) });

    await seedEvolution(userId, patientId, withEvolution);

    const result = await getPatientSessionSummary(fakeSupabaseClient(userId), patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.doneTotal).toBe(3);
    // 3 done, 1 of which has an evolution → 2 missing evolution.
    expect(result.summary.doneWithoutEvolution).toBe(2);
  });

  it('reports lastDoneAt as the newest done session start', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const newest = daysAgo(2);
    await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(10) });
    await seedSession({ userId, patientId, status: 'done', startAt: newest });
    // A *later* session that is not `done` must not move lastDoneAt forward.
    await seedSession({ userId, patientId, status: 'scheduled', startAt: new Date() });

    const result = await getPatientSessionSummary(fakeSupabaseClient(userId), patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.lastDoneAt).toBe(newest.toISOString());
  });

  it('excludes soft-deleted and blocking rows from every metric (RN-13.01, RN-13.02)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // One genuinely visible done session.
    const visibleDoneAt = daysAgo(3);
    await seedSession({ userId, patientId, status: 'done', startAt: visibleDoneAt });

    // Soft-deleted done session — invisible (RN-13.01).
    await seedSession({
      userId,
      patientId,
      status: 'done',
      startAt: daysAgo(1),
      deletedAt: new Date(),
    });
    // Blocking row carrying this patient_id — invisible (RN-13.02). A blocking
    // slot must never reach a clinical metric.
    await seedSession({
      userId,
      patientId,
      status: 'done',
      startAt: daysAgo(1),
      isBlocking: true,
    });

    const result = await getPatientSessionSummary(fakeSupabaseClient(userId), patientId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.doneTotal).toBe(1);
    expect(result.summary.attendanceRate).toBe(100);
    // lastDoneAt must come from the visible session, not the newer deleted one.
    expect(result.summary.lastDoneAt).toBe(visibleDoneAt.toISOString());
  });

  it('owner-scopes: psychologist A sees none of B data even for a shared patient id', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientA);
    await seedPatient(userB, patientB);

    // B has 2 done sessions for B's own patient.
    await seedSession({ userId: userB, patientId: patientB, status: 'done', startAt: daysAgo(5) });
    await seedSession({ userId: userB, patientId: patientB, status: 'done', startAt: daysAgo(4) });

    // A asks for B's patient id — the user_id scope must yield nothing.
    const crossTenant = await getPatientSessionSummary(fakeSupabaseClient(userA), patientB);
    expect(crossTenant.ok).toBe(true);
    if (!crossTenant.ok) return;
    expect(crossTenant.summary.doneTotal).toBe(0);
    expect(crossTenant.summary.lastDoneAt).toBeNull();

    // B querying B's own patient sees the real counts.
    const ownData = await getPatientSessionSummary(fakeSupabaseClient(userB), patientB);
    expect(ownData.ok).toBe(true);
    if (!ownData.ok) return;
    expect(ownData.summary.doneTotal).toBe(2);
  });
});
