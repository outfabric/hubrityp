import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { updateGuardianSchema } from '@/modules/patients/lib/guardian-input-schema';
import { formatPhone } from '@/modules/patients/lib/patient-validators';
import { db } from '@/shared/db/client';
import { patientGuardians, patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type UpdateGuardianResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'validation_error'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'internal_error'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Updates an existing guardian for a patient owned by the authenticated user.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input against `updateGuardianSchema`.
 *   3. Verify guardian exists and its patient belongs to the user.
 *   4. Build update payload (only include provided fields).
 *   5. Update via Drizzle.
 */
export async function updateGuardianImpl(
  supabase: SupabaseClient,
  guardianId: string,
  input: unknown,
): Promise<UpdateGuardianResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = updateGuardianSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_error',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data = parsed.data;
  const userId = user.id;

  // 3. Verify guardian exists and its patient belongs to the user.
  //    Join guardian → patient to enforce ownership without a separate query.
  const [existing] = await db
    .select({ guardianId: patientGuardians.id })
    .from(patientGuardians)
    .innerJoin(patients, eq(patientGuardians.patientId, patients.id))
    .where(and(eq(patientGuardians.id, guardianId), eq(patients.userId, userId)))
    .limit(1);

  if (!existing) {
    return { ok: false, error: 'not_found' };
  }

  // 4. Build update payload (only include fields that were provided)
  const updatePayload: Record<string, unknown> = {};

  if (data.fullName !== undefined) updatePayload.fullName = data.fullName;
  if (data.relationship !== undefined) updatePayload.relationship = data.relationship;
  if (data.phone !== undefined) updatePayload.phone = formatPhone(data.phone);
  if (data.cpf !== undefined)
    updatePayload.cpf = data.cpf && data.cpf.trim() !== '' ? data.cpf.trim() : null;
  if (data.email !== undefined)
    updatePayload.email = data.email && data.email.trim() !== '' ? data.email.trim() : null;
  if (data.isPrimary !== undefined) updatePayload.isPrimary = data.isPrimary;

  // Nothing to update — still a success (idempotent)
  if (Object.keys(updatePayload).length === 0) {
    return { ok: true };
  }

  // 5. Update via Drizzle
  try {
    const updated = await db
      .update(patientGuardians)
      .set(updatePayload)
      .where(eq(patientGuardians.id, guardianId))
      .returning({ id: patientGuardians.id });

    if (updated.length === 0) {
      return { ok: false, error: 'not_found' };
    }

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'update_guardian_failed', errorCode: pgError.code },
      'unexpected error updating guardian',
    );
    return {
      ok: false,
      error: 'internal_error',
      message: 'Erro inesperado ao atualizar responsável. Tente novamente.',
    };
  }
}
