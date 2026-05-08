'use server';

// Thin route shell for single-patient Server Actions.
//
// The actual implementations live in `src/modules/patients/server/` (re-exported
// from `@/modules/patients`). This file MUST stay thin and carry the
// `'use server'` directive — that is what marks it as a Server Action entry
// point for the Next.js compiler. Every export of a `'use server'` file MUST
// be an async function; types cannot be re-exported from here.

import type {
  ArchivePatientResult,
  DeletePatientResult,
  GetPatientPhotoUrlResult,
  GetPatientResult,
  UnarchivePatientResult,
  UpdatePatientResult,
} from '@/modules/patients';
import {
  archivePatientImpl,
  deletePatientImpl,
  getPatientImpl,
  getPatientPhotoUrlImpl,
  unarchivePatientImpl,
  updatePatientImpl,
} from '@/modules/patients';
import { createServerClient } from '@/shared/supabase/server';

export async function getPatient(patientId: string): Promise<GetPatientResult> {
  const supabase = await createServerClient();
  return getPatientImpl(supabase, patientId);
}

export async function updatePatient(
  patientId: string,
  input: unknown,
): Promise<UpdatePatientResult> {
  const supabase = await createServerClient();
  return updatePatientImpl(supabase, patientId, input);
}

export async function archivePatient(patientId: string): Promise<ArchivePatientResult> {
  const supabase = await createServerClient();
  return archivePatientImpl(supabase, patientId);
}

export async function unarchivePatient(patientId: string): Promise<UnarchivePatientResult> {
  const supabase = await createServerClient();
  return unarchivePatientImpl(supabase, patientId);
}

export async function deletePatient(patientId: string): Promise<DeletePatientResult> {
  const supabase = await createServerClient();
  return deletePatientImpl(supabase, patientId);
}

export async function getPatientPhotoUrl(patientId: string): Promise<GetPatientPhotoUrlResult> {
  const supabase = await createServerClient();
  return getPatientPhotoUrlImpl(supabase, patientId);
}
