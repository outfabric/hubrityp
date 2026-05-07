import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type DeletePatientResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'has_related_records'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Related records check
// ---------------------------------------------------------------------------

/**
 * Checks whether a patient has related records that prevent hard deletion.
 *
 * Per CFP resolution 001/2009, clinical records must be retained for at least
 * 20 years. Hard delete is only permitted for patients with zero:
 *   - Sessions (appointments)
 *   - Anamnesis records
 *   - Consent terms
 *
 * Since these tables do not exist yet in the current schema (they will be
 * added in future changes), this function currently always returns false.
 * When those tables are created, add the relevant count checks here.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- will become async when related tables exist
async function hasRelatedRecords(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- will be used when sessions/anamnesis/consent tables exist
  patientId: string,
): Promise<boolean> {
  // TODO: When sessions, anamnesis, and consent_terms tables are added,
  // check if any rows reference this patient:
  //
  // const [sessionCount] = await db
  //   .select({ count: sql<number>`count(*)` })
  //   .from(sessions)
  //   .where(eq(sessions.patientId, patientId));
  //
  // const [anamnesisCount] = await db
  //   .select({ count: sql<number>`count(*)` })
  //   .from(anamnesis)
  //   .where(eq(anamnesis.patientId, patientId));
  //
  // const [consentCount] = await db
  //   .select({ count: sql<number>`count(*)` })
  //   .from(consentTerms)
  //   .where(eq(consentTerms.patientId, patientId));
  //
  // return sessionCount.count > 0 || anamnesisCount.count > 0 || consentCount.count > 0;

  return false;
}

// ---------------------------------------------------------------------------
// deletePatientImpl
// ---------------------------------------------------------------------------

/**
 * Hard-deletes a patient from the database.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify patient exists and belongs to user.
 *   3. Check for related records (sessions, anamnesis, consent).
 *   4. If no related records, perform hard delete.
 *
 * When related records exist, deletion is blocked and the user is informed
 * that archiving is the correct action (legal obligation to retain clinical
 * records for 20 years per CFP resolution 001/2009).
 */
export async function deletePatientImpl(
  supabase: SupabaseClient,
  patientId: string,
): Promise<DeletePatientResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  // 2. Verify patient exists and belongs to user
  const [existing] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!existing) {
    return { ok: false, error: 'not_found' };
  }

  // 3. Check for related records
  const hasRecords = await hasRelatedRecords(patientId);
  if (hasRecords) {
    return {
      ok: false,
      error: 'has_related_records',
      message:
        'Este paciente possui sessões, anamnese ou termos de consentimento registrados. ' +
        'Por obrigação legal (Resolução CFP 001/2009), registros clínicos devem ser ' +
        'mantidos por no mínimo 20 anos. Use a opção "Arquivar" em vez de excluir.',
    };
  }

  // 4. Hard delete
  try {
    const deleted = await db
      .delete(patients)
      .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
      .returning({ id: patients.id });

    if (deleted.length === 0) {
      return { ok: false, error: 'not_found' };
    }

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'delete_patient_failed', errorCode: pgError.code },
      'unexpected error deleting patient',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao excluir paciente. Tente novamente.',
    };
  }
}
