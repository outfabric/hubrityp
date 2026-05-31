'use server';

import {
  saveOnboardingStepImpl,
  uploadProfilePhotoImpl,
  type WizardStep,
} from '@/modules/onboarding';
import { createServerClient } from '@/shared/supabase/server';

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
  const step: WizardStep = 'profile';
  const result = await saveOnboardingStepImpl(supabase, { step });

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
