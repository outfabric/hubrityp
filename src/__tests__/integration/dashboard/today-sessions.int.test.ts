import { randomUUID } from 'node:crypto';

import { fromZonedTime } from 'date-fns-tz';
import { sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { getTodaySessions } from '@/modules/dashboard';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

const SAO_PAULO_TZ = 'America/Sao_Paulo';

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

async function seedPatient(userId: string, patientId: string, name: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({ id: patientId, userId, fullName: name });
  });
}

interface SeedSessionOpts {
  userId: string;
  patientId?: string | null;
  startAt: Date;
  modality?: 'in_person' | 'online' | null;
  status?: string;
  isBlocking?: boolean;
  blockingTitle?: string | null;
  deletedAt?: Date | null;
}

async function seedSession(opts: SeedSessionOpts): Promise<string> {
  const id = randomUUID();
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id,
      userId: opts.userId,
      patientId: opts.patientId ?? null,
      startAt: opts.startAt,
      endAt: new Date(opts.startAt.getTime() + 50 * 60 * 1000),
      durationMinutes: 50,
      modality: opts.modality ?? null,
      status: opts.status ?? 'scheduled',
      isBlocking: opts.isBlocking ?? false,
      blockingTitle: opts.blockingTitle ?? null,
      deletedAt: opts.deletedAt ?? null,
    });
  });
  return id;
}

/** UTC instant for a wall-clock time on the current SP calendar day. */
function todayAtSaoPaulo(hour: number, minute = 0): Date {
  const now = new Date();
  // Build the SP-local date parts so the time lands on "today" in SP, then
  // convert to the equivalent UTC instant.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return fromZonedTime(`${parts}T${hh}:${mm}:00`, SAO_PAULO_TZ);
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as Parameters<typeof getTodaySessions>[0];
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

// Use the shared FK-ordered cleaner: the reused Testcontainers DB retains rows
// from other suites (e.g. video_rooms referencing sessions), so an unfiltered
// `DELETE FROM sessions` here would trip a foreign-key constraint. A `beforeAll`
// also wipes the slate so prior-suite rows never pollute owner-scoped counts.
beforeAll(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getTodaySessions — real Postgres', () => {
  it('returns UNAUTHORIZED when there is no session', async () => {
    const result = await getTodaySessions(fakeSupabaseClient(null));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it("returns only the owner's sessions today, ordered by start time", async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Ana');

    // Out of order: 16h then 09h — expect ascending output.
    await seedSession({ userId, patientId, startAt: todayAtSaoPaulo(16), modality: 'online' });
    await seedSession({ userId, patientId, startAt: todayAtSaoPaulo(9), modality: 'in_person' });

    const result = await getTodaySessions(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessions).toHaveLength(2);
    const [first, second] = result.sessions;
    expect(first!.startAt.getTime()).toBeLessThan(second!.startAt.getTime());
    expect(first!.patientName).toBe('Ana');
  });

  it('excludes blocking slots and soft-deleted sessions', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Bruno');

    await seedSession({ userId, patientId, startAt: todayAtSaoPaulo(10) });
    await seedSession({
      userId,
      patientId: null,
      startAt: todayAtSaoPaulo(11),
      isBlocking: true,
      blockingTitle: 'Almoço',
    });
    await seedSession({
      userId,
      patientId,
      startAt: todayAtSaoPaulo(12),
      deletedAt: new Date(),
    });

    const result = await getTodaySessions(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessions).toHaveLength(1);
  });

  it('selects the next upcoming session (start >= now) as `next`', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Carla');

    const past = new Date(Date.now() - 60 * 60 * 1000); // 1h ago, still today
    const soon = new Date(Date.now() + 30 * 60 * 1000); // 30m from now
    const later = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3h from now
    await seedSession({ userId, patientId, startAt: past, status: 'done' });
    const soonId = await seedSession({ userId, patientId, startAt: soon });
    await seedSession({ userId, patientId, startAt: later });

    const result = await getTodaySessions(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next).not.toBeNull();
    expect(result.next?.sessionId).toBe(soonId);
  });

  it("returns next = null when all of today's sessions are in the past", async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Diego');

    await seedSession({
      userId,
      patientId,
      startAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      status: 'done',
    });

    const result = await getTodaySessions(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next).toBeNull();
    expect(result.sessions).toHaveLength(1);
  });

  it('builds openHref by modality (online → video, in_person → patient file)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Elena');

    const onlineId = await seedSession({
      userId,
      patientId,
      startAt: todayAtSaoPaulo(9),
      modality: 'online',
    });
    await seedSession({
      userId,
      patientId,
      startAt: todayAtSaoPaulo(10),
      modality: 'in_person',
    });

    const result = await getTodaySessions(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const online = result.sessions.find((s) => s.modality === 'online');
    const inPerson = result.sessions.find((s) => s.modality === 'in_person');
    expect(online?.openHref).toBe(`/sessao/${onlineId}/video`);
    expect(inPerson?.openHref).toBe(`/pacientes/${patientId}`);
  });

  it("isolates tenants: A never sees B's sessions (cross-user RLS scope)", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientA, 'A-Patient');
    await seedPatient(userB, patientB, 'B-Patient');

    await seedSession({ userId: userA, patientId: patientA, startAt: todayAtSaoPaulo(9) });
    await seedSession({ userId: userB, patientId: patientB, startAt: todayAtSaoPaulo(10) });
    await seedSession({ userId: userB, patientId: patientB, startAt: todayAtSaoPaulo(11) });

    const result = await getTodaySessions(fakeSupabaseClient(userA));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.patientName).toBe('A-Patient');
    // Zero of B's rows leak through.
    expect(result.sessions.some((s) => s.patientName === 'B-Patient')).toBe(false);
  });
});
