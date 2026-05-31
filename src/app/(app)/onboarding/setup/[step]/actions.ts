'use server';

import {
  type CompleteOnboardingResult,
  completeOnboardingImpl,
  configureLocationImpl,
  type ImportPatientsStepResult,
  importOnboardingPatientsImpl,
  type LocationStepInput,
  type OnboardingCsvPatientRow,
  type QuickAddPatientStepResult,
  quickAddOnboardingPatientImpl,
  saveOnboardingStepImpl,
  skipOnboardingImpl,
  type SkipPatientsStepResult,
  uploadProfilePhotoImpl,
  type WizardStep,
} from '@/modules/onboarding';
import { createServerClient } from '@/shared/supabase/server';

export type { CompleteOnboardingResult } from '@/modules/onboarding';

// ---------------------------------------------------------------------------
// Result shapes returned to the client wizard components
// ---------------------------------------------------------------------------

export type SaveProfileStepResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' | 'unknown' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> };

export type UploadPhotoActionResult =
  | { ok: true; objectKey: string }
  | { ok: false; message: string };

export type SaveLocationStepResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' | 'unknown' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> };

/**
 * Thin Server Action wrappers for the onboarding wizard's step-1 surface.
 *
 * The `'use server'` directive lives here (the call-site boundary), not inside
 * the module `server/` impls, per project conventions. Both actions are
 * session-scoped: the request-bound Supabase server client carries the session
 * cookies and `auth.uid()` is the only authorization source. No client-supplied
 * user id is accepted, so there is no IDOR vector. RLS is the backstop.
 */

/**
 * Advances the wizard by persisting a target step server-side. The step is
 * fixed by the call site (the client never chooses an arbitrary step), and the
 * impl Zod-validates it at the boundary.
 */
export async function saveProfileStep(): Promise<SaveProfileStepResult> {
  const supabase = await createServerClient();
  // The user just completed step 1 ("profile"). `saveOnboardingStepImpl`
  // flips that completed step's checklist flag (`profile_completed`) AND
  // advances `profiles.onboarding_step` to the NEXT step ("location"), per the
  // onboarding-wizard spec ("Advancing step 1 … sets onboarding_step =
  // 'location'"). The client then navigates forward to step 2.
  const completedStep: WizardStep = 'profile';
  const result = await saveOnboardingStepImpl(supabase, { step: completedStep });

  if (result.ok) return { ok: true };
  if (result.error === 'invalid_input') {
    return { ok: false, error: 'invalid_input', fieldErrors: result.fieldErrors };
  }
  if (result.error === 'unauthenticated') {
    return { ok: false, error: 'unauthenticated' };
  }
  return { ok: false, error: 'unknown' };
}

/**
 * Uploads the optional profile photo. The file is validated SERVER-side
 * (MIME/size/extension) and stored under a UUID name in the owner-scoped
 * Storage prefix. Errors are collapsed to a single sanitized message for the UI.
 */
export async function uploadProfilePhoto(formData: FormData): Promise<UploadPhotoActionResult> {
  const supabase = await createServerClient();
  const result = await uploadProfilePhotoImpl(supabase, formData);

  if (result.ok) return { ok: true, objectKey: result.objectKey };

  if (result.error === 'unauthenticated') {
    return { ok: false, message: 'Sessão expirada. Entre novamente.' };
  }
  return { ok: false, message: result.message };
}

/**
 * Completes step 2 ("Local e agenda") by creating the first consultation
 * location through the agenda module's create path. On success the impl flips
 * `onboarding_checklist.location_configured`, ensures an `agenda_settings` row
 * (table defaults: 50-min sessions, 10-min interval, standard working hours),
 * and advances the step. The location shape is Zod-validated at the impl
 * boundary; the result is collapsed to a sanitized shape for the UI.
 */
export async function createOnboardingLocation(
  input: LocationStepInput,
): Promise<SaveLocationStepResult> {
  const supabase = await createServerClient();
  const result = await configureLocationImpl(supabase, input);

  if (result.ok) return { ok: true };
  if (result.error === 'invalid_input') {
    return { ok: false, error: 'invalid_input', fieldErrors: result.fieldErrors };
  }
  if (result.error === 'unauthenticated') {
    return { ok: false, error: 'unauthenticated' };
  }
  return { ok: false, error: 'unknown' };
}

/**
 * Completes step 3 ("Importe pacientes") via CSV import. The impl enforces the
 * LGPD sensitive-data consent gate SERVER-side (refusing to start the import
 * when `sensitive_data_consent_at IS NULL`), reuses the patients module's
 * import, and flips `onboarding_checklist.first_patient_added`. Authorization is
 * session-only (`auth.uid()`); the result is collapsed to a sanitized shape.
 */
export async function importOnboardingPatients(
  rows: OnboardingCsvPatientRow[],
): Promise<ImportPatientsStepResult> {
  const supabase = await createServerClient();
  const result = await importOnboardingPatientsImpl(supabase, rows);

  if (result.ok) return { ok: true, importedCount: result.importedCount };
  return { ok: false, error: result.error };
}

/**
 * Completes step 3 via the quick "add first patient" path, reusing the patients
 * create action and flipping `first_patient_added`. Authorization is session-
 * only; field/duplicate errors are surfaced to the inline form.
 */
export async function quickAddOnboardingPatient(input: {
  fullName: string;
  phone?: string;
  email?: string;
}): Promise<QuickAddPatientStepResult> {
  const supabase = await createServerClient();
  // The patients create path requires `patientType`; the wizard quick-add only
  // collects name/phone/email and defaults the type to 'individual' (the
  // standard adult-patient type — see `PATIENT_TYPES`).
  const result = await quickAddOnboardingPatientImpl(supabase, {
    fullName: input.fullName,
    patientType: 'individual',
    phone: input.phone,
    email: input.email,
  });

  if (result.ok) return { ok: true };
  if (result.error === 'invalid_input') {
    return { ok: false, error: 'invalid_input', fieldErrors: result.fieldErrors };
  }
  if (result.error === 'duplicate_phone') return { ok: false, error: 'duplicate_phone' };
  if (result.error === 'duplicate_email') return { ok: false, error: 'duplicate_email' };
  if (result.error === 'unauthenticated') return { ok: false, error: 'unauthenticated' };
  return { ok: false, error: 'unknown' };
}

/**
 * Skips step 3 without ingesting any patient data. Advances
 * `profiles.onboarding_step` to the terminal `'done'` WITHOUT flipping
 * `first_patient_added` (skipping must never mark a patient as added) and
 * WITHOUT stamping `onboarding_completed_at` (so the dashboard checklist keeps
 * nudging). This reuses {@link skipOnboardingImpl} — the same "advance to done,
 * flip nothing" primitive the welcome-screen skip uses. The client then
 * navigates forward to step 4. Authorization is session-only (`auth.uid()`).
 */
export async function skipPatientsStep(): Promise<SkipPatientsStepResult> {
  const supabase = await createServerClient();
  const result = await skipOnboardingImpl(supabase);
  return result.ok ? { ok: true } : { ok: false };
}

/**
 * Completes the wizard from step 4 ("Pronto"). Stamps
 * `onboarding_completed_at = now()` and sets `onboarding_step = 'done'`
 * server-side, authorized by `auth.uid()` only — the action takes no client
 * input, so there is no IDOR vector. RLS is the backstop on the owner-scoped
 * `profiles` UPDATE. The client navigates (to `/agenda` or `/dashboard`) after
 * a successful completion; the destination is decided client-side and never
 * influences authorization.
 */
export async function completeOnboarding(): Promise<CompleteOnboardingResult> {
  const supabase = await createServerClient();
  return completeOnboardingImpl(supabase);
}
