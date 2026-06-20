import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { upsertTreatmentPlanImpl } from '@/modules/medical-records/server/treatment-plans';
import { treatmentPlanVersions, treatmentPlans } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Manual "Salvar" button on the Plano Terapêutico editor — integration coverage.
//
// The manual save button reuses `upsertTreatmentPlanImpl` (the same action
// auto-save calls). These tests assert that a manual save persists the plan and
// snapshots a new version row, and that an invalid goal (empty description) is
// rejected at the Zod boundary with NO row written.
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

const VALID_GOALS = [
  { id: randomUUID(), description: 'Reduzir ansiedade', targetDate: '2026-09-01', order: 0 },
];

const VALID_PHASES = [
  { id: randomUUID(), title: 'Fase 1', description: 'Avaliação', order: 0, completed: false },
];

afterEach(async () => {
  await cleanTestData();
});

describe('manual save — Plano Terapêutico', () => {
  it('persists the plan and snapshots a new treatment_plan_versions row', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // First manual save — creates plan + version v1.
    const first = await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId,
      goals: VALID_GOALS,
      phases: VALID_PHASES,
      resources: 'Caderno de TCC',
      successCriteria: 'Paciente relata melhora',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.version).toBe(1);

    // Second manual save (edited content) — snapshots a NEW version row.
    const editedGoals = [
      { id: randomUUID(), description: 'Melhorar o sono', targetDate: null, order: 0 },
    ];
    const second = await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId,
      goals: editedGoals,
      phases: VALID_PHASES,
      resources: 'Recursos atualizados',
      successCriteria: 'Critério atualizado',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.planId).toBe(first.planId);
    expect(second.version).toBe(2);

    // Owner sees the persisted plan through their own RLS context.
    const ownerPlan = await runAsUser(userId, async (db) => {
      return db.select().from(treatmentPlans).where(eq(treatmentPlans.id, first.planId));
    });
    expect(ownerPlan).toHaveLength(1);
    expect(ownerPlan[0]!.currentVersion).toBe(2);
    expect(ownerPlan[0]!.goals).toEqual(editedGoals);

    // A new version row was snapshotted on the manual save (v1 + v2).
    const versionRows = await runAsService(async (db) => {
      return db
        .select()
        .from(treatmentPlanVersions)
        .where(eq(treatmentPlanVersions.planId, first.planId));
    });
    expect(versionRows).toHaveLength(2);
    const v2 = versionRows.find((v) => v.versionNumber === 2);
    expect(v2).toBeDefined();
    expect((v2!.content as { resources: string }).resources).toBe('Recursos atualizados');
  });

  it('rejects an invalid goal (empty description) and writes no plan or version row', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Manual save with an empty-description goal — must fail at the Zod boundary.
    const result = await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId,
      goals: [{ id: randomUUID(), description: '', targetDate: null, order: 0 }],
      phases: VALID_PHASES,
      resources: null,
      successCriteria: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');

    // Nothing was persisted — neither a plan nor a version row.
    const plans = await runAsService(async (db) => {
      return db.select().from(treatmentPlans).where(eq(treatmentPlans.patientId, patientId));
    });
    expect(plans).toHaveLength(0);

    const versions = await runAsService(async (db) => {
      return db.select().from(treatmentPlanVersions);
    });
    expect(versions).toHaveLength(0);
  });
});
