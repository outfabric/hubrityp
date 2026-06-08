import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { listOverdueEvolutionsImpl } from '@/modules/agenda/server/list-overdue-evolutions';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { evolutions } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Time anchors. `OVERDUE_THRESHOLD_DAYS` mirrors the production window so the
// fixtures sit unambiguously on either side of the boundary.
// ---------------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
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

async function seedPatient(userId: string, fullName: string): Promise<string> {
  return runAsService(async (db) => {
    const [row] = await db
      .insert(patients)
      .values({ userId, fullName, patientType: 'individual' })
      .returning({ id: patients.id });
    return row!.id;
  });
}

interface SeedSessionOptions {
  userId: string;
  patientId: string;
  startAt: Date;
  status?: string;
  deletedAt?: Date | null;
  modality?: 'in_person' | 'online' | null;
}

async function seedSession(opts: SeedSessionOptions): Promise<string> {
  return runAsService(async (db) => {
    const [row] = await db
      .insert(sessions)
      .values({
        userId: opts.userId,
        patientId: opts.patientId,
        isBlocking: false,
        status: opts.status ?? 'done',
        modality: opts.modality ?? null,
        durationMinutes: 50,
        startAt: opts.startAt,
        endAt: new Date(opts.startAt.getTime() + 50 * 60 * 1000),
        deletedAt: opts.deletedAt ?? null,
      })
      .returning({ id: sessions.id });
    return row!.id;
  });
}

async function seedEvolution(userId: string, patientId: string, sessionId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(evolutions).values({
      userId,
      patientId,
      sessionId,
      templateType: 'free_text',
      content: dsql`'{}'::jsonb`,
    });
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof listOverdueEvolutionsImpl>[0];
}

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// listOverdueEvolutionsImpl
// ---------------------------------------------------------------------------

describe('listOverdueEvolutionsImpl', () => {
  it('rejects an unauthenticated caller', async () => {
    const result = await listOverdueEvolutionsImpl(fakeSupabaseClient(null));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('returns only done sessions older than 7 days without an evolution, oldest first', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const patientA = await seedPatient(userId, 'Ana Lima');
    const patientB = await seedPatient(userId, 'Bruno Souza');
    const patientC = await seedPatient(userId, 'Carla Dias');

    // INCLUDED: a 10-day-old done session with no evolution.
    const tenDays = await seedSession({
      userId,
      patientId: patientA,
      startAt: daysAgo(10),
      modality: 'in_person',
    });

    // INCLUDED: a much-older (weeks-old) done session — NOT week-bounded.
    const thirtyDays = await seedSession({
      userId,
      patientId: patientB,
      startAt: daysAgo(30),
      modality: 'online',
    });

    // EXCLUDED: done > 7d but HAS an evolution.
    const withEvolution = await seedSession({
      userId,
      patientId: patientC,
      startAt: daysAgo(15),
    });
    await seedEvolution(userId, patientC, withEvolution);

    // EXCLUDED: done but within the 7-day window.
    await seedSession({ userId, patientId: patientA, startAt: daysAgo(3) });

    // EXCLUDED: old but not `done` (scheduled / no_show / cancelled).
    await seedSession({
      userId,
      patientId: patientB,
      startAt: daysAgo(20),
      status: 'scheduled',
    });

    // EXCLUDED: old, done, no evolution — but soft-deleted.
    await seedSession({
      userId,
      patientId: patientC,
      startAt: daysAgo(25),
      deletedAt: new Date(),
    });

    const result = await listOverdueEvolutionsImpl(fakeSupabaseClient(userId));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.items.map((i) => i.sessionId)).toEqual([thirtyDays, tenDays]);

    const oldest = result.items[0]!;
    expect(oldest.sessionId).toBe(thirtyDays);
    expect(oldest.patientName).toBe('Bruno Souza');
    expect(oldest.patientId).toBe(patientB);
    expect(oldest.modality).toBe('online');
    expect(oldest.daysOverdue).toBeGreaterThanOrEqual(30);

    const newer = result.items[1]!;
    expect(newer.sessionId).toBe(tenDays);
    expect(newer.patientName).toBe('Ana Lima');
    expect(newer.modality).toBe('presencial');
    expect(newer.daysOverdue).toBeGreaterThanOrEqual(10);
    expect(newer.daysOverdue).toBeLessThan(oldest.daysOverdue);
  });

  it('resolves modality from the location when the session modality is absent', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const patientId = await seedPatient(userId, 'Diego Reis');

    const { locations } = await import('@/shared/db/schema/agenda/tables');
    const locationId = await runAsService(async (db) => {
      const [row] = await db
        .insert(locations)
        .values({ userId, name: 'Sala Online', type: 'online' })
        .returning({ id: locations.id });
      return row!.id;
    });

    const sessionId = await runAsService(async (db) => {
      const startAt = daysAgo(12);
      const [row] = await db
        .insert(sessions)
        .values({
          userId,
          patientId,
          isBlocking: false,
          status: 'done',
          modality: null,
          locationId,
          durationMinutes: 50,
          startAt,
          endAt: new Date(startAt.getTime() + 50 * 60 * 1000),
        })
        .returning({ id: sessions.id });
      return row!.id;
    });

    const result = await listOverdueEvolutionsImpl(fakeSupabaseClient(userId));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.items.find((i) => i.sessionId === sessionId);
    expect(item).toBeDefined();
    expect(item!.modality).toBe('online');
  });

  it('returns an empty list when the psychologist has no overdue evolutions', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const patientId = await seedPatient(userId, 'Elena Costa');
    // Only a recent (within-window) done session.
    await seedSession({ userId, patientId, startAt: daysAgo(2) });

    const result = await listOverdueEvolutionsImpl(fakeSupabaseClient(userId));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toEqual([]);
  });

  // RN-12.02: owner-scoping must never leak another psychologist's rows, even
  // though no caller-supplied id is accepted (the user id comes from the session).
  it("never returns another psychologist's overdue sessions (cross-tenant)", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    const patientA = await seedPatient(userA, 'Paciente A');
    const patientB = await seedPatient(userB, 'Paciente B');

    const sessionA = await seedSession({
      userId: userA,
      patientId: patientA,
      startAt: daysAgo(14),
    });
    const sessionB = await seedSession({
      userId: userB,
      patientId: patientB,
      startAt: daysAgo(21),
    });

    const resultA = await listOverdueEvolutionsImpl(fakeSupabaseClient(userA));
    expect(resultA.ok).toBe(true);
    if (!resultA.ok) return;
    expect(resultA.items.map((i) => i.sessionId)).toEqual([sessionA]);
    expect(resultA.items.some((i) => i.sessionId === sessionB)).toBe(false);

    const resultB = await listOverdueEvolutionsImpl(fakeSupabaseClient(userB));
    expect(resultB.ok).toBe(true);
    if (!resultB.ok) return;
    expect(resultB.items.map((i) => i.sessionId)).toEqual([sessionB]);
    expect(resultB.items.some((i) => i.sessionId === sessionA)).toBe(false);
  });
});
