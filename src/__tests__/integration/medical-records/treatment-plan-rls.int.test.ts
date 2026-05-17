import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getTreatmentPlanImpl,
  listTreatmentPlanVersionsImpl,
  upsertTreatmentPlanImpl,
} from '@/modules/medical-records/server/treatment-plans';
import { treatmentPlanVersions, treatmentPlans } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

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
  } as Parameters<typeof upsertTreatmentPlanImpl>[0];
}

const VALID_GOALS = [{ id: randomUUID(), description: 'Goal A', targetDate: null, order: 0 }];

const VALID_PHASES = [
  { id: randomUUID(), title: 'Phase A', description: 'Desc', order: 0, completed: false },
];

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// RLS negative: cross-user access blocked
// ---------------------------------------------------------------------------

describe('treatment-plan RLS — cross-user isolation', () => {
  it('psychologist B cannot read psychologist A plan via RLS', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // Create plan as userA via service-role (bypasses RLS to seed data)
    await runAsService(async (db) => {
      await db.insert(treatmentPlans).values({
        id: randomUUID(),
        userId: userA,
        patientId,
        goals: VALID_GOALS,
        phases: VALID_PHASES,
        currentVersion: 1,
      });
    });

    // userB tries to SELECT — RLS should block
    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(treatmentPlans);
    });

    expect(rows).toHaveLength(0);
  });

  it('psychologist B cannot upsert plan for psychologist A patient (action-level check)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // userB tries to upsert for userA's patient — should get NOT_FOUND
    const result = await upsertTreatmentPlanImpl(fakeSupabaseClient(userB), {
      patientId,
      goals: VALID_GOALS,
      phases: VALID_PHASES,
      resources: null,
      successCriteria: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('psychologist B cannot getTreatmentPlan for psychologist A patient', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // Create plan as userA
    await upsertTreatmentPlanImpl(fakeSupabaseClient(userA), {
      patientId,
      goals: VALID_GOALS,
      phases: VALID_PHASES,
      resources: null,
      successCriteria: null,
    });

    // userB tries to get — should get NOT_FOUND (patient ownership fails)
    const result = await getTreatmentPlanImpl(fakeSupabaseClient(userB), { patientId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('no user can DELETE from treatment_plans (no DELETE policy)', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);

    // Seed plan via service-role
    const planId = randomUUID();
    await runAsService(async (db) => {
      await db.insert(treatmentPlans).values({
        id: planId,
        userId: userA,
        patientId,
        goals: VALID_GOALS,
        phases: VALID_PHASES,
        currentVersion: 1,
      });
    });

    // userA (owner) tries to DELETE — RLS without DELETE policy silently filters
    // to zero rows (DELETE affects nothing). The row must remain.
    await runAsUser(userA, async (db) => {
      await db.execute(dsql`DELETE FROM treatment_plans WHERE id = ${planId}`);
    });

    // Verify row still exists (RLS blocked the delete)
    const rows = await runAsService(async (db) => {
      return db.select().from(treatmentPlans);
    });
    expect(rows).toHaveLength(1);
  });

  it('no user can DELETE from treatment_plan_versions (no DELETE policy)', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    const planId = randomUUID();
    const versionId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);

    // Seed plan + version via service-role
    await runAsService(async (db) => {
      await db.insert(treatmentPlans).values({
        id: planId,
        userId: userA,
        patientId,
        goals: VALID_GOALS,
        phases: VALID_PHASES,
        currentVersion: 1,
      });
      await db.insert(treatmentPlanVersions).values({
        id: versionId,
        planId,
        versionNumber: 1,
        content: {
          goals: VALID_GOALS,
          phases: VALID_PHASES,
          resources: null,
          successCriteria: null,
        },
        modifiedBy: userA,
      });
    });

    // userA (owner) tries to DELETE version — RLS without DELETE policy silently
    // filters to zero rows. The row must remain.
    await runAsUser(userA, async (db) => {
      await db.execute(dsql`DELETE FROM treatment_plan_versions WHERE id = ${versionId}`);
    });

    // Verify row still exists (RLS blocked the delete)
    const rows = await runAsService(async (db) => {
      return db.select().from(treatmentPlanVersions);
    });
    expect(rows).toHaveLength(1);
  });

  it('version JOIN-scoped RLS blocks cross-user access to versions', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const planId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // Seed plan + versions for userA via service-role
    await runAsService(async (db) => {
      await db.insert(treatmentPlans).values({
        id: planId,
        userId: userA,
        patientId,
        goals: VALID_GOALS,
        phases: VALID_PHASES,
        currentVersion: 2,
      });
      await db.insert(treatmentPlanVersions).values([
        {
          planId,
          versionNumber: 1,
          content: {
            goals: VALID_GOALS,
            phases: VALID_PHASES,
            resources: null,
            successCriteria: null,
          },
          modifiedBy: userA,
        },
        {
          planId,
          versionNumber: 2,
          content: { goals: [], phases: [], resources: 'v2', successCriteria: null },
          modifiedBy: userA,
        },
      ]);
    });

    // userB tries to read versions via RLS — JOIN-scoped policy should block
    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(treatmentPlanVersions);
    });

    expect(rows).toHaveLength(0);

    // userA can read their own versions
    const ownRows = await runAsUser(userA, async (db) => {
      return db.select().from(treatmentPlanVersions);
    });

    expect(ownRows).toHaveLength(2);
  });

  it('listTreatmentPlanVersions blocks cross-user access at action level', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // Create plan as userA
    const created = await upsertTreatmentPlanImpl(fakeSupabaseClient(userA), {
      patientId,
      goals: VALID_GOALS,
      phases: VALID_PHASES,
      resources: null,
      successCriteria: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // userB tries to list versions — plan ownership check rejects
    const result = await listTreatmentPlanVersionsImpl(fakeSupabaseClient(userB), {
      planId: created.planId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });
});
