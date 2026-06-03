import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { getPendencias } from '@/modules/dashboard';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';
import { evolutions } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

async function seedPatient(opts: {
  userId: string;
  patientId: string;
  consentSignedAt?: Date | null;
  archivedAt?: Date | null;
}): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: opts.patientId,
      userId: opts.userId,
      fullName: 'Test Patient',
      consentSignedAt: opts.consentSignedAt ?? null,
      archivedAt: opts.archivedAt ?? null,
    });
  });
}

async function seedDoneSession(opts: {
  userId: string;
  patientId: string;
  startAt: Date;
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
      status: 'done',
    });
  });
  return id;
}

async function seedEvolution(opts: {
  userId: string;
  patientId: string;
  sessionId: string;
}): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(evolutions).values({
      id: randomUUID(),
      userId: opts.userId,
      patientId: opts.patientId,
      sessionId: opts.sessionId,
      templateType: 'livre',
      content: { text: 'evolution body' },
    });
  });
}

async function seedTranscription(opts: {
  userId: string;
  patientId: string;
  status: string;
}): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(aiTranscriptions).values({
      id: randomUUID(),
      userId: opts.userId,
      patientId: opts.patientId,
      source: 'manual_upload',
      status: opts.status,
    });
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as Parameters<typeof getPendencias>[0];
}

const eightDaysAgo = () => new Date(Date.now() - 8 * MS_PER_DAY);
const twoDaysAgo = () => new Date(Date.now() - 2 * MS_PER_DAY);

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

describe('getPendencias — real Postgres', () => {
  it('returns UNAUTHORIZED when there is no session', async () => {
    const result = await getPendencias(fakeSupabaseClient(null));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('counts overdue evolutions (done > 7d ago with no evolution)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient({ userId, patientId, consentSignedAt: new Date() });

    // Two overdue done sessions without evolution.
    await seedDoneSession({ userId, patientId, startAt: eightDaysAgo() });
    await seedDoneSession({ userId, patientId, startAt: eightDaysAgo() });

    // One done session WITH an evolution — must not count.
    const withEvo = await seedDoneSession({ userId, patientId, startAt: eightDaysAgo() });
    await seedEvolution({ userId, patientId, sessionId: withEvo });

    // One recent (< 7d) done session without evolution — not yet overdue.
    await seedDoneSession({ userId, patientId, startAt: twoDaysAgo() });

    const result = await getPendencias(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overdueEvolutionsCount).toBe(2);
    expect(result.overdueEvolutionsHref).toMatch(/^\/agenda/);
  });

  it('counts patients missing consent (consent_signed_at IS NULL, not archived)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await seedPatient({ userId, patientId: randomUUID(), consentSignedAt: null });
    await seedPatient({ userId, patientId: randomUUID(), consentSignedAt: null });
    // Signed — must not count.
    await seedPatient({ userId, patientId: randomUUID(), consentSignedAt: new Date() });
    // Archived without consent — must not count (not actionable).
    await seedPatient({
      userId,
      patientId: randomUUID(),
      consentSignedAt: null,
      archivedAt: new Date(),
    });

    const result = await getPendencias(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patientsMissingConsentCount).toBe(2);
    expect(result.patientsMissingConsentHref).toMatch(/^\/pacientes/);
  });

  it('counts AI notes awaiting review (status = ready), excluding other states', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient({ userId, patientId, consentSignedAt: new Date() });

    await seedTranscription({ userId, patientId, status: 'ready' });
    await seedTranscription({ userId, patientId, status: 'ready' });
    await seedTranscription({ userId, patientId, status: 'reviewed' });
    await seedTranscription({ userId, patientId, status: 'pending' });

    const result = await getPendencias(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aiNotesAwaitingReviewCount).toBe(2);
    expect(result.aiNotesAwaitingReviewHref).toContain('ready');
  });

  it('carries no clinical text fields in the result', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient({ userId, patientId, consentSignedAt: null });
    const s = await seedDoneSession({ userId, patientId, startAt: eightDaysAgo() });
    void s;
    await seedTranscription({ userId, patientId, status: 'ready' });

    const result = await getPendencias(fakeSupabaseClient(userId));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The result is exactly counts + static hrefs — assert the key set so any
    // future clinical field added by mistake fails the test.
    expect(Object.keys(result).sort()).toEqual(
      [
        'aiNotesAwaitingReviewCount',
        'aiNotesAwaitingReviewHref',
        'ok',
        'overdueEvolutionsCount',
        'overdueEvolutionsHref',
        'patientsMissingConsentCount',
        'patientsMissingConsentHref',
      ].sort(),
    );
    // No value in the result is a free-text clinical string.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('evolution body');
    expect(serialized).not.toContain('Test Patient');
  });

  it("isolates tenants: B's pendências never count toward A", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient({ userId: userA, patientId: patientA, consentSignedAt: new Date() });
    await seedPatient({ userId: userB, patientId: patientB, consentSignedAt: null });

    // B accrues all three pendência types.
    await seedDoneSession({ userId: userB, patientId: patientB, startAt: eightDaysAgo() });
    await seedTranscription({ userId: userB, patientId: patientB, status: 'ready' });

    const result = await getPendencias(fakeSupabaseClient(userA));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overdueEvolutionsCount).toBe(0);
    expect(result.patientsMissingConsentCount).toBe(0);
    expect(result.aiNotesAwaitingReviewCount).toBe(0);
  });
});
