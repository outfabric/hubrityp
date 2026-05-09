import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { anamnesis, patients, type Anamnesis } from '@/shared/db/schema/patients/tables';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type GetAnamnesisResult =
  | { ok: true; anamnesis: Anamnesis }
  | { ok: true; anamnesis: null }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'patient_not_found' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Retrieves the anamnesis record for a given patient.
 *
 * Ownership is verified via a defense-in-depth check: the patient must
 * belong to the authenticated psychologist (explicit userId filter on the
 * patients table — RLS also enforces this at the DB level). If the patient
 * exists but has no anamnesis, returns `{ ok: true, anamnesis: null }`.
 */
export async function getAnamnesisImpl(
  supabase: SupabaseClient,
  patientId: string,
): Promise<GetAnamnesisResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Verify patient exists and belongs to user (defense-in-depth + RLS)
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, user.id)))
    .limit(1);

  if (!patient) {
    return { ok: false, error: 'patient_not_found' };
  }

  // 3. Fetch anamnesis by patient_id
  const [row] = await db
    .select()
    .from(anamnesis)
    .where(eq(anamnesis.patientId, patientId))
    .limit(1);

  if (!row) {
    return { ok: true, anamnesis: null };
  }

  return { ok: true, anamnesis: row };
}
