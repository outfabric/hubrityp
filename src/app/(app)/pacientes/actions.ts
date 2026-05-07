'use server';

// Thin route shell for patient list-level Server Actions.
//
// The actual implementations live in `src/modules/patients/server/` (re-exported
// from `@/modules/patients`). This file MUST stay thin and carry the
// `'use server'` directive — that is what marks it as a Server Action entry
// point for the Next.js compiler. Every export of a `'use server'` file MUST
// be an async function; types cannot be re-exported from here.
//
// Client Components that need the result types should import them directly from
// `@/modules/patients` (types are erased at compile time so the `server-only`
// guard does not apply to type imports in practice — but the safe pattern is to
// use the type through the function return type).

import type {
  CreatePatientResult,
  ListPatientsResult,
  UploadPatientPhotoResult,
} from '@/modules/patients';
import { createPatientImpl, listPatientsImpl, uploadPatientPhotoImpl } from '@/modules/patients';
import { createServerClient } from '@/shared/supabase/server';

export async function createPatient(input: unknown): Promise<CreatePatientResult> {
  const supabase = await createServerClient();
  return createPatientImpl(supabase, input);
}

export async function listPatients(query: unknown): Promise<ListPatientsResult> {
  const supabase = await createServerClient();
  return listPatientsImpl(supabase, query);
}

export async function uploadPatientPhoto(
  patientId: string,
  formData: FormData,
): Promise<UploadPatientPhotoResult> {
  const supabase = await createServerClient();
  return uploadPatientPhotoImpl(supabase, patientId, formData);
}
