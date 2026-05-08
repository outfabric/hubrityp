import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import {
  patientGuardians,
  patients,
  type PatientGuardian,
} from '@/shared/db/schema/patients/tables';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ListGuardiansResult =
  | { ok: true; guardians: PatientGuardian[] }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'patient_not_found' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Lists all guardians for a patient owned by the authenticated user.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify patient exists and belongs to the user.
 *   3. Query all guardians for the patient, ordered by primary first.
 */
export async function listGuardiansImpl(
  supabase: SupabaseClient,
  patientId: string,
): Promise<ListGuardiansResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  // 2. Verify patient exists and belongs to user
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    return { ok: false, error: 'patient_not_found' };
  }

  // 3. Query guardians ordered by primary first, then by creation date
  const guardians = await db
    .select()
    .from(patientGuardians)
    .where(eq(patientGuardians.patientId, patientId))
    .orderBy(desc(patientGuardians.isPrimary), patientGuardians.createdAt);

  return { ok: true, guardians };
}
