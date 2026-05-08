import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type UnlinkCoupleResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'no_couple'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Unlinks two coupled patients by clearing their `couple_id` and resetting
 * `patient_type` to `"individual"`.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Look up the patient by ID, scoped to the authenticated user.
 *   3. Verify the patient has a `couple_id` (otherwise nothing to unlink).
 *   4. In a transaction, update BOTH patients with the same `couple_id`:
 *      set `couple_id = null`, `patient_type = 'individual'`, `updated_at = now()`.
 *   5. Return success or appropriate error.
 */
export async function unlinkCoupleImpl(
  supabase: SupabaseClient,
  patientId: string,
): Promise<UnlinkCoupleResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  // 2. Find the patient and verify ownership
  const [patient] = await db
    .select({ id: patients.id, coupleId: patients.coupleId })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    return { ok: false, error: 'not_found' };
  }

  // 3. Check that the patient is actually part of a couple
  if (!patient.coupleId) {
    return {
      ok: false,
      error: 'no_couple',
      message: 'Este paciente não faz parte de um casal.',
    };
  }

  const coupleId = patient.coupleId;

  // 4. Unlink both partners atomically
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(patients)
        .set({
          coupleId: null,
          patientType: 'individual',
          updatedAt: sql`now()`,
        })
        .where(and(eq(patients.coupleId, coupleId), eq(patients.userId, userId)));
    });

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'unlink_couple_failed', errorCode: pgError.code },
      'unexpected error unlinking couple',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao desvincular casal. Tente novamente.',
    };
  }
}
