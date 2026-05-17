import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { treatmentPlans, treatmentPlanVersions } from '@/shared/db/schema/medical-records/tables';
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

afterEach(async () => {
  await cleanTestData();
});

// =====================================================================
// Table existence
// =====================================================================

describe('treatment-plans — table existence', () => {
  it('treatment_plans table exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'treatment_plans'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('treatment_plan_versions table exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'treatment_plan_versions'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});

// =====================================================================
// RLS enabled
// =====================================================================

describe('treatment-plans — RLS enabled', () => {
  it('RLS is enabled on treatment_plans', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'treatment_plans'`,
      );
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });

  it('RLS is enabled on treatment_plan_versions', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'treatment_plan_versions'`,
      );
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });
});

// =====================================================================
// RLS policies — treatment_plans (SELECT/INSERT/UPDATE only, no DELETE)
// =====================================================================

describe('treatment-plans — treatment_plans RLS policies', () => {
  it('has exactly 3 policies: SELECT, INSERT, UPDATE (no DELETE)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'treatment_plans'::regclass
             ORDER BY polname`,
      );
    });

    const policies = result.map((r) => ({
      name: r.polname as string,
      cmd: r.polcmd as string,
    }));

    // r=SELECT, a=INSERT, w=UPDATE, d=DELETE
    expect(policies).toHaveLength(3);
    expect(policies.find((p) => p.cmd === 'r')).toBeDefined(); // SELECT
    expect(policies.find((p) => p.cmd === 'a')).toBeDefined(); // INSERT
    expect(policies.find((p) => p.cmd === 'w')).toBeDefined(); // UPDATE
    expect(policies.find((p) => p.cmd === 'd')).toBeUndefined(); // NO DELETE
  });

  it('owner can read their own treatment plans', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(treatmentPlans).values({
        id: randomUUID(),
        userId,
        patientId,
        goals: [{ text: 'Goal 1' }],
        phases: [],
      });
    });

    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(treatmentPlans);
    });

    expect(rows).toHaveLength(1);
  });

  it('non-owner cannot read another user treatment plans', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(treatmentPlans).values({
        id: randomUUID(),
        userId: userA,
        patientId,
        goals: [],
        phases: [],
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(treatmentPlans);
    });

    expect(rows).toHaveLength(0);
  });
});

// =====================================================================
// RLS policies — treatment_plan_versions (SELECT/INSERT only — immutable)
// =====================================================================

describe('treatment-plans — treatment_plan_versions RLS policies', () => {
  it('has exactly 2 policies: SELECT, INSERT (no UPDATE, no DELETE — immutable per Lei 13.787/2018)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'treatment_plan_versions'::regclass
             ORDER BY polname`,
      );
    });

    const policies = result.map((r) => ({
      name: r.polname as string,
      cmd: r.polcmd as string,
    }));

    // r=SELECT, a=INSERT, w=UPDATE, d=DELETE
    expect(policies).toHaveLength(2);
    expect(policies.find((p) => p.cmd === 'r')).toBeDefined(); // SELECT
    expect(policies.find((p) => p.cmd === 'a')).toBeDefined(); // INSERT
    expect(policies.find((p) => p.cmd === 'w')).toBeUndefined(); // NO UPDATE (immutable)
    expect(policies.find((p) => p.cmd === 'd')).toBeUndefined(); // NO DELETE
  });

  it('owner can read versions of their treatment plan', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const planId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(treatmentPlans).values({
        id: planId,
        userId,
        patientId,
        goals: [{ text: 'Goal 1' }],
        phases: [],
      });
      await db.insert(treatmentPlanVersions).values({
        id: randomUUID(),
        planId,
        versionNumber: 1,
        content: {
          goals: [{ text: 'Goal 1' }],
          phases: [],
          resources: null,
          successCriteria: null,
        },
        modifiedBy: userId,
      });
    });

    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(treatmentPlanVersions);
    });

    expect(rows).toHaveLength(1);
  });

  it('non-owner cannot read versions of another user treatment plan', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const planId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(treatmentPlans).values({
        id: planId,
        userId: userA,
        patientId,
        goals: [],
        phases: [],
      });
      await db.insert(treatmentPlanVersions).values({
        id: randomUUID(),
        planId,
        versionNumber: 1,
        content: { goals: [], phases: [], resources: null, successCriteria: null },
        modifiedBy: userA,
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(treatmentPlanVersions);
    });

    expect(rows).toHaveLength(0);
  });
});

// =====================================================================
// No DELETE policy on either table
// =====================================================================

describe('treatment-plans — no DELETE policy (Lei 13.787/2018)', () => {
  it('treatment_plans has no DELETE policy', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname FROM pg_policy
             WHERE polrelid = 'treatment_plans'::regclass AND polcmd = 'd'`,
      );
    });

    expect(result).toHaveLength(0);
  });

  it('treatment_plan_versions has no DELETE policy', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname FROM pg_policy
             WHERE polrelid = 'treatment_plan_versions'::regclass AND polcmd = 'd'`,
      );
    });

    expect(result).toHaveLength(0);
  });
});

// =====================================================================
// UNIQUE constraints
// =====================================================================

describe('treatment-plans — UNIQUE constraints', () => {
  it('treatment_plans.patient_id has UNIQUE constraint (one plan per patient)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(treatmentPlans).values({
        id: randomUUID(),
        userId,
        patientId,
        goals: [],
        phases: [],
      });
    });

    // Inserting a second plan with the same patient_id should fail
    await expect(
      runAsService(async (db) => {
        await db.insert(treatmentPlans).values({
          id: randomUUID(),
          userId,
          patientId,
          goals: [],
          phases: [],
        });
      }),
    ).rejects.toThrow();
  });

  it('treatment_plan_versions (plan_id, version_number) has UNIQUE constraint', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const planId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(treatmentPlans).values({
        id: planId,
        userId,
        patientId,
        goals: [],
        phases: [],
      });
      await db.insert(treatmentPlanVersions).values({
        id: randomUUID(),
        planId,
        versionNumber: 1,
        content: { goals: [], phases: [] },
        modifiedBy: userId,
      });
    });

    // Inserting a second version with the same (plan_id, version_number) should fail
    await expect(
      runAsService(async (db) => {
        await db.insert(treatmentPlanVersions).values({
          id: randomUUID(),
          planId,
          versionNumber: 1,
          content: { goals: [], phases: [] },
          modifiedBy: userId,
        });
      }),
    ).rejects.toThrow();
  });
});
