import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanTestData } from '@/__tests__/integration/setup/clean-test-data';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { createHypothesisImpl } from '@/modules/medical-records/server/hypotheses';
import {
  listHypothesesByPatientImpl,
  updateHypothesisImpl,
  updateHypothesisStatusImpl,
} from '@/modules/medical-records/server/hypotheses';
import { auditLog, diagnosticHypotheses } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

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

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
    });
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof createHypothesisImpl>[0];
}

afterEach(async () => {
  await cleanTestData();
});

// ===========================================================================
// createHypothesisImpl
// ===========================================================================

describe('createHypothesisImpl', () => {
  it('creates a hypothesis with description and writes audit_log', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await createHypothesisImpl(fakeSupabaseClient(userId), {
      patientId,
      description: 'Tracos de ansiedade social',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).toBeDefined();

    // Verify persisted row
    const rows = await runAsService(async (db) => {
      return db.select().from(diagnosticHypotheses).where(eq(diagnosticHypotheses.id, result.id));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.patientId).toBe(patientId);
    expect(rows[0]!.description).toBe('Tracos de ansiedade social');
    expect(rows[0]!.status).toBe('investigating');

    // Verify audit_log entry
    const logs = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, result.id));
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('hypothesis.create');
    expect(logs[0]!.resourceType).toBe('diagnostic_hypothesis');
    expect(logs[0]!.userId).toBe(userId);
  });

  it('creates a hypothesis with CID-10 code and writes audit_log', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await createHypothesisImpl(fakeSupabaseClient(userId), {
      patientId,
      cid10Code: 'F32.0',
      cid10Description: 'Episodio depressivo leve',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await runAsService(async (db) => {
      return db.select().from(diagnosticHypotheses).where(eq(diagnosticHypotheses.id, result.id));
    });

    expect(rows[0]!.cid10Code).toBe('F32.0');
    expect(rows[0]!.cid10Description).toBe('Episodio depressivo leve');
    expect(rows[0]!.description).toBeNull();
  });

  it('creates a hypothesis with both description and CID-10', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await createHypothesisImpl(fakeSupabaseClient(userId), {
      patientId,
      description: 'Correlacao com estressores laborais',
      cid10Code: 'F41.1',
      cid10Description: 'Ansiedade generalizada',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await runAsService(async (db) => {
      return db.select().from(diagnosticHypotheses).where(eq(diagnosticHypotheses.id, result.id));
    });

    expect(rows[0]!.description).toBe('Correlacao com estressores laborais');
    expect(rows[0]!.cid10Code).toBe('F41.1');
  });

  it('rejects hypothesis with neither description nor CID-10 (validation error)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await createHypothesisImpl(fakeSupabaseClient(userId), {
      patientId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('sets user_id from session, never from input', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await createHypothesisImpl(fakeSupabaseClient(userId), {
      patientId,
      description: 'Test',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await runAsService(async (db) => {
      return db.select().from(diagnosticHypotheses).where(eq(diagnosticHypotheses.id, result.id));
    });

    expect(rows[0]!.userId).toBe(userId);
  });

  it('returns UNAUTHORIZED when not authenticated', async () => {
    const result = await createHypothesisImpl(fakeSupabaseClient(null), {
      patientId: randomUUID(),
      description: 'Test',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('returns NOT_FOUND when patient does not belong to user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // userB tries to create hypothesis for userA's patient
    const result = await createHypothesisImpl(fakeSupabaseClient(userB), {
      patientId,
      description: 'Cross-tenant attempt',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });
});

// ===========================================================================
// updateHypothesisImpl
// ===========================================================================

describe('updateHypothesisImpl', () => {
  it('updates hypothesis description and writes audit_log', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const hypothesisId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Seed hypothesis
    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values({
        id: hypothesisId,
        userId,
        patientId,
        description: 'Original description',
        status: 'investigating',
      });
    });

    const result = await updateHypothesisImpl(fakeSupabaseClient(userId), {
      hypothesisId,
      description: 'Updated description',
    });

    expect(result.ok).toBe(true);

    // Verify updated row
    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(diagnosticHypotheses)
        .where(eq(diagnosticHypotheses.id, hypothesisId));
    });

    expect(rows[0]!.description).toBe('Updated description');

    // Verify audit_log entry
    const logs = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, hypothesisId));
    });

    const updateLog = logs.find((l) => l.action === 'hypothesis.update');
    expect(updateLog).toBeDefined();
    expect(updateLog!.userId).toBe(userId);
  });

  it('returns NOT_FOUND when hypothesis does not belong to user (ownership check)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const hypothesisId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values({
        id: hypothesisId,
        userId: userA,
        patientId,
        description: 'Private hypothesis',
        status: 'investigating',
      });
    });

    // userB tries to update userA's hypothesis
    const result = await updateHypothesisImpl(fakeSupabaseClient(userB), {
      hypothesisId,
      description: 'Hacked',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED when not authenticated', async () => {
    const result = await updateHypothesisImpl(fakeSupabaseClient(null), {
      hypothesisId: randomUUID(),
      description: 'Test',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });
});

// ===========================================================================
// updateHypothesisStatusImpl
// ===========================================================================

describe('updateHypothesisStatusImpl', () => {
  it('transitions status from investigating to confirmed and logs old/new status', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const hypothesisId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values({
        id: hypothesisId,
        userId,
        patientId,
        description: 'Test hypothesis',
        status: 'investigating',
      });
    });

    const result = await updateHypothesisStatusImpl(fakeSupabaseClient(userId), {
      hypothesisId,
      status: 'confirmed',
    });

    expect(result.ok).toBe(true);

    // Verify status change
    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(diagnosticHypotheses)
        .where(eq(diagnosticHypotheses.id, hypothesisId));
    });

    expect(rows[0]!.status).toBe('confirmed');

    // Verify audit_log with old/new status metadata
    const logs = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, hypothesisId));
    });

    const statusLog = logs.find((l) => l.action === 'hypothesis.status-change');
    expect(statusLog).toBeDefined();
    expect(statusLog!.metadata).toEqual({
      old_status: 'investigating',
      new_status: 'confirmed',
    });
  });

  it('transitions to discarded with notes', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const hypothesisId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values({
        id: hypothesisId,
        userId,
        patientId,
        description: 'Test hypothesis',
        status: 'investigating',
      });
    });

    const result = await updateHypothesisStatusImpl(fakeSupabaseClient(userId), {
      hypothesisId,
      status: 'discarded',
      notes: 'Hipotese descartada apos reavaliacao',
    });

    expect(result.ok).toBe(true);

    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(diagnosticHypotheses)
        .where(eq(diagnosticHypotheses.id, hypothesisId));
    });

    expect(rows[0]!.status).toBe('discarded');
    expect(rows[0]!.notes).toBe('Hipotese descartada apos reavaliacao');
  });

  it('transitions to discarded without notes (notes remains unchanged)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const hypothesisId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values({
        id: hypothesisId,
        userId,
        patientId,
        description: 'Test hypothesis',
        status: 'investigating',
        notes: 'Original notes',
      });
    });

    const result = await updateHypothesisStatusImpl(fakeSupabaseClient(userId), {
      hypothesisId,
      status: 'discarded',
    });

    expect(result.ok).toBe(true);

    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(diagnosticHypotheses)
        .where(eq(diagnosticHypotheses.id, hypothesisId));
    });

    expect(rows[0]!.status).toBe('discarded');
    // Notes remain unchanged when not provided in input
    expect(rows[0]!.notes).toBe('Original notes');
  });

  it('returns NOT_FOUND when hypothesis does not belong to user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const hypothesisId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values({
        id: hypothesisId,
        userId: userA,
        patientId,
        description: 'Private',
        status: 'investigating',
      });
    });

    const result = await updateHypothesisStatusImpl(fakeSupabaseClient(userB), {
      hypothesisId,
      status: 'confirmed',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED when not authenticated', async () => {
    const result = await updateHypothesisStatusImpl(fakeSupabaseClient(null), {
      hypothesisId: randomUUID(),
      status: 'confirmed',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });
});

// ===========================================================================
// listHypothesesByPatientImpl
// ===========================================================================

describe('listHypothesesByPatientImpl', () => {
  it('returns only hypotheses for the requesting psychologist (RLS negative test)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientIdA = randomUUID();
    const patientIdB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientIdA);
    await seedPatient(userB, patientIdB);

    // Seed hypotheses for userA
    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values({
        userId: userA,
        patientId: patientIdA,
        description: 'UserA hypothesis',
        status: 'investigating',
      });
    });

    // userB requests hypotheses for userA's patient — should return empty
    const result = await listHypothesesByPatientImpl(fakeSupabaseClient(userB), {
      patientId: patientIdA,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hypotheses).toHaveLength(0);
  });

  it('returns hypotheses for the owning psychologist', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values([
        {
          userId,
          patientId,
          description: 'Hypothesis 1',
          status: 'investigating',
        },
        {
          userId,
          patientId,
          cid10Code: 'F32.0',
          cid10Description: 'Episodio depressivo leve',
          status: 'confirmed',
        },
      ]);
    });

    const result = await listHypothesesByPatientImpl(fakeSupabaseClient(userId), {
      patientId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hypotheses).toHaveLength(2);
  });

  it('default excludes discarded hypotheses', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values([
        {
          userId,
          patientId,
          description: 'Active hypothesis',
          status: 'investigating',
        },
        {
          userId,
          patientId,
          description: 'Discarded hypothesis',
          status: 'discarded',
        },
      ]);
    });

    const result = await listHypothesesByPatientImpl(fakeSupabaseClient(userId), {
      patientId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hypotheses).toHaveLength(1);
    expect(result.hypotheses[0]!.description).toBe('Active hypothesis');
  });

  it('includes discarded hypotheses when includeDiscarded=true', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values([
        {
          userId,
          patientId,
          description: 'Active hypothesis',
          status: 'investigating',
        },
        {
          userId,
          patientId,
          description: 'Discarded hypothesis',
          status: 'discarded',
        },
      ]);
    });

    const result = await listHypothesesByPatientImpl(fakeSupabaseClient(userId), {
      patientId,
      includeDiscarded: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hypotheses).toHaveLength(2);
  });

  it('orders results by created_at DESC', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Seed with explicit timestamps to ensure ordering
    await runAsService(async (db) => {
      await db.insert(diagnosticHypotheses).values([
        {
          userId,
          patientId,
          description: 'Older hypothesis',
          status: 'investigating',
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          userId,
          patientId,
          description: 'Newer hypothesis',
          status: 'investigating',
          createdAt: new Date('2024-06-01T10:00:00Z'),
        },
      ]);
    });

    const result = await listHypothesesByPatientImpl(fakeSupabaseClient(userId), {
      patientId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hypotheses[0]!.description).toBe('Newer hypothesis');
    expect(result.hypotheses[1]!.description).toBe('Older hypothesis');
  });

  it('writes audit_log with action hypothesis.read', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await listHypothesesByPatientImpl(fakeSupabaseClient(userId), {
      patientId,
    });

    // Verify audit_log entry
    const logs = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, patientId));
    });

    const readLog = logs.find((l) => l.action === 'hypothesis.read');
    expect(readLog).toBeDefined();
    expect(readLog!.resourceType).toBe('diagnostic_hypothesis');
    expect(readLog!.userId).toBe(userId);
  });

  it('returns UNAUTHORIZED when not authenticated', async () => {
    const result = await listHypothesesByPatientImpl(fakeSupabaseClient(null), {
      patientId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });
});

// ===========================================================================
// CHECK constraint (DB-level enforcement)
// ===========================================================================

describe('diagnostic_hypotheses — CHECK constraint at DB level', () => {
  it('rejects insert with both description and cid10_code NULL', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await expect(
      runAsService(async (db) => {
        await db.insert(diagnosticHypotheses).values({
          userId,
          patientId,
          description: null,
          cid10Code: null,
          status: 'investigating',
        });
      }),
    ).rejects.toThrow();
  });
});
