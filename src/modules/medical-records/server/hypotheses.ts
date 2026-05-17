import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';

import {
  createHypothesisSchema,
  updateHypothesisSchema,
  updateHypothesisStatusSchema,
} from '@/modules/medical-records/lib/schemas/hypothesis';
import { db } from '@/shared/db/client';
import { auditLog, diagnosticHypotheses } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CreateHypothesisResult =
  | { ok: true; id: string }
  | { ok: false; code: 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'NOT_FOUND' };

export type UpdateHypothesisResult =
  | { ok: true }
  | { ok: false; code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'UNAUTHORIZED' };

export type UpdateHypothesisStatusResult =
  | { ok: true }
  | { ok: false; code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'UNAUTHORIZED' };

export type ListHypothesesResult =
  | { ok: true; hypotheses: HypothesisSummary[] }
  | { ok: false; code: 'VALIDATION_ERROR' | 'UNAUTHORIZED' };

export interface HypothesisSummary {
  id: string;
  patientId: string;
  description: string | null;
  cid10Code: string | null;
  cid10Description: string | null;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Input schemas (list-specific)
// ---------------------------------------------------------------------------

const listHypothesesByPatientSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID valido.' }),
  includeDiscarded: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// createHypothesis
// ---------------------------------------------------------------------------

/**
 * Creates a new diagnostic hypothesis for the authenticated psychologist's patient.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input with Zod (createHypothesisSchema).
 *   3. Verify patient ownership (defense-in-depth — db bypasses RLS).
 *   4. INSERT hypothesis with user_id from session (never from input).
 *   5. Write audit_log 'hypothesis.create' via service-role (direct Drizzle INSERT).
 *   6. Return hypothesis ID on success.
 */
export async function createHypothesisImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<CreateHypothesisResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = createHypothesisSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }

  const { patientId, description, cid10Code, cid10Description, notes } = parsed.data;
  const userId = user.id;

  // 3. Verify patient belongs to the authenticated user (defense-in-depth:
  // db bypasses RLS, so explicit ownership check prevents cross-tenant writes)
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  // 4. INSERT hypothesis row
  try {
    const [hypothesis] = await db
      .insert(diagnosticHypotheses)
      .values({
        userId,
        patientId,
        description: description ?? null,
        cid10Code: cid10Code ?? null,
        cid10Description: cid10Description ?? null,
        notes: notes ?? null,
        status: 'investigating',
      })
      .returning({ id: diagnosticHypotheses.id });

    // 5. Write audit_log entry (fire-and-forget on failure)
    try {
      await db.insert(auditLog).values({
        userId,
        action: 'hypothesis.create',
        resourceType: 'diagnostic_hypothesis',
        resourceId: hypothesis!.id,
        metadata: { patientId },
      });
    } catch (auditErr: unknown) {
      const pgError = auditErr as { code?: string };
      logger.error(
        { event: 'hypothesis_audit_log_failed', errorCode: pgError.code },
        'failed to write audit_log entry for hypothesis.create',
      );
    }

    return { ok: true, id: hypothesis!.id };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'create_hypothesis_failed', errorCode: pgError.code },
      'unexpected error creating hypothesis',
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// updateHypothesis
// ---------------------------------------------------------------------------

/**
 * Updates an existing diagnostic hypothesis for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input with Zod (updateHypothesisSchema).
 *   3. Query with WHERE id AND user_id = session.uid (ownership check).
 *   4. Update fields + set updated_at.
 *   5. Write audit_log 'hypothesis.update'.
 *   6. Return {ok: true} on success.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function updateHypothesisImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<UpdateHypothesisResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = updateHypothesisSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }

  const { hypothesisId, description, cid10Code, cid10Description, notes } = parsed.data;
  const userId = user.id;

  // 3. Build update payload — only include fields that were provided
  const updateFields: Record<string, unknown> = { updatedAt: new Date() };

  if (description !== undefined) {
    updateFields.description = description || null;
  }
  if (cid10Code !== undefined) {
    updateFields.cid10Code = cid10Code || null;
  }
  if (cid10Description !== undefined) {
    updateFields.cid10Description = cid10Description || null;
  }
  if (notes !== undefined) {
    updateFields.notes = notes || null;
  }

  try {
    // 4. Update with ownership check (WHERE id AND user_id = auth.uid())
    const updated = await db
      .update(diagnosticHypotheses)
      .set(updateFields)
      .where(
        and(eq(diagnosticHypotheses.id, hypothesisId), eq(diagnosticHypotheses.userId, userId)),
      )
      .returning({ id: diagnosticHypotheses.id });

    if (updated.length === 0) {
      return { ok: false, code: 'NOT_FOUND' };
    }

    // 5. Write audit_log entry (fire-and-forget on failure)
    try {
      await db.insert(auditLog).values({
        userId,
        action: 'hypothesis.update',
        resourceType: 'diagnostic_hypothesis',
        resourceId: hypothesisId,
        metadata: {},
      });
    } catch (auditErr: unknown) {
      const pgError = auditErr as { code?: string };
      logger.error(
        { event: 'hypothesis_audit_log_failed', errorCode: pgError.code },
        'failed to write audit_log entry for hypothesis.update',
      );
    }

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'update_hypothesis_failed', errorCode: pgError.code },
      'unexpected error updating hypothesis',
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// updateHypothesisStatus
// ---------------------------------------------------------------------------

/**
 * Transitions the status of an existing diagnostic hypothesis.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input with Zod (updateHypothesisStatusSchema).
 *   3. Fetch the current hypothesis with ownership check.
 *   4. Update status + notes + updated_at.
 *   5. Write audit_log 'hypothesis.status-change' with metadata {old_status, new_status}.
 *   6. Return {ok: true} on success.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function updateHypothesisStatusImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<UpdateHypothesisStatusResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = updateHypothesisStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }

  const { hypothesisId, status: newStatus, notes } = parsed.data;
  const userId = user.id;

  try {
    // 3. Fetch current hypothesis (ownership check: WHERE id AND user_id = auth.uid())
    const [existing] = await db
      .select({ id: diagnosticHypotheses.id, status: diagnosticHypotheses.status })
      .from(diagnosticHypotheses)
      .where(
        and(eq(diagnosticHypotheses.id, hypothesisId), eq(diagnosticHypotheses.userId, userId)),
      )
      .limit(1);

    if (!existing) {
      return { ok: false, code: 'NOT_FOUND' };
    }

    const oldStatus = existing.status;

    // 4. Update status + notes + updated_at
    const updateFields: Record<string, unknown> = {
      status: newStatus,
      updatedAt: new Date(),
    };

    // Only update notes if provided (spec: "notes remains unchanged" when not provided)
    if (notes !== undefined) {
      updateFields.notes = notes || null;
    }

    await db
      .update(diagnosticHypotheses)
      .set(updateFields)
      .where(
        and(eq(diagnosticHypotheses.id, hypothesisId), eq(diagnosticHypotheses.userId, userId)),
      );

    // 5. Write audit_log entry with old/new status metadata
    try {
      await db.insert(auditLog).values({
        userId,
        action: 'hypothesis.status-change',
        resourceType: 'diagnostic_hypothesis',
        resourceId: hypothesisId,
        metadata: { old_status: oldStatus, new_status: newStatus },
      });
    } catch (auditErr: unknown) {
      const pgError = auditErr as { code?: string };
      logger.error(
        { event: 'hypothesis_audit_log_failed', errorCode: pgError.code },
        'failed to write audit_log entry for hypothesis.status-change',
      );
    }

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'update_hypothesis_status_failed', errorCode: pgError.code },
      'unexpected error updating hypothesis status',
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// listHypothesesByPatient
// ---------------------------------------------------------------------------

/**
 * Returns diagnostic hypotheses for a given patient owned by the requesting
 * psychologist, ordered by created_at DESC.
 *
 * By default, discarded hypotheses are excluded. Set `includeDiscarded=true`
 * to include them.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input with Zod.
 *   3. Query WHERE patient_id AND user_id = auth.uid() with optional status filter.
 *   4. Write audit_log 'hypothesis.read' (resource_id = patientId).
 *   5. Return hypotheses array.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function listHypothesesByPatientImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<ListHypothesesResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = listHypothesesByPatientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }

  const { patientId, includeDiscarded } = parsed.data;
  const userId = user.id;

  try {
    // 3. Build query conditions
    const conditions = [
      eq(diagnosticHypotheses.userId, userId),
      eq(diagnosticHypotheses.patientId, patientId),
    ];

    // Default excludes discarded unless includeDiscarded=true
    if (!includeDiscarded) {
      conditions.push(ne(diagnosticHypotheses.status, 'discarded'));
    }

    const rows = await db
      .select({
        id: diagnosticHypotheses.id,
        patientId: diagnosticHypotheses.patientId,
        description: diagnosticHypotheses.description,
        cid10Code: diagnosticHypotheses.cid10Code,
        cid10Description: diagnosticHypotheses.cid10Description,
        status: diagnosticHypotheses.status,
        notes: diagnosticHypotheses.notes,
        createdAt: diagnosticHypotheses.createdAt,
        updatedAt: diagnosticHypotheses.updatedAt,
      })
      .from(diagnosticHypotheses)
      .where(and(...conditions))
      .orderBy(desc(diagnosticHypotheses.createdAt));

    // 4. Write audit_log entry for read access (resource_id = patientId)
    try {
      await db.insert(auditLog).values({
        userId,
        action: 'hypothesis.read',
        resourceType: 'diagnostic_hypothesis',
        resourceId: patientId,
        metadata: { itemCount: rows.length, includeDiscarded },
      });
    } catch (auditErr: unknown) {
      const pgError = auditErr as { code?: string };
      logger.error(
        { event: 'hypothesis_audit_log_failed', errorCode: pgError.code },
        'failed to write audit_log entry for hypothesis.read',
      );
    }

    return { ok: true, hypotheses: rows };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'list_hypotheses_failed', errorCode: pgError.code },
      'unexpected error listing hypotheses',
    );
    throw err;
  }
}
