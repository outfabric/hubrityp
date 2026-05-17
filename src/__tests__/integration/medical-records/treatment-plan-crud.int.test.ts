import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getTreatmentPlanImpl,
  listTreatmentPlanVersionsImpl,
  upsertTreatmentPlanImpl,
} from '@/modules/medical-records/server/treatment-plans';
import {
  auditLog,
  treatmentPlanVersions,
  treatmentPlans,
} from '@/shared/db/schema/medical-records/tables';
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

const VALID_GOALS = [
  { id: randomUUID(), description: 'Reduce anxiety', targetDate: '2026-06-01', order: 0 },
  { id: randomUUID(), description: 'Improve sleep', targetDate: null, order: 1 },
];

const VALID_PHASES = [
  { id: randomUUID(), title: 'Phase 1', description: 'Assessment', order: 0, completed: false },
  { id: randomUUID(), title: 'Phase 2', description: 'Intervention', order: 1, completed: false },
];

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// upsertTreatmentPlanImpl
// ---------------------------------------------------------------------------

describe('upsertTreatmentPlanImpl', () => {
  it('creates a new plan + version v1 on first upsert', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId,
      goals: VALID_GOALS,
      phases: VALID_PHASES,
      resources: 'CBT workbook',
      successCriteria: 'Patient reports improvement',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.planId).toBeDefined();
    expect(result.version).toBe(1);

    // Verify plan row
    const planRows = await runAsService(async (db) => {
      return db.select().from(treatmentPlans).where(eq(treatmentPlans.id, result.planId));
    });
    expect(planRows).toHaveLength(1);
    expect(planRows[0]!.userId).toBe(userId);
    expect(planRows[0]!.patientId).toBe(patientId);
    expect(planRows[0]!.currentVersion).toBe(1);
    expect(planRows[0]!.goals).toEqual(VALID_GOALS);
    expect(planRows[0]!.phases).toEqual(VALID_PHASES);
    expect(planRows[0]!.resources).toBe('CBT workbook');
    expect(planRows[0]!.successCriteria).toBe('Patient reports improvement');

    // Verify version row (v1 snapshot of creation state)
    const versionRows = await runAsService(async (db) => {
      return db
        .select()
        .from(treatmentPlanVersions)
        .where(eq(treatmentPlanVersions.planId, result.planId));
    });
    expect(versionRows).toHaveLength(1);
    expect(versionRows[0]!.versionNumber).toBe(1);
    expect(versionRows[0]!.modifiedBy).toBe(userId);
    expect(versionRows[0]!.content).toEqual({
      goals: VALID_GOALS,
      phases: VALID_PHASES,
      resources: 'CBT workbook',
      successCriteria: 'Patient reports improvement',
    });
  });

  it('second upsert increments current_version, prior content preserved in v1', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // First upsert — creates v1
    const first = await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId,
      goals: VALID_GOALS,
      phases: VALID_PHASES,
      resources: 'CBT workbook',
      successCriteria: 'Initial criteria',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.version).toBe(1);

    // Second upsert — creates v2 snapshot with new content
    const updatedGoals = [
      { id: randomUUID(), description: 'Updated goal', targetDate: '2026-07-01', order: 0 },
    ];
    const second = await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId,
      goals: updatedGoals,
      phases: VALID_PHASES,
      resources: 'Updated resources',
      successCriteria: 'Updated criteria',
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.planId).toBe(first.planId);
    expect(second.version).toBe(2);

    // Verify plan row has updated content and version
    const planRows = await runAsService(async (db) => {
      return db.select().from(treatmentPlans).where(eq(treatmentPlans.id, first.planId));
    });
    expect(planRows[0]!.currentVersion).toBe(2);
    expect(planRows[0]!.goals).toEqual(updatedGoals);
    expect(planRows[0]!.resources).toBe('Updated resources');
    expect(planRows[0]!.successCriteria).toBe('Updated criteria');

    // Verify version history: v1 = initial content, v2 = new content
    const versionRows = await runAsService(async (db) => {
      return db
        .select()
        .from(treatmentPlanVersions)
        .where(eq(treatmentPlanVersions.planId, first.planId));
    });
    expect(versionRows).toHaveLength(2);

    const v1 = versionRows.find((v) => v.versionNumber === 1);
    const v2 = versionRows.find((v) => v.versionNumber === 2);
    expect(v1).toBeDefined();
    expect(v2).toBeDefined();

    // v1 preserves the prior (original) content
    expect(v1!.content).toEqual({
      goals: VALID_GOALS,
      phases: VALID_PHASES,
      resources: 'CBT workbook',
      successCriteria: 'Initial criteria',
    });

    // v2 captures the new content
    expect(v2!.content).toEqual({
      goals: updatedGoals,
      phases: VALID_PHASES,
      resources: 'Updated resources',
      successCriteria: 'Updated criteria',
    });
  });

  it('returns UNAUTHORIZED when not authenticated', async () => {
    const result = await upsertTreatmentPlanImpl(fakeSupabaseClient(null), {
      patientId: randomUUID(),
      goals: VALID_GOALS,
      phases: VALID_PHASES,
      resources: null,
      successCriteria: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('returns NOT_FOUND when patient does not belong to user', async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedAuthUser(otherUserId);
    await seedPatient(otherUserId, patientId);

    const result = await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
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

  it('returns VALIDATION_ERROR for invalid input', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId: 'not-a-uuid',
      goals: 'invalid',
      phases: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('writes audit_log entries on create and update', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Create
    const createResult = await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId,
      goals: VALID_GOALS,
      phases: VALID_PHASES,
      resources: null,
      successCriteria: null,
    });
    expect(createResult.ok).toBe(true);

    // Update
    const updateResult = await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId,
      goals: [{ id: randomUUID(), description: 'New goal', targetDate: null, order: 0 }],
      phases: [],
      resources: 'Updated',
      successCriteria: 'Updated',
    });
    expect(updateResult.ok).toBe(true);

    // Verify audit entries: first upsert = create, second upsert = update
    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });

    const createAudits = auditRows.filter(
      (r) => r.action === 'treatment-plan.create' && r.resourceType === 'treatment_plan',
    );
    const updateAudits = auditRows.filter(
      (r) => r.action === 'treatment-plan.update' && r.resourceType === 'treatment_plan',
    );
    expect(createAudits).toHaveLength(1);
    expect(updateAudits).toHaveLength(1);
    expect(createAudits[0]!.metadata).toEqual({ patient_id: patientId });
    expect(updateAudits[0]!.metadata).toEqual({ patient_id: patientId });
  });
});

// ---------------------------------------------------------------------------
// getTreatmentPlanImpl
// ---------------------------------------------------------------------------

describe('getTreatmentPlanImpl', () => {
  it('returns the current plan when it exists', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId,
      goals: VALID_GOALS,
      phases: VALID_PHASES,
      resources: 'Resource text',
      successCriteria: 'Criteria text',
    });

    const result = await getTreatmentPlanImpl(fakeSupabaseClient(userId), { patientId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).not.toBeNull();
    expect(result.plan!.patientId).toBe(patientId);
    expect(result.plan!.userId).toBe(userId);
    expect(result.plan!.goals).toEqual(VALID_GOALS);
    expect(result.plan!.phases).toEqual(VALID_PHASES);
    expect(result.plan!.resources).toBe('Resource text');
    expect(result.plan!.successCriteria).toBe('Criteria text');
  });

  it('returns null when no plan exists for the patient', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await getTreatmentPlanImpl(fakeSupabaseClient(userId), { patientId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toBeNull();
  });

  it('returns NOT_FOUND when patient does not belong to user', async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedAuthUser(otherUserId);
    await seedPatient(otherUserId, patientId);

    const result = await getTreatmentPlanImpl(fakeSupabaseClient(userId), { patientId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED when not authenticated', async () => {
    const result = await getTreatmentPlanImpl(fakeSupabaseClient(null), {
      patientId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('writes audit_log only when plan exists', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Read with no plan — should NOT write audit
    await getTreatmentPlanImpl(fakeSupabaseClient(userId), { patientId });

    const auditBefore = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });
    const readAuditsBefore = auditBefore.filter((r) => r.action === 'treatment-plan.read');
    expect(readAuditsBefore).toHaveLength(0);

    // Create a plan, then read — should write audit
    await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId,
      goals: VALID_GOALS,
      phases: VALID_PHASES,
      resources: null,
      successCriteria: null,
    });

    await getTreatmentPlanImpl(fakeSupabaseClient(userId), { patientId });

    const auditAfter = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });
    const readAuditsAfter = auditAfter.filter((r) => r.action === 'treatment-plan.read');
    expect(readAuditsAfter).toHaveLength(1);
    expect(readAuditsAfter[0]!.resourceType).toBe('treatment_plan');
    expect(readAuditsAfter[0]!.metadata).toEqual({ patient_id: patientId });
  });
});

// ---------------------------------------------------------------------------
// listTreatmentPlanVersionsImpl
// ---------------------------------------------------------------------------

describe('listTreatmentPlanVersionsImpl', () => {
  it('returns chronological version history', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Create initial plan (v1)
    const first = await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId,
      goals: VALID_GOALS,
      phases: VALID_PHASES,
      resources: 'v1 resources',
      successCriteria: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Second upsert (v2)
    await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId,
      goals: [{ id: randomUUID(), description: 'Goal v2', targetDate: null, order: 0 }],
      phases: [],
      resources: 'v2 resources',
      successCriteria: 'v2 criteria',
    });

    // Third upsert (v3)
    await upsertTreatmentPlanImpl(fakeSupabaseClient(userId), {
      patientId,
      goals: [{ id: randomUUID(), description: 'Goal v3', targetDate: null, order: 0 }],
      phases: [],
      resources: 'v3 resources',
      successCriteria: 'v3 criteria',
    });

    const result = await listTreatmentPlanVersionsImpl(fakeSupabaseClient(userId), {
      planId: first.planId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.versions).toHaveLength(3);

    // Verify chronological ordering (ASC by version_number)
    expect(result.versions[0]!.versionNumber).toBe(1);
    expect(result.versions[1]!.versionNumber).toBe(2);
    expect(result.versions[2]!.versionNumber).toBe(3);

    // v1 has initial content
    expect((result.versions[0]!.content as { resources: string }).resources).toBe('v1 resources');
    // v3 has latest content
    expect((result.versions[2]!.content as { resources: string }).resources).toBe('v3 resources');
  });

  it('returns NOT_FOUND when plan does not belong to user', async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedAuthUser(otherUserId);
    await seedPatient(otherUserId, patientId);

    // Create plan as otherUser
    const created = await upsertTreatmentPlanImpl(fakeSupabaseClient(otherUserId), {
      patientId,
      goals: VALID_GOALS,
      phases: VALID_PHASES,
      resources: null,
      successCriteria: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Try to list as userId (not owner)
    const listResult = await listTreatmentPlanVersionsImpl(fakeSupabaseClient(userId), {
      planId: created.planId,
    });

    expect(listResult.ok).toBe(false);
    if (listResult.ok) return;
    expect(listResult.code).toBe('NOT_FOUND');
  });

  it('returns NOT_FOUND for non-existent plan ID', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await listTreatmentPlanVersionsImpl(fakeSupabaseClient(userId), {
      planId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED when not authenticated', async () => {
    const result = await listTreatmentPlanVersionsImpl(fakeSupabaseClient(null), {
      planId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });
});
