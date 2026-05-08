import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { patients, type Patient } from '@/shared/db/schema/patients/tables';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type GetPatientResult =
  | { ok: true; patient: Patient }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Retrieves a single patient by ID for the authenticated psychologist.
 *
 * RLS guarantees ownership — if the patient belongs to a different user,
 * the query returns zero rows and we report `not_found` (no information
 * leakage about existence to unauthorized callers).
 */
export async function getPatientImpl(
  supabase: SupabaseClient,
  patientId: string,
): Promise<GetPatientResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Fetch by ID (RLS scopes to owner automatically, but we also add
  //    explicit userId filter for defense-in-depth and query clarity).
  const [row] = await db
    .select()
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, user.id)))
    .limit(1);

  if (!row) {
    return { ok: false, error: 'not_found' };
  }

  return { ok: true, patient: row };
}
