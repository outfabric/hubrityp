'use server';

// Thin route shell for single-patient Server Actions.
//
// The actual implementations live in `src/modules/patients/server/` (re-exported
// from `@/modules/patients`). This file MUST stay thin and carry the
// `'use server'` directive — that is what marks it as a Server Action entry
// point for the Next.js compiler. Every export of a `'use server'` file MUST
// be an async function; types cannot be re-exported from here.

import type {
  AddGuardianResult,
  ArchivePatientResult,
  DeletePatientResult,
  GetPatientPhotoUrlResult,
  GetPatientResult,
  ListGuardiansResult,
  RemoveGuardianResult,
  UnarchivePatientResult,
  UnlinkCoupleResult,
  UpdateGuardianResult,
  UpdatePatientResult,
} from '@/modules/patients';
import {
  addGuardianImpl,
  archivePatientImpl,
  deletePatientImpl,
  getPatientImpl,
  getPatientPhotoUrlImpl,
  listGuardiansImpl,
  removeGuardianImpl,
  unarchivePatientImpl,
  unlinkCoupleImpl,
  updateGuardianImpl,
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

export async function listGuardians(patientId: string): Promise<ListGuardiansResult> {
  const supabase = await createServerClient();
  return listGuardiansImpl(supabase, patientId);
}

export async function addGuardian(patientId: string, input: unknown): Promise<AddGuardianResult> {
  const supabase = await createServerClient();
  return addGuardianImpl(supabase, patientId, input);
}

export async function updateGuardian(
  guardianId: string,
  input: unknown,
): Promise<UpdateGuardianResult> {
  const supabase = await createServerClient();
  return updateGuardianImpl(supabase, guardianId, input);
}

export async function removeGuardian(guardianId: string): Promise<RemoveGuardianResult> {
  const supabase = await createServerClient();
  return removeGuardianImpl(supabase, guardianId);
}

export async function unlinkCouple(patientId: string): Promise<UnlinkCoupleResult> {
  const supabase = await createServerClient();
  return unlinkCoupleImpl(supabase, patientId);
}
