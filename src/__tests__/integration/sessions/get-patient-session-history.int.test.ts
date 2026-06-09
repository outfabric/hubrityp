import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { getPatientSessionHistoryImpl } from '@/modules/sessions/server/get-patient-session-history';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { auditLog } from '@/shared/db/schema/medical-records/tables';
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
      // A real name is seeded so the test can prove it NEVER reaches the audit row.
      fullName: 'Maria Confidencial',
      patientType: 'individual',
    });
  });
}

interface SessionSeed {
  userId: string;
  patientId: string;
  status: 'scheduled' | 'confirmed' | 'done' | 'cancelled' | 'no_show';
  startAt: Date;
}

async function seedSession(seed: SessionSeed): Promise<string> {
  const id = randomUUID();
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id,
      userId: seed.userId,
      patientId: seed.patientId,
      status: seed.status,
      startAt: seed.startAt,
      endAt: new Date(seed.startAt.getTime() + 50 * 60 * 1000),
      durationMinutes: 50,
      isBlocking: false,
    });
  });
  return id;
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
  } as Parameters<typeof getPatientSessionHistoryImpl>[0];
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Counts `patient.session_history.read` audit rows for a given resource id. */
async function countReadAuditRows(patientId: string): Promise<number> {
  let count = 0;
  await runAsService(async (db) => {
    const rows = await db.select().from(auditLog).where(eq(auditLog.resourceId, patientId));
    count = rows.filter((r) => r.action === 'patient.session_history.read').length;
  });
  return count;
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
// getPatientSessionHistoryImpl — negative-auth + audit coverage (4.4)
// =====================================================================

describe('getPatientSessionHistoryImpl', () => {
  it('rejects an unauthenticated caller with UNAUTHORIZED before any DB work', async () => {
    const result = await getPatientSessionHistoryImpl(fakeSupabaseClient(null), {
      patientId: randomUUID() as never,
    });
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('writes no audit row for an unauthenticated caller', async () => {
    const patientId = randomUUID();
    await getPatientSessionHistoryImpl(fakeSupabaseClient(null), {
      patientId: patientId as never,
    });
    expect(await countReadAuditRows(patientId)).toBe(0);
  });

  it('owner-scopes: psychologist A reading B patient id sees none of B rows', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userB, patientB);

    // B has real history; A must never see it through a tampered patientId.
    await seedSession({ userId: userB, patientId: patientB, status: 'done', startAt: daysAgo(5) });
    await seedSession({ userId: userB, patientId: patientB, status: 'done', startAt: daysAgo(4) });

    const crossTenant = await getPatientSessionHistoryImpl(fakeSupabaseClient(userA), {
      patientId: patientB as never,
    });

    expect(crossTenant.ok).toBe(true);
    if (!crossTenant.ok) return;
    expect(crossTenant.sessions).toHaveLength(0);
    expect(crossTenant.summary?.doneTotal).toBe(0);
    expect(crossTenant.futureSession).toBeUndefined();
  });

  it('writes exactly one audit row on an initial open (cursor absent)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(3) });

    const result = await getPatientSessionHistoryImpl(fakeSupabaseClient(userId), {
      patientId: patientId as never,
    });

    expect(result.ok).toBe(true);
    expect(await countReadAuditRows(patientId)).toBe(1);
  });

  it('writes zero audit rows on a load-more call (cursor present)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(3) });

    // A syntactically valid opaque cursor. Even if it points past the data, the
    // load-more branch must run the list query only and write NO audit entry.
    const cursor = Buffer.from(
      JSON.stringify({ startAt: daysAgo(2).toISOString(), id: randomUUID() }),
      'utf8',
    ).toString('base64url');

    const result = await getPatientSessionHistoryImpl(fakeSupabaseClient(userId), {
      patientId: patientId as never,
      cursor,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Load-more payload carries the page only — no summary, no future session.
    expect(result.summary).toBeUndefined();
    expect(result.futureSession).toBeUndefined();
    expect(await countReadAuditRows(patientId)).toBe(0);
  });

  it('audit row carries only identifiers — never the patient name or clinical text', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession({ userId, patientId, status: 'done', startAt: daysAgo(3) });

    await getPatientSessionHistoryImpl(fakeSupabaseClient(userId), {
      patientId: patientId as never,
    });

    let row: typeof auditLog.$inferSelect | undefined;
    await runAsService(async (db) => {
      const rows = await db.select().from(auditLog).where(eq(auditLog.resourceId, patientId));
      row = rows.find((r) => r.action === 'patient.session_history.read');
    });

    expect(row).toBeDefined();
    if (!row) return;
    expect(row.userId).toBe(userId);
    expect(row.action).toBe('patient.session_history.read');
    expect(row.resourceType).toBe('patient');
    expect(row.resourceId).toBe(patientId);

    // No PII leak: the seeded patient name must not appear anywhere in the row.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('Maria Confidencial');
  });
});
