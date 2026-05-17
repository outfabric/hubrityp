import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createScaleApplicationImpl,
  submitScaleResponsesImpl,
} from '@/modules/medical-records/server/scales';
import { auditLog, scaleApplications } from '@/shared/db/schema/medical-records/tables';
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
      fullName: 'Scale Test Patient',
      status: 'active',
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
  } as Parameters<typeof createScaleApplicationImpl>[0];
}

/** PHQ-9 responses that sum to 14 — "Moderado" classification. */
const PHQ9_RESPONSES: Record<string, number> = {
  q1: 2,
  q2: 2,
  q3: 1,
  q4: 2,
  q5: 1,
  q6: 2,
  q7: 1,
  q8: 2,
  q9: 1,
};
const PHQ9_EXPECTED_SCORE = 14;
const PHQ9_EXPECTED_LABEL = 'Moderado';

afterEach(async () => {
  await cleanTestData();
});

// =====================================================================
// createScaleApplicationImpl — in-session
// =====================================================================

describe('createScaleApplicationImpl — in-session', () => {
  it('persists row with correct user_id and no token', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await createScaleApplicationImpl(fakeSupabaseClient(userId), {
      patientId,
      scaleKey: 'phq9',
      mode: 'in-session',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).toBeDefined();
    expect(result.remoteToken).toBeUndefined();

    // Verify persisted row
    const rows = await runAsService(async (db) => {
      return db.select().from(scaleApplications).where(eq(scaleApplications.id, result.id));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.patientId).toBe(patientId);
    expect(rows[0]!.scaleKey).toBe('phq9');
    expect(rows[0]!.appliedRemotely).toBe(false);
    expect(rows[0]!.remoteToken).toBeNull();
    expect(rows[0]!.tokenExpiresAt).toBeNull();
    expect(rows[0]!.completedAt).toBeNull();
  });

  it('returns UNAUTHORIZED when no user session', async () => {
    const result = await createScaleApplicationImpl(fakeSupabaseClient(null), {
      patientId: randomUUID(),
      scaleKey: 'phq9',
      mode: 'in-session',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('returns INVALID_SCALE for unknown scale key', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await createScaleApplicationImpl(fakeSupabaseClient(userId), {
      patientId: randomUUID(),
      scaleKey: 'nonexistent',
      mode: 'in-session',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_SCALE');
  });

  it('returns PATIENT_NOT_FOUND when patient does not belong to user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // User B tries to create scale application for user A's patient
    const result = await createScaleApplicationImpl(fakeSupabaseClient(userB), {
      patientId,
      scaleKey: 'phq9',
      mode: 'in-session',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PATIENT_NOT_FOUND');
  });
});

// =====================================================================
// createScaleApplicationImpl — remote
// =====================================================================

describe('createScaleApplicationImpl — remote', () => {
  it('generates 64-char token + token_expires_at', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await createScaleApplicationImpl(fakeSupabaseClient(userId), {
      patientId,
      scaleKey: 'gad7',
      mode: 'remote',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remoteToken).toBeDefined();
    expect(result.remoteToken).toHaveLength(64);

    // Verify persisted row
    const rows = await runAsService(async (db) => {
      return db.select().from(scaleApplications).where(eq(scaleApplications.id, result.id));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.appliedRemotely).toBe(true);
    expect(rows[0]!.remoteToken).toBe(result.remoteToken);
    expect(rows[0]!.tokenExpiresAt).not.toBeNull();

    // Default expiry is 48 hours from now
    const expiresAt = rows[0]!.tokenExpiresAt!.getTime();
    const expectedMin = Date.now() + 47 * 60 * 60 * 1000; // 47h tolerance
    const expectedMax = Date.now() + 49 * 60 * 60 * 1000; // 49h tolerance
    expect(expiresAt).toBeGreaterThan(expectedMin);
    expect(expiresAt).toBeLessThan(expectedMax);
  });

  it('respects custom expiresInHours', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await createScaleApplicationImpl(fakeSupabaseClient(userId), {
      patientId,
      scaleKey: 'phq9',
      mode: 'remote',
      expiresInHours: 24,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await runAsService(async (db) => {
      return db.select().from(scaleApplications).where(eq(scaleApplications.id, result.id));
    });
    const expiresAt = rows[0]!.tokenExpiresAt!.getTime();
    const expectedMin = Date.now() + 23 * 60 * 60 * 1000;
    const expectedMax = Date.now() + 25 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThan(expectedMin);
    expect(expiresAt).toBeLessThan(expectedMax);
  });
});

// =====================================================================
// submitScaleResponsesImpl
// =====================================================================

describe('submitScaleResponsesImpl', () => {
  it('scores PHQ-9 correctly and sets completed_at', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Create application
    const createResult = await createScaleApplicationImpl(fakeSupabaseClient(userId), {
      patientId,
      scaleKey: 'phq9',
      mode: 'in-session',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Submit responses
    const submitResult = await submitScaleResponsesImpl(fakeSupabaseClient(userId), {
      applicationId: createResult.id,
      responses: PHQ9_RESPONSES,
    });

    expect(submitResult.ok).toBe(true);
    if (!submitResult.ok) return;
    expect(submitResult.totalScore).toBe(PHQ9_EXPECTED_SCORE);
    expect(submitResult.classification.label).toBe(PHQ9_EXPECTED_LABEL);

    // Verify persisted row
    const rows = await runAsService(async (db) => {
      return db.select().from(scaleApplications).where(eq(scaleApplications.id, createResult.id));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalScore).toBe(PHQ9_EXPECTED_SCORE);
    expect(rows[0]!.classification).toBe(PHQ9_EXPECTED_LABEL);
    expect(rows[0]!.completedAt).not.toBeNull();
    expect(rows[0]!.responses).toEqual(PHQ9_RESPONSES);
  });

  it('rejects already-completed application', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Create and submit once
    const createResult = await createScaleApplicationImpl(fakeSupabaseClient(userId), {
      patientId,
      scaleKey: 'phq9',
      mode: 'in-session',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const firstSubmit = await submitScaleResponsesImpl(fakeSupabaseClient(userId), {
      applicationId: createResult.id,
      responses: PHQ9_RESPONSES,
    });
    expect(firstSubmit.ok).toBe(true);

    // Try to submit again — should be rejected
    const secondSubmit = await submitScaleResponsesImpl(fakeSupabaseClient(userId), {
      applicationId: createResult.id,
      responses: PHQ9_RESPONSES,
    });
    expect(secondSubmit.ok).toBe(false);
    if (secondSubmit.ok) return;
    expect(secondSubmit.code).toBe('ALREADY_COMPLETED');
  });

  it('returns NOT_FOUND for non-existent application', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await submitScaleResponsesImpl(fakeSupabaseClient(userId), {
      applicationId: randomUUID(),
      responses: { q1: 1 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED when no user session', async () => {
    const result = await submitScaleResponsesImpl(fakeSupabaseClient(null), {
      applicationId: randomUUID(),
      responses: { q1: 1 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });
});

// =====================================================================
// RLS negative: psychologist B cannot read/submit for psychologist A
// =====================================================================

describe('RLS negative — cross-tenant isolation', () => {
  it('psychologist B cannot read psychologist A scale applications via RLS', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // User A creates a scale application
    const createResult = await createScaleApplicationImpl(fakeSupabaseClient(userA), {
      patientId,
      scaleKey: 'phq9',
      mode: 'in-session',
    });
    expect(createResult.ok).toBe(true);

    // User B queries via RLS — should see nothing
    const visibleToB = await runAsUser(userB, async (db) => {
      return db.select().from(scaleApplications);
    });
    expect(visibleToB).toHaveLength(0);

    // User A queries via RLS — should see their own
    const visibleToA = await runAsUser(userA, async (db) => {
      return db.select().from(scaleApplications);
    });
    expect(visibleToA).toHaveLength(1);
  });

  it('psychologist B cannot submit for psychologist A scale application', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // User A creates a scale application
    const createResult = await createScaleApplicationImpl(fakeSupabaseClient(userA), {
      patientId,
      scaleKey: 'phq9',
      mode: 'in-session',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // User B tries to submit — should get NOT_FOUND (ownership check)
    const submitResult = await submitScaleResponsesImpl(fakeSupabaseClient(userB), {
      applicationId: createResult.id,
      responses: PHQ9_RESPONSES,
    });
    expect(submitResult.ok).toBe(false);
    if (submitResult.ok) return;
    expect(submitResult.code).toBe('NOT_FOUND');

    // Verify the application remains uncompleted
    const rows = await runAsService(async (db) => {
      return db.select().from(scaleApplications).where(eq(scaleApplications.id, createResult.id));
    });
    expect(rows[0]!.completedAt).toBeNull();
  });
});

// =====================================================================
// Audit log entries for create + submit
// =====================================================================

describe('audit_log entries', () => {
  it('writes audit_log row for scale.create', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const result = await createScaleApplicationImpl(fakeSupabaseClient(userId), {
      patientId,
      scaleKey: 'phq9',
      mode: 'in-session',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });
    const createEntry = auditRows.find((r) => r.action === 'scale.create');
    expect(createEntry).toBeDefined();
    expect(createEntry!.resourceType).toBe('scale_application');
    expect(createEntry!.resourceId).toBe(result.id);
  });

  it('writes audit_log row for scale.submit', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Create application
    const createResult = await createScaleApplicationImpl(fakeSupabaseClient(userId), {
      patientId,
      scaleKey: 'phq9',
      mode: 'in-session',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Clear previous audit entries (from creation)
    await runAsService(async (db) => {
      await db.delete(auditLog);
    });

    // Submit responses
    await submitScaleResponsesImpl(fakeSupabaseClient(userId), {
      applicationId: createResult.id,
      responses: PHQ9_RESPONSES,
    });

    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.action).toBe('scale.submit');
    expect(auditRows[0]!.resourceType).toBe('scale_application');
    expect(auditRows[0]!.resourceId).toBe(createResult.id);
  });
});
