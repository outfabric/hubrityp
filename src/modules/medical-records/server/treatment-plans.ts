import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, asc, eq, sql } from 'drizzle-orm';

import {
  getTreatmentPlanInputSchema,
  listTreatmentPlanVersionsInputSchema,
  upsertTreatmentPlanInputSchema,
  type VersionContent,
} from '@/modules/medical-records/lib/treatment-plan-schemas';
import { db } from '@/shared/db/client';
import {
  auditLog,
  treatmentPlanVersions,
  treatmentPlans,
  type TreatmentPlan,
  type TreatmentPlanVersion,
} from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type UpsertTreatmentPlanResult =
  | { ok: true; planId: string; version: number }
  | { ok: false; code: 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'NOT_FOUND' };

export type GetTreatmentPlanResult =
  | { ok: true; plan: TreatmentPlan | null }
  | { ok: false; code: 'UNAUTHORIZED' | 'NOT_FOUND' };

export type ListTreatmentPlanVersionsResult =
  | { ok: true; versions: TreatmentPlanVersion[] }
  | { ok: false; code: 'UNAUTHORIZED' | 'NOT_FOUND' };

// ---------------------------------------------------------------------------
// upsertTreatmentPlan
// ---------------------------------------------------------------------------

/**
 * Creates or updates a treatment plan for the authenticated psychologist's patient.
 *
 * Uses an atomic transaction with SELECT ... FOR UPDATE to serialize concurrent
 * auto-saves from the same user. On first call, creates a new plan + v1 version.
 * On subsequent calls, snapshots the prior state into treatment_plan_versions,
 * then updates the plan with the new content.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 * Patient ownership is checked server-side (defense-in-depth over RLS).
 */
export async function upsertTreatmentPlanImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<UpsertTreatmentPlanResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = upsertTreatmentPlanInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }

  const { patientId, goals, phases, resources, successCriteria } = parsed.data;
  const userId = user.id;

  // 3. Verify patient belongs to the authenticated user (defense-in-depth)
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  // 4. Atomic upsert with FOR UPDATE lock
  try {
    const result = await db.transaction(async (tx) => {
      // Attempt to lock the existing plan row for this patient+user
      const lockResult = await tx.execute(
        sql`SELECT id, current_version, goals, phases, resources, success_criteria
            FROM treatment_plans
            WHERE patient_id = ${patientId} AND user_id = ${userId}
            FOR UPDATE`,
      );

      const existingRow = lockResult[0] as
        | {
            id: string;
            current_version: number;
            goals: unknown;
            phases: unknown;
            resources: string | null;
            success_criteria: string | null;
          }
        | undefined;

      if (existingRow) {
        // Plan exists — increment version and record the new state as a version
        // snapshot. The prior state is already preserved in the previous version row
        // (v1 from creation, or the last update's snapshot). This mirrors the
        // evolution versioning pattern: each version row captures the plan state
        // AT that version number.
        const newVersion = existingRow.current_version + 1;

        const newSnapshot: VersionContent = {
          goals,
          phases,
          resources,
          successCriteria,
        };

        // Insert version snapshot for the new state
        await tx.insert(treatmentPlanVersions).values({
          planId: existingRow.id,
          versionNumber: newVersion,
          content: newSnapshot,
          modifiedBy: userId,
        });

        // Update the plan row with new content + increment version
        await tx
          .update(treatmentPlans)
          .set({
            goals,
            phases,
            resources,
            successCriteria,
            currentVersion: newVersion,
            updatedAt: new Date(),
          })
          .where(and(eq(treatmentPlans.id, existingRow.id), eq(treatmentPlans.userId, userId)));

        // Write audit_log entry
        await tx.insert(auditLog).values({
          userId,
          action: 'treatment-plan.update',
          resourceType: 'treatment_plan',
          resourceId: existingRow.id,
          metadata: { patient_id: patientId },
        });

        return { ok: true as const, planId: existingRow.id, version: newVersion };
      } else {
        // No existing plan — create new plan + version v1
        const [newPlan] = await tx
          .insert(treatmentPlans)
          .values({
            userId,
            patientId,
            goals,
            phases,
            resources,
            successCriteria,
            currentVersion: 1,
          })
          .returning({ id: treatmentPlans.id });

        const contentSnapshot: VersionContent = {
          goals,
          phases,
          resources,
          successCriteria,
        };

        await tx.insert(treatmentPlanVersions).values({
          planId: newPlan!.id,
          versionNumber: 1,
          content: contentSnapshot,
          modifiedBy: userId,
        });

        // Write audit_log entry (first creation, not update)
        await tx.insert(auditLog).values({
          userId,
          action: 'treatment-plan.create',
          resourceType: 'treatment_plan',
          resourceId: newPlan!.id,
          metadata: { patient_id: patientId },
        });

        return { ok: true as const, planId: newPlan!.id, version: 1 };
      }
    });

    return result;
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'upsert_treatment_plan_failed', errorCode: pgError.code },
      'unexpected error upserting treatment plan',
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// getTreatmentPlan
// ---------------------------------------------------------------------------

/**
 * Retrieves the current treatment plan for a patient owned by the
 * authenticated psychologist. Returns null if no plan exists yet.
 *
 * Side-effect: writes audit_log 'treatment-plan.read' ONLY if plan exists.
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function getTreatmentPlanImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<GetTreatmentPlanResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = getTreatmentPlanInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  const { patientId } = parsed.data;
  const userId = user.id;

  // 3. Verify patient belongs to the authenticated user (defense-in-depth)
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  try {
    // 4. Fetch the treatment plan
    const [plan] = await db
      .select()
      .from(treatmentPlans)
      .where(and(eq(treatmentPlans.patientId, patientId), eq(treatmentPlans.userId, userId)))
      .limit(1);

    if (!plan) {
      return { ok: true, plan: null };
    }

    // 5. Write audit_log entry for read access (only if plan exists)
    await db.insert(auditLog).values({
      userId,
      action: 'treatment-plan.read',
      resourceType: 'treatment_plan',
      resourceId: plan.id,
      metadata: { patient_id: patientId },
    });

    return { ok: true, plan };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'get_treatment_plan_failed', errorCode: pgError.code },
      'unexpected error fetching treatment plan',
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// listTreatmentPlanVersions
// ---------------------------------------------------------------------------

/**
 * Returns all version snapshots for a treatment plan, ordered by
 * version_number ASC (chronological history).
 *
 * Ownership check: verifies the parent plan belongs to the authenticated
 * psychologist before returning versions. RLS on treatment_plan_versions uses
 * a JOIN-scoped subquery, so this is defense-in-depth.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function listTreatmentPlanVersionsImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<ListTreatmentPlanVersionsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = listTreatmentPlanVersionsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  const { planId } = parsed.data;
  const userId = user.id;

  try {
    // 3. Verify ownership of the parent plan
    const [plan] = await db
      .select({ id: treatmentPlans.id })
      .from(treatmentPlans)
      .where(and(eq(treatmentPlans.id, planId), eq(treatmentPlans.userId, userId)))
      .limit(1);

    if (!plan) {
      return { ok: false, code: 'NOT_FOUND' };
    }

    // 4. Fetch all versions ordered by version_number ASC (chronological)
    const versions = await db
      .select()
      .from(treatmentPlanVersions)
      .where(eq(treatmentPlanVersions.planId, planId))
      .orderBy(asc(treatmentPlanVersions.versionNumber));

    return { ok: true, versions };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'list_treatment_plan_versions_failed', errorCode: pgError.code },
      'unexpected error listing treatment plan versions',
    );
    throw err;
  }
}
