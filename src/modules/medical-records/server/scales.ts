import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

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

// ---------------------------------------------------------------------------
// Shared types for history and listing
// ---------------------------------------------------------------------------

export interface TimeseriesPoint {
  appliedAt: string; // ISO 8601
  totalScore: number | null;
  classification: string | null;
}

export interface ScaleApplicationSummary {
  id: string;
  scaleKey: string;
  appliedAt: string; // ISO 8601
  totalScore: number | null;
  classification: string | null;
  isCompleted: boolean;
  appliedRemotely: boolean;
}

export interface ScaleSummary {
  scaleKey: string;
  lastScore: number | null;
  lastDate: string; // ISO 8601
  lastClassification: string | null;
  timeseries: TimeseriesPoint[];
}

// ---------------------------------------------------------------------------
// Result types for history / listing
// ---------------------------------------------------------------------------

export type GetScaleHistoryResult =
  | { ok: true; applications: ScaleApplicationSummary[]; timeseries: TimeseriesPoint[] }
  | { ok: false; code: 'UNAUTHORIZED' | 'INVALID_INPUT' };

export type ListScalesForPatientResult =
  | { ok: true; scales: ScaleSummary[] }
  | { ok: false; code: 'UNAUTHORIZED' | 'INVALID_INPUT' };

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const getScaleHistorySchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID valido.' }),
  scaleKey: z.string().optional(),
});

const listScalesForPatientSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID valido.' }),
});

// ---------------------------------------------------------------------------
// getScaleHistory
// ---------------------------------------------------------------------------

/**
 * Retrieves the scale application history for a specific patient.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input with Zod.
 *   3. Query scale_applications WHERE patient_id AND user_id = auth.uid()
 *      (defense-in-depth: explicit ownership check + RLS on the db client).
 *   4. Build application summaries + timeseries from completed applications.
 *   5. Write audit_log 'scale.history-read'.
 *   6. Return applications + timeseries.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function getScaleHistory(
  supabase: SupabaseClient,
  input: unknown,
): Promise<GetScaleHistoryResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = getScaleHistorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT' };
  }

  const { patientId, scaleKey } = parsed.data;
  const userId = user.id;

  // 3. Query with ownership check (WHERE user_id = session.uid)
  const conditions = [
    eq(scaleApplications.patientId, patientId),
    eq(scaleApplications.userId, userId),
  ];
  if (scaleKey) {
    conditions.push(eq(scaleApplications.scaleKey, scaleKey));
  }

  try {
    const rows = await db
      .select({
        id: scaleApplications.id,
        scaleKey: scaleApplications.scaleKey,
        appliedAt: scaleApplications.appliedAt,
        totalScore: scaleApplications.totalScore,
        classification: scaleApplications.classification,
        completedAt: scaleApplications.completedAt,
        appliedRemotely: scaleApplications.appliedRemotely,
      })
      .from(scaleApplications)
      .where(and(...conditions))
      .orderBy(desc(scaleApplications.appliedAt));

    // 4. Build summaries + timeseries
    const applications: ScaleApplicationSummary[] = rows.map((r) => ({
      id: r.id,
      scaleKey: r.scaleKey,
      appliedAt: r.appliedAt.toISOString(),
      totalScore: r.totalScore,
      classification: r.classification,
      isCompleted: r.completedAt !== null,
      appliedRemotely: r.appliedRemotely,
    }));

    // Timeseries includes only completed applications (those with scores)
    const timeseries: TimeseriesPoint[] = rows
      .filter((r) => r.completedAt !== null)
      .map((r) => ({
        appliedAt: r.appliedAt.toISOString(),
        totalScore: r.totalScore,
        classification: r.classification,
      }));

    // 5. Write audit_log (fire-and-forget)
    try {
      await db.insert(auditLog).values({
        userId,
        action: 'scale.history-read',
        resourceType: 'patient',
        resourceId: patientId,
        metadata: { scaleKey: scaleKey ?? null, resultCount: applications.length },
      });
    } catch (auditErr: unknown) {
      const pgError = auditErr as { code?: string };
      logger.error(
        { event: 'scale_audit_log_failed', errorCode: pgError.code },
        'failed to write audit_log entry for scale.history-read',
      );
    }

    // 6. Return result
    return { ok: true, applications, timeseries };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'get_scale_history_failed', errorCode: pgError.code },
      'unexpected error fetching scale history',
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// listScalesForPatient
// ---------------------------------------------------------------------------

/**
 * Lists a summary of every distinct scale ever applied for a patient.
 *
 * Returns one entry per scale_key with the most recent score, date,
 * classification, and a chart-ready timeseries array.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input with Zod.
 *   3. Query scale_applications WHERE patient_id AND user_id = auth.uid()
 *      ORDER BY applied_at DESC.
 *   4. Group by scale_key, extract latest + timeseries per scale.
 *   5. Return the summary array.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function listScalesForPatient(
  supabase: SupabaseClient,
  input: unknown,
): Promise<ListScalesForPatientResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = listScalesForPatientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT' };
  }

  const { patientId } = parsed.data;
  const userId = user.id;

  try {
    // 3. Query all applications for this patient owned by the authenticated user
    const rows = await db
      .select({
        scaleKey: scaleApplications.scaleKey,
        appliedAt: scaleApplications.appliedAt,
        totalScore: scaleApplications.totalScore,
        classification: scaleApplications.classification,
        completedAt: scaleApplications.completedAt,
      })
      .from(scaleApplications)
      .where(and(eq(scaleApplications.patientId, patientId), eq(scaleApplications.userId, userId)))
      .orderBy(desc(scaleApplications.appliedAt));

    // 4. Group by scaleKey, build summary per scale
    const scaleMap = new Map<
      string,
      {
        lastScore: number | null;
        lastDate: string;
        lastClassification: string | null;
        timeseries: TimeseriesPoint[];
      }
    >();

    for (const row of rows) {
      const existing = scaleMap.get(row.scaleKey);

      // Timeseries entry only for completed applications
      const tsPoint: TimeseriesPoint | null =
        row.completedAt !== null
          ? {
              appliedAt: row.appliedAt.toISOString(),
              totalScore: row.totalScore,
              classification: row.classification,
            }
          : null;

      if (!existing) {
        // First row for this scale (most recent due to ORDER BY DESC)
        const lastCompleted = row.completedAt !== null;
        scaleMap.set(row.scaleKey, {
          lastScore: lastCompleted ? row.totalScore : null,
          lastDate: row.appliedAt.toISOString(),
          lastClassification: lastCompleted ? row.classification : null,
          timeseries: tsPoint ? [tsPoint] : [],
        });
      } else {
        // Subsequent rows — update lastScore/lastClassification if this is
        // the first completed one we've seen and the current latest wasn't completed
        if (
          existing.lastScore === null &&
          existing.lastClassification === null &&
          row.completedAt !== null
        ) {
          existing.lastScore = row.totalScore;
          existing.lastClassification = row.classification;
        }
        if (tsPoint) {
          existing.timeseries.push(tsPoint);
        }
      }
    }

    // 5. Build result array
    const scales: ScaleSummary[] = [];
    for (const [scaleKey, data] of scaleMap) {
      scales.push({
        scaleKey,
        lastScore: data.lastScore,
        lastDate: data.lastDate,
        lastClassification: data.lastClassification,
        timeseries: data.timeseries,
      });
    }

    return { ok: true, scales };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'list_scales_for_patient_failed', errorCode: pgError.code },
      'unexpected error listing scales for patient',
    );
    throw err;
  }
}
