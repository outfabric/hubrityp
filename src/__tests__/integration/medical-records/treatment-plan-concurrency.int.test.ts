import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { upsertTreatmentPlanImpl } from '@/modules/medical-records/server/treatment-plans';
import { treatmentPlanVersions, treatmentPlans } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

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

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Concurrency: FOR UPDATE lock serializes concurrent upserts
// ---------------------------------------------------------------------------

describe('treatment-plan concurrency — FOR UPDATE serialization', () => {
  it('concurrent upserts on the same patient are serialized, both versions preserved', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // First, create the initial plan (v1) to set up the race scenario
    const initial = await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId,
      goals: [{ id: randomUUID(), description: 'Initial goal', targetDate: null, order: 0 }],
      phases: [
        { id: randomUUID(), title: 'Initial phase', description: '', order: 0, completed: false },
      ],
      resources: 'Initial resources',
      successCriteria: 'Initial criteria',
    });
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(initial.version).toBe(1);

    // Now fire two concurrent upserts — both see current_version=1 initially,
    // but FOR UPDATE will serialize them: the second waits for the first to commit.
    const goalA = {
      id: randomUUID(),
      description: 'Concurrent goal A',
      targetDate: null,
      order: 0,
    };
    const goalB = {
      id: randomUUID(),
      description: 'Concurrent goal B',
      targetDate: null,
      order: 0,
    };

    const [resultA, resultB] = await Promise.all([
      upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
        patientId,
        goals: [goalA],
        phases: [],
        resources: 'Resources A',
        successCriteria: 'Criteria A',
      }),
      upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
        patientId,
        goals: [goalB],
        phases: [],
        resources: 'Resources B',
        successCriteria: 'Criteria B',
      }),
    ]);

    // Both should succeed (FOR UPDATE serializes rather than conflicts)
    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) return;

    // One gets version 2, the other gets version 3 (serialized execution)
    const versions = [resultA.version, resultB.version].sort();
    expect(versions).toEqual([2, 3]);

    // Verify the plan row has the final version (3)
    const planRows = await runAsService(async (db) => {
      return db.select().from(treatmentPlans).where(eq(treatmentPlans.id, initial.planId));
    });
    expect(planRows).toHaveLength(1);
    expect(planRows[0]!.currentVersion).toBe(3);

    // Verify all 3 version snapshots exist with distinct version numbers
    const versionRows = await runAsService(async (db) => {
      return db
        .select()
        .from(treatmentPlanVersions)
        .where(eq(treatmentPlanVersions.planId, initial.planId));
    });
    expect(versionRows).toHaveLength(3);

    const versionNumbers = versionRows.map((v) => v.versionNumber).sort();
    expect(versionNumbers).toEqual([1, 2, 3]);

    // No lost update — both concurrent writes are preserved as distinct versions
    const v2 = versionRows.find((v) => v.versionNumber === 2);
    const v3 = versionRows.find((v) => v.versionNumber === 3);
    expect(v2).toBeDefined();
    expect(v3).toBeDefined();
    // The two concurrent updates produced different content in v2 and v3
    expect(JSON.stringify(v2!.content)).not.toBe(JSON.stringify(v3!.content));
  });

  it('concurrent creates for the same patient — unique constraint ensures one plan', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Fire two concurrent creates (no existing plan) — one should create v1,
    // the other should see the created plan via FOR UPDATE and become v2
    const [resultA, resultB] = await Promise.all([
      upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
        patientId,
        goals: [{ id: randomUUID(), description: 'Create A', targetDate: null, order: 0 }],
        phases: [],
        resources: 'A',
        successCriteria: null,
      }),
      upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
        patientId,
        goals: [{ id: randomUUID(), description: 'Create B', targetDate: null, order: 0 }],
        phases: [],
        resources: 'B',
        successCriteria: null,
      }),
    ]);

    // Both should succeed — the unique constraint on patient_id + FOR UPDATE
    // ensures one creates and the other updates
    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) return;

    // Same plan ID (one plan per patient)
    expect(resultA.planId).toBe(resultB.planId);

    // Versions: one is v1 (creator), other is v2 (updater after lock release)
    const versions = [resultA.version, resultB.version].sort();
    expect(versions).toEqual([1, 2]);

    // Only one plan row exists
    const planRows = await runAsService(async (db) => {
      return db.select().from(treatmentPlans).where(eq(treatmentPlans.patientId, patientId));
    });
    expect(planRows).toHaveLength(1);
    expect(planRows[0]!.currentVersion).toBe(2);
  });
});
