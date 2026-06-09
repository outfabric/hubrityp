import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { decodeSessionHistoryCursor } from '@/modules/sessions/lib/session-history-cursor';
import { getNearestFutureSession } from '@/modules/sessions/server/get-nearest-future-session';
import { getPatientSessionHistoryList } from '@/modules/sessions/server/get-patient-session-history-list';
import { locations, sessions } from '@/shared/db/schema/agenda/tables';
import { evolutions } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

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
      fullName: 'Seed Patient',
      patientType: 'individual',
    });
  });
}

async function seedLocation(userId: string, locationId: string, name: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(locations).values({ id: locationId, userId, name, type: 'in_person' });
  });
}

interface SessionSeed {
  id?: string;
  userId: string;
  patientId: string | null;
  status: 'scheduled' | 'confirmed' | 'done' | 'cancelled' | 'no_show';
  startAt: Date;
  deletedAt?: Date | null;
  isBlocking?: boolean;
  patientIds?: string[] | null;
  rescheduledFromSessionId?: string | null;
  locationId?: string | null;
  amount?: string | null;
  modality?: 'in_person' | 'online' | null;
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
      deletedAt: seed.deletedAt ?? null,
      isBlocking: seed.isBlocking ?? false,
      patientIds: seed.patientIds ?? null,
      rescheduledFromSessionId: seed.rescheduledFromSessionId ?? null,
      locationId: seed.locationId ?? null,
      amount: seed.amount ?? null,
      modality: seed.modality ?? null,
    });
  });
  return id;
}

async function seedEvolution(
  userId: string,
  patientId: string,
  sessionId: string,
  finalizedAt: Date | null,
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(evolutions).values({
      userId,
      patientId,
      sessionId,
      templateType: 'free_text',
      content: { text: 'seed' },
      finalizedAt,
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
  } as Parameters<typeof getPatientSessionHistoryList>[0];
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// The Testcontainers DB is reused across suites, so use the shared FK-ordered
// cleaner and wipe once up front for a clean slate.
beforeAll(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
});

// =====================================================================
// getNearestFutureSession
// =====================================================================

describe('getNearestFutureSession', () => {
  it('rejects an unauthenticated caller before touching the DB', async () => {
    const result = await getNearestFutureSession(fakeSupabaseClient(null), randomUUID());
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('rejects a non-UUID patient id with INVALID_INPUT', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const result = await getNearestFutureSession(fakeSupabaseClient(userId), 'not-a-uuid');
    expect(result).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });

  it('returns null when the patient has no upcoming session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(3) });

    const result = await getNearestFutureSession(fakeSupabaseClient(userId), patientId);
    expect(result).toEqual({ ok: true, session: null });
  });

  it('returns only the nearest future session for a 20-session recurrence (RF-13.04)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // 20 weekly scheduled occurrences, all in the future.
    const ids: { id: string; at: Date }[] = [];
    for (let week = 1; week <= 20; week++) {
      const at = daysFromNow(week * 7);
      const id = await seedSession({ userId, patientId, status: 'scheduled', startAt: at });
      ids.push({ id, at });
    }
    // Plus some past sessions that must never be returned as "future".
    await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(7) });

    const result = await getNearestFutureSession(fakeSupabaseClient(userId), patientId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session?.id).toBe(ids[0]!.id);
    expect(result.session?.startAt).toBe(ids[0]!.at.toISOString());
  });

  it('excludes soft-deleted and blocking rows from the future lookup', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // A nearer but soft-deleted future session, and a nearer blocking row.
    await seedSession({
      userId,
      patientId,
      status: 'scheduled',
      startAt: daysFromNow(1),
      deletedAt: new Date(),
    });
    await seedSession({
      userId,
      patientId,
      status: 'scheduled',
      startAt: daysFromNow(2),
      isBlocking: true,
    });
    const visible = await seedSession({
      userId,
      patientId,
      status: 'confirmed',
      startAt: daysFromNow(5),
    });

    const result = await getNearestFutureSession(fakeSupabaseClient(userId), patientId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session?.id).toBe(visible);
  });
});

// =====================================================================
// getPatientSessionHistoryList
// =====================================================================

describe('getPatientSessionHistoryList', () => {
  it('rejects an unauthenticated caller before touching the DB', async () => {
    const result = await getPatientSessionHistoryList(
      fakeSupabaseClient(null),
      { patientId: randomUUID() },
      null,
    );
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('rejects a non-UUID patient id with INVALID_INPUT', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const result = await getPatientSessionHistoryList(
      fakeSupabaseClient(userId),
      { patientId: 'not-a-uuid' },
      null,
    );
    expect(result).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });

  it('paginates 12 per page with a correct keyset cursor and nextCursor (RNF order)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // 30 done sessions, distinct start_at: daysAgo(1) is newest, daysAgo(30) oldest.
    for (let d = 1; d <= 30; d++) {
      await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(d) });
    }

    // Page 1 — 12 newest, descending.
    const page1 = await getPatientSessionHistoryList(
      fakeSupabaseClient(userId),
      { patientId, limit: 12 },
      null,
    );
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.sessions).toHaveLength(12);
    expect(page1.nextCursor).not.toBeNull();
    // Strictly descending by start_at.
    for (let i = 1; i < page1.sessions.length; i++) {
      expect(page1.sessions[i - 1]!.startAt > page1.sessions[i]!.startAt).toBe(true);
    }
    // Cursor encodes the LAST row of the page.
    const decoded = decodeSessionHistoryCursor(page1.nextCursor!);
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(page1.sessions.at(-1)!.id);
    expect(decoded!.startAt).toBe(page1.sessions.at(-1)!.startAt);

    // Page 2 — next 12, no overlap with page 1.
    const page2 = await getPatientSessionHistoryList(
      fakeSupabaseClient(userId),
      { patientId, limit: 12, cursor: page1.nextCursor! },
      null,
    );
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.sessions).toHaveLength(12);
    const page1Ids = new Set(page1.sessions.map((s) => s.id));
    expect(page2.sessions.some((s) => page1Ids.has(s.id))).toBe(false);
    // Page-2 head is strictly older than page-1 tail.
    expect(page1.sessions.at(-1)!.startAt > page2.sessions[0]!.startAt).toBe(true);

    // Page 3 — last 6, nextCursor null (no look-ahead row).
    const page3 = await getPatientSessionHistoryList(
      fakeSupabaseClient(userId),
      { patientId, limit: 12, cursor: page2.nextCursor! },
      null,
    );
    expect(page3.ok).toBe(true);
    if (!page3.ok) return;
    expect(page3.sessions).toHaveLength(6);
    expect(page3.nextCursor).toBeNull();
  });

  it('applies the optional status filter param (RF-13.03)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(5) });
    await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(4) });
    await seedSession({ userId, patientId, status: 'cancelled', startAt: daysAgo(3) });
    await seedSession({ userId, patientId, status: 'no_show', startAt: daysAgo(2) });

    const cancelled = await getPatientSessionHistoryList(
      fakeSupabaseClient(userId),
      { patientId, status: 'cancelled' },
      null,
    );
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.sessions).toHaveLength(1);
    expect(cancelled.sessions[0]!.status).toBe('cancelled');

    const done = await getPatientSessionHistoryList(
      fakeSupabaseClient(userId),
      { patientId, status: 'done' },
      null,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.sessions).toHaveLength(2);
    expect(done.sessions.every((s) => s.status === 'done')).toBe(true);
  });

  it('excludes the nearest-future session id from the list (no duplication)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(3) });
    const futureId = await seedSession({
      userId,
      patientId,
      status: 'scheduled',
      startAt: daysFromNow(7),
    });

    const future = await getNearestFutureSession(fakeSupabaseClient(userId), patientId);
    expect(future.ok && future.session?.id).toBe(futureId);

    const list = await getPatientSessionHistoryList(
      fakeSupabaseClient(userId),
      { patientId },
      futureId,
    );
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.sessions.some((s) => s.id === futureId)).toBe(false);
    expect(list.sessions).toHaveLength(1);
  });

  it('time-bounds the list: multiple future occurrences never leak (only past returned)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // A recurrence: 10 future weekly occurrences (scheduled/confirmed alternating).
    const futureIds: string[] = [];
    for (let week = 1; week <= 10; week++) {
      const id = await seedSession({
        userId,
        patientId,
        status: week % 2 === 0 ? 'confirmed' : 'scheduled',
        startAt: daysFromNow(week * 7),
      });
      futureIds.push(id);
    }
    // Plus a handful of genuine past sessions.
    const pastIds: string[] = [];
    for (let d = 1; d <= 4; d++) {
      pastIds.push(await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(d) }));
    }

    // The nearest-future session is excluded by id, but the time bound — not the
    // id exclusion — is what must keep the other 9 future occurrences out.
    const nearest = await getNearestFutureSession(fakeSupabaseClient(userId), patientId);
    expect(nearest.ok).toBe(true);
    if (!nearest.ok) return;
    const nearestId = nearest.session?.id ?? null;

    const list = await getPatientSessionHistoryList(
      fakeSupabaseClient(userId),
      { patientId, limit: 50 },
      nearestId,
    );
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const returnedIds = new Set(list.sessions.map((s) => s.id));
    // Exactly the past sessions, zero future ones.
    expect(list.sessions).toHaveLength(pastIds.length);
    expect(pastIds.every((id) => returnedIds.has(id))).toBe(true);
    expect(futureIds.some((id) => returnedIds.has(id))).toBe(false);
  });

  it('overdue non-terminal session is excluded from nearest-future but appears in history', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Past start_at but still `scheduled` (overdue, not yet done/no_show/cancelled).
    const overdueId = await seedSession({
      userId,
      patientId,
      status: 'scheduled',
      startAt: daysAgo(1),
    });
    // A genuine upcoming session so getNearestFutureSession has something to return.
    const upcomingId = await seedSession({
      userId,
      patientId,
      status: 'scheduled',
      startAt: daysFromNow(3),
    });

    // The overdue session is in the past, so it is NOT the nearest future one.
    const nearest = await getNearestFutureSession(fakeSupabaseClient(userId), patientId);
    expect(nearest.ok).toBe(true);
    if (!nearest.ok) return;
    expect(nearest.session?.id).toBe(upcomingId);

    // It DOES appear in the historical list under "Sessões anteriores".
    const list = await getPatientSessionHistoryList(
      fakeSupabaseClient(userId),
      { patientId },
      nearest.session?.id ?? null,
    );
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const returnedIds = list.sessions.map((s) => s.id);
    expect(returnedIds).toContain(overdueId);
    expect(returnedIds).not.toContain(upcomingId);
  });

  it('excludes soft-deleted and blocking rows from the list (RN-13.01, RN-13.02)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const visible = await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(3) });
    await seedSession({
      userId,
      patientId,
      status: 'done',
      startAt: daysAgo(2),
      deletedAt: new Date(),
    });
    await seedSession({
      userId,
      patientId,
      status: 'done',
      startAt: daysAgo(1),
      isBlocking: true,
    });

    const list = await getPatientSessionHistoryList(
      fakeSupabaseClient(userId),
      { patientId },
      null,
    );
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.sessions).toHaveLength(1);
    expect(list.sessions[0]!.id).toBe(visible);
  });

  it('surfaces the evolution join (id + finalizedAt) per row', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const withEvo = await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(4) });
    const withoutEvo = await seedSession({
      userId,
      patientId,
      status: 'done',
      startAt: daysAgo(2),
    });
    const finalizedAt = daysAgo(3);
    await seedEvolution(userId, patientId, withEvo, finalizedAt);

    const list = await getPatientSessionHistoryList(
      fakeSupabaseClient(userId),
      { patientId },
      null,
    );
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const evoRow = list.sessions.find((s) => s.id === withEvo)!;
    const plainRow = list.sessions.find((s) => s.id === withoutEvo)!;
    expect(evoRow.evolutionId).not.toBeNull();
    expect(evoRow.evolutionFinalizedAt).toBe(finalizedAt.toISOString());
    expect(plainRow.evolutionId).toBeNull();
    expect(plainRow.evolutionFinalizedAt).toBeNull();
  });

  it('resolves the "Remarcada de [data]" original date via the owner-scoped self-join', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const originalAt = daysAgo(10);
    const original = await seedSession({
      userId,
      patientId,
      status: 'cancelled',
      startAt: originalAt,
    });
    const rescheduled = await seedSession({
      userId,
      patientId,
      status: 'done',
      startAt: daysAgo(3),
      rescheduledFromSessionId: original,
    });

    const list = await getPatientSessionHistoryList(
      fakeSupabaseClient(userId),
      { patientId },
      null,
    );
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const row = list.sessions.find((s) => s.id === rescheduled)!;
    expect(row.rescheduledFromDate).toBe(originalAt.toISOString());
  });

  it('couple session payload exposes isCouple=true but NO partner identifier (LGPD-13.03)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const partnerId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedPatient(userId, partnerId);

    await seedSession({
      userId,
      patientId,
      status: 'done',
      startAt: daysAgo(3),
      patientIds: [patientId, partnerId],
    });

    const list = await getPatientSessionHistoryList(
      fakeSupabaseClient(userId),
      { patientId },
      null,
    );
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.sessions).toHaveLength(1);
    const row = list.sessions[0]!;
    expect(row.isCouple).toBe(true);

    // The partner id must not appear anywhere in the serialized payload.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(partnerId);
  });

  it('owner-scopes: A sees none of B data for a shared patient id', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userB, patientB);
    await seedSession({ userId: userB, patientId: patientB, status: 'done', startAt: daysAgo(3) });

    const crossTenant = await getPatientSessionHistoryList(
      fakeSupabaseClient(userA),
      { patientId: patientB },
      null,
    );
    expect(crossTenant.ok).toBe(true);
    if (!crossTenant.ok) return;
    expect(crossTenant.sessions).toHaveLength(0);
  });

  it('uses sessions_patient_id_start_at_idx (no seq scan) per the query plan (RNF-13.03)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const locationId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedLocation(userId, locationId, 'Sala 1');

    // Seed enough rows that the planner prefers the index over a seq scan.
    for (let d = 1; d <= 60; d++) {
      await seedSession({
        userId,
        patientId,
        status: 'done',
        startAt: daysAgo(d),
        locationId,
      });
    }

    // On a small reused container the planner may default to a seq scan; disable
    // it for this session to prove the planner CAN serve the patient-history hot
    // predicate from `sessions_patient_id_start_at_idx` (RNF-13.03).
    const { sql: sqlClient, db } = openClient();
    let plan: string;
    try {
      await db.execute(dsql`SET enable_seqscan = off`);
      const explainRows = await db.execute<{ 'QUERY PLAN': string }>(
        dsql`EXPLAIN (FORMAT TEXT)
             SELECT s.id
             FROM sessions s
             WHERE s.user_id = ${userId}
               AND s.patient_id = ${patientId}
               AND s.deleted_at IS NULL
               AND s.is_blocking = false
             ORDER BY s.start_at DESC, s.id DESC
             LIMIT 13`,
      );
      plan = explainRows.map((r) => r['QUERY PLAN']).join('\n');
    } finally {
      await sqlClient.end();
    }

    expect(plan, `Expected the patient-history index in the plan.\nPlan:\n${plan}`).toContain(
      'sessions_patient_id_start_at_idx',
    );
    expect(plan).not.toContain('Seq Scan on sessions');
  });
});
