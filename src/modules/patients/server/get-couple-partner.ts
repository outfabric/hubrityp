import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, ne } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { patients, type Patient } from '@/shared/db/schema/patients/tables';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type GetCouplePartnerResult =
  | { ok: true; partner: Patient }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'no_partner'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Given a patient ID, retrieves the other patient linked via the same
 * `couple_id`.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Look up the source patient (scoped to owner).
 *   3. If the patient has no `couple_id`, return `no_partner`.
 *   4. Query for the other patient with the same `couple_id` and different ID.
 *   5. Return partner data or `no_partner` if none found (data inconsistency).
 */
export async function getCouplePartnerImpl(
  supabase: SupabaseClient,
  patientId: string,
): Promise<GetCouplePartnerResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  // 2. Find the source patient
  const [patient] = await db
    .select({ id: patients.id, coupleId: patients.coupleId })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    return { ok: false, error: 'not_found' };
  }

  // 3. Check that the patient is part of a couple
  if (!patient.coupleId) {
    return {
      ok: false,
      error: 'no_partner',
      message: 'Este paciente não faz parte de um casal.',
    };
  }

  // 4. Find the partner
  const [partner] = await db
    .select()
    .from(patients)
    .where(
      and(
        eq(patients.coupleId, patient.coupleId),
        ne(patients.id, patientId),
        eq(patients.userId, userId),
      ),
    )
    .limit(1);

  if (!partner) {
    return {
      ok: false,
      error: 'no_partner',
      message: 'Parceiro não encontrado para este casal.',
    };
  }

  return { ok: true, partner };
}
