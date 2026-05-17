import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { scaleByKey, type ClassificationResult } from '@/modules/medical-records/lib/scales';
import { generateScaleToken } from '@/modules/medical-records/lib/scales/token';
import {
  createScaleApplicationSchema,
  submitResponsesSchema,
} from '@/modules/medical-records/lib/scales-schemas';
import { db } from '@/shared/db/client';
import { auditLog, scaleApplications } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CreateScaleApplicationResult =
  | { ok: true; id: string; remoteToken?: string }
  | { ok: false; code: 'INVALID_SCALE' | 'UNAUTHORIZED' | 'PATIENT_NOT_FOUND' };

export type SubmitScaleResponsesResult =
  | { ok: true; totalScore: number | null; classification: ClassificationResult }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_COMPLETED' | 'UNAUTHORIZED' | 'INVALID_RESPONSES' };

// ---------------------------------------------------------------------------
// createScaleApplicationImpl
// ---------------------------------------------------------------------------

/**
 * Creates a scale application for the authenticated psychologist's patient.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input with Zod (createScaleApplicationSchema).
 *   3. Look up scale definition — reject if unknown.
 *   4. Verify patient ownership (defense-in-depth — db bypasses RLS).
 *   5. For remote mode: generate token + compute tokenExpiresAt.
 *   6. INSERT scale_applications row with user_id from session.
 *   7. Write audit_log 'scale.create'.
 *   8. Return id (+ remoteToken for remote mode).
 *
 * The caller (UI) constructs the public link from the token
 * (e.g., `/escala/${token}`). This keeps the server action independent of
 * the deployment URL — matching the existing generate-consent pattern.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function createScaleApplicationImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<CreateScaleApplicationResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = createScaleApplicationSchema.safeParse(input);
  if (!parsed.success) {
    // If scaleKey is the issue, report INVALID_SCALE
    const fieldErrors = parsed.error.flatten().fieldErrors;
    if (fieldErrors.scaleKey) {
      return { ok: false, code: 'INVALID_SCALE' };
    }
    // Generic validation failure — treat as invalid scale for safety
    return { ok: false, code: 'INVALID_SCALE' };
  }

  const { patientId, scaleKey, mode, expiresInHours } = parsed.data;
  const userId = user.id;

  // 3. Look up scale definition
  const scaleDef = scaleByKey(scaleKey);
  if (!scaleDef) {
    return { ok: false, code: 'INVALID_SCALE' };
  }

  // 4. Verify patient belongs to the authenticated user (defense-in-depth:
  // db bypasses RLS, so explicit ownership check prevents cross-tenant writes)
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    return { ok: false, code: 'PATIENT_NOT_FOUND' };
  }

  // 5. Determine remote vs in-session fields
  const isRemote = mode === 'remote';
  const remoteToken = isRemote ? generateScaleToken() : null;
  const tokenExpiresAt = isRemote
    ? new Date(Date.now() + (expiresInHours ?? 48) * 60 * 60 * 1000)
    : null;

  // 6. INSERT row
  try {
    const [application] = await db
      .insert(scaleApplications)
      .values({
        userId,
        patientId,
        scaleKey,
        appliedRemotely: isRemote,
        remoteToken,
        tokenExpiresAt,
      })
      .returning({ id: scaleApplications.id });

    // 7. Write audit_log entry (fire-and-forget on failure)
    try {
      await db.insert(auditLog).values({
        userId,
        action: 'scale.create',
        resourceType: 'scale_application',
        resourceId: application!.id,
        metadata: { patientId, scaleKey, mode },
      });
    } catch (auditErr: unknown) {
      const pgError = auditErr as { code?: string };
      logger.error(
        { event: 'scale_audit_log_failed', errorCode: pgError.code },
        'failed to write audit_log entry for scale.create',
      );
    }

    // 8. Return result
    const result: CreateScaleApplicationResult = { ok: true, id: application!.id };
    if (isRemote && remoteToken) {
      result.remoteToken = remoteToken;
    }
    return result;
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'create_scale_application_failed', errorCode: pgError.code },
      'unexpected error creating scale application',
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// submitScaleResponsesImpl
// ---------------------------------------------------------------------------

/**
 * Submits responses for an in-session scale application (psychologist-side).
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input with Zod (submitResponsesSchema).
 *   3. Load application WHERE id AND user_id = session.uid (ownership check).
 *   4. Reject if already completed (completedAt set).
 *   5. Look up scale definition; compute score + classification.
 *   6. UPDATE row with responses, totalScore, classification, completedAt.
 *   7. Write audit_log 'scale.submit'.
 *   8. Return totalScore + classification.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function submitScaleResponsesImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<SubmitScaleResponsesResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = submitResponsesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_RESPONSES' };
  }

  const { applicationId, responses } = parsed.data;
  const userId = user.id;

  // 3. Load application with ownership check (WHERE id AND user_id = auth.uid())
  const [application] = await db
    .select({
      id: scaleApplications.id,
      scaleKey: scaleApplications.scaleKey,
      completedAt: scaleApplications.completedAt,
    })
    .from(scaleApplications)
    .where(and(eq(scaleApplications.id, applicationId), eq(scaleApplications.userId, userId)))
    .limit(1);

  if (!application) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  // 4. Reject if already completed — no mutation allowed
  if (application.completedAt !== null) {
    return { ok: false, code: 'ALREADY_COMPLETED' };
  }

  // 5. Look up scale definition and compute score + classification
  const scaleDef = scaleByKey(application.scaleKey);
  if (!scaleDef) {
    // Defensive: scale_key CHECK constraint should prevent this, but handle gracefully
    return { ok: false, code: 'NOT_FOUND' };
  }

  const totalScore = scaleDef.score(responses);
  const classification = scaleDef.classify(totalScore, responses);

  // 6. UPDATE row
  try {
    const now = new Date();
    await db
      .update(scaleApplications)
      .set({
        responses,
        totalScore,
        classification: classification.label,
        completedAt: now,
      })
      .where(and(eq(scaleApplications.id, applicationId), eq(scaleApplications.userId, userId)));

    // 7. Write audit_log entry (fire-and-forget on failure)
    try {
      await db.insert(auditLog).values({
        userId,
        action: 'scale.submit',
        resourceType: 'scale_application',
        resourceId: applicationId,
        metadata: { scaleKey: application.scaleKey, hasTotalScore: totalScore !== null },
      });
    } catch (auditErr: unknown) {
      const pgError = auditErr as { code?: string };
      logger.error(
        { event: 'scale_audit_log_failed', errorCode: pgError.code },
        'failed to write audit_log entry for scale.submit',
      );
    }

    // 8. Return result
    return { ok: true, totalScore, classification };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'submit_scale_responses_failed', errorCode: pgError.code },
      'unexpected error submitting scale responses',
    );
    throw err;
  }
}
