'use server';

// Thin route shell for single-patient Server Actions.
//
// The actual implementations live in `src/modules/patients/server/` (re-exported
// from `@/modules/patients`). This file MUST stay thin and carry the
// `'use server'` directive — that is what marks it as a Server Action entry
// point for the Next.js compiler. Every export of a `'use server'` file MUST
// be an async function; types cannot be re-exported from here.

import { revalidatePath } from 'next/cache';

import type {
  ConfirmAudioUploadResult,
  RequestAudioUploadUrlResult,
} from '@/modules/ai-transcription';
import { confirmAudioUploadImpl, requestAudioUploadUrlImpl } from '@/modules/ai-transcription';
import type {
  AddGuardianResult,
  ArchivePatientResult,
  DeletePatientResult,
  ExportPatientPdfResult,
  GenerateAiConsentResult,
  GenerateConsentResult,
  GetAiConsentStatusResult,
  GetPatientPhotoUrlResult,
  GetPatientResult,
  ListGuardiansResult,
  RemoveGuardianResult,
  RevokeAiConsentResult,
  RevokeConsentResult,
  UnarchivePatientResult,
  UnlinkCoupleResult,
  UpdateGuardianResult,
  UpdatePatientResult,
  UpsertAnamnesisResult,
} from '@/modules/patients';
import {
  addGuardianImpl,
  archivePatientImpl,
  deletePatientImpl,
  exportPatientPdfImpl,
  generateAiConsentTermImpl,
  generateConsentImpl,
  getAiConsentStatusImpl,
  getPatientImpl,
  getPatientPhotoUrlImpl,
  listGuardiansImpl,
  removeGuardianImpl,
  revokeAiConsentTermImpl,
  revokeConsentImpl,
  unarchivePatientImpl,
  unlinkCoupleImpl,
  updateGuardianImpl,
  updatePatientImpl,
  upsertAnamnesisImpl,
} from '@/modules/patients';
import type { SessionHistoryResult, SessionHistoryStatus } from '@/modules/sessions';
import { getPatientSessionHistoryImpl } from '@/modules/sessions/server';
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
  const result = await archivePatientImpl(supabase, patientId);

  if (result.ok) {
    // Status changed to 'archived' — invalidate both the listing (active/archived
    // filters re-query) and this patient's detail route so a cross-navigation
    // after archiving reflects the new status (design D3). The client-side
    // router.refresh() in the header only covers the in-place view; revalidatePath
    // fixes the cross-route staleness router.refresh() cannot.
    revalidatePath('/pacientes');
    revalidatePath(`/pacientes/${patientId}`, 'page');
  }

  return result;
}

export async function unarchivePatient(patientId: string): Promise<UnarchivePatientResult> {
  const supabase = await createServerClient();
  const result = await unarchivePatientImpl(supabase, patientId);

  if (result.ok) {
    // Status changed back to 'active' — same cross-route invalidation as
    // archivePatient so the listing and detail reflect the restored patient
    // after navigation (design D3).
    revalidatePath('/pacientes');
    revalidatePath(`/pacientes/${patientId}`, 'page');
  }

  return result;
}

export async function deletePatient(patientId: string): Promise<DeletePatientResult> {
  const supabase = await createServerClient();
  const result = await deletePatientImpl(supabase, patientId);

  if (result.ok) {
    // Patient row removed — invalidate the listing so the deleted patient no
    // longer appears after navigation (design D3). No detail-route revalidation:
    // the detail page is gone and the caller navigates away.
    revalidatePath('/pacientes');
  }

  return result;
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

export async function upsertAnamnesis(input: unknown): Promise<UpsertAnamnesisResult> {
  const supabase = await createServerClient();
  return upsertAnamnesisImpl(supabase, input);
}

export async function generateConsent(patientId: string): Promise<GenerateConsentResult> {
  const supabase = await createServerClient();
  return generateConsentImpl(supabase, patientId);
}

export async function revokeConsent(patientId: string): Promise<RevokeConsentResult> {
  const supabase = await createServerClient();
  return revokeConsentImpl(supabase, patientId);
}

export async function exportPatientPdf(
  patientId: string,
  includeClinicalData: boolean,
): Promise<ExportPatientPdfResult> {
  const supabase = await createServerClient();
  return exportPatientPdfImpl(supabase, patientId, includeClinicalData);
}

// ---------------------------------------------------------------------------
// AI Consent Server Actions
// ---------------------------------------------------------------------------

export async function getAiConsentStatus(patientId: string): Promise<GetAiConsentStatusResult> {
  const supabase = await createServerClient();
  return getAiConsentStatusImpl(supabase, { patientId });
}

export async function generateAiConsent(patientId: string): Promise<GenerateAiConsentResult> {
  const supabase = await createServerClient();
  return generateAiConsentTermImpl(supabase, { patientId });
}

export async function revokeAiConsent(
  patientId: string,
  reason: string | null,
): Promise<RevokeAiConsentResult> {
  const supabase = await createServerClient();
  return revokeAiConsentTermImpl(supabase, { patientId, reason });
}

// ---------------------------------------------------------------------------
// Audio Upload Server Actions
// ---------------------------------------------------------------------------

export async function requestAudioUploadUrl(input: {
  patientId: string;
  sessionId: string | null;
  contentType: string;
  sizeBytes: number;
}): Promise<RequestAudioUploadUrlResult> {
  const supabase = await createServerClient();
  return requestAudioUploadUrlImpl(supabase, input);
}

export async function confirmAudioUpload(input: {
  transcriptionId: string;
  audioDurationSeconds: number | null;
}): Promise<ConfirmAudioUploadResult> {
  const supabase = await createServerClient();
  return confirmAudioUploadImpl(supabase, input);
}

// ---------------------------------------------------------------------------
// Patient Session-History Server Action (D2)
// ---------------------------------------------------------------------------

/**
 * Single read entrypoint for the patient session-history tab. The RLS-scoped
 * Supabase client is created from request cookies here (at the call site) and
 * passed to the impl, which authenticates via `getUser()` and owner-scopes
 * every query on the verified session. An initial open (no cursor) returns the
 * summary, the nearest-future session, and the first page; a load-more (cursor
 * present) returns only the next page.
 */
export async function getPatientSessionHistory(input: {
  patientId: string;
  cursor?: string;
  status?: SessionHistoryStatus;
  limit?: number;
}): Promise<SessionHistoryResult> {
  // The impl Zod-validates `input` at the boundary, so the loose client-facing
  // shape (raw `patientId` string, not the branded `PatientId`) is intentional.
  const supabase = await createServerClient();
  return getPatientSessionHistoryImpl(supabase, input);
}
