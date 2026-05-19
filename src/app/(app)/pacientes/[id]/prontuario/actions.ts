'use server';

// Server Actions for the Prontuario shell — hypothesis CRUD, CID-10 search,
// and treatment-plan CRUD.
// Consumed by ProntuarioTabs (client component) which passes them to
// HypothesesTab and TreatmentPlanTab.

import type {
  AttachmentCategory,
  CreateDocumentResult,
  CreateHypothesisResult,
  CreateScaleApplicationResult,
  DeleteAttachmentResult,
  FinalizeDocumentResult,
  GetAttachmentSignedUrlResult,
  GetDocumentPdfUrlResult,
  GetPersonalNotesResult,
  GetTreatmentPlanResult,
  HypothesisStatus,
  ListAttachmentsResult,
  ListDocumentsByPatientResult,
  ListHypothesesResult,
  ListScalesForPatientResult,
  ListTreatmentPlanVersionsResult,
  RemovePersonalNotesPasswordResult,
  SetPersonalNotesPasswordResult,
  SubmitScaleResponsesResult,
  UpdateDocumentResult,
  UpdateHypothesisResult,
  UpdateHypothesisStatusResult,
  UploadAttachmentResult,
  UpsertPersonalNotesResult,
  UpsertTreatmentPlanResult,
} from '@/modules/medical-records';
import {
  createDocumentImpl,
  createHypothesisImpl,
  createScaleApplicationImpl,
  deleteAttachmentImpl,
  finalizeDocumentImpl,
  getAttachmentSignedUrlImpl,
  getDocumentDetailImpl,
  getDocumentPdfUrlImpl,
  getPersonalNotesImpl,
  getTreatmentPlanImpl,
  listAttachmentsImpl,
  listDocumentsByPatientImpl,
  listHypothesesByPatientImpl,
  listScalesForPatient as listScalesForPatientImpl,
  listTreatmentPlanVersionsImpl,
  removePersonalNotesPasswordImpl,
  searchCid10Impl,
  setPersonalNotesPasswordImpl,
  submitScaleResponsesImpl,
  updateDocumentImpl,
  updateHypothesisImpl,
  updateHypothesisStatusImpl,
  uploadAttachmentImpl,
  upsertPersonalNotesImpl,
  upsertTreatmentPlanImpl,
} from '@/modules/medical-records';
import type { Cid10Result } from '@/modules/medical-records/lib/cid10-search';
import type { DocumentType } from '@/modules/medical-records/lib/schemas/clinical-documents';
import type { Goal, Phase } from '@/modules/medical-records/lib/treatment-plan-schemas';
import { createServerClient } from '@/shared/supabase/server';

export async function listHypotheses(input: {
  patientId: string;
  includeDiscarded?: boolean;
}): Promise<ListHypothesesResult> {
  const supabase = await createServerClient();
  return listHypothesesByPatientImpl(supabase, input);
}

export async function createHypothesis(input: {
  patientId: string;
  description?: string;
  cid10Code?: string;
  cid10Description?: string;
  notes?: string;
}): Promise<CreateHypothesisResult> {
  const supabase = await createServerClient();
  return createHypothesisImpl(supabase, input);
}

export async function updateHypothesis(input: {
  hypothesisId: string;
  description?: string;
  cid10Code?: string;
  cid10Description?: string;
  status?: HypothesisStatus;
  notes?: string;
}): Promise<UpdateHypothesisResult> {
  const supabase = await createServerClient();
  return updateHypothesisImpl(supabase, input);
}

export async function updateHypothesisStatus(input: {
  hypothesisId: string;
  status: HypothesisStatus;
  notes?: string;
}): Promise<UpdateHypothesisStatusResult> {
  const supabase = await createServerClient();
  return updateHypothesisStatusImpl(supabase, input);
}

export async function searchCid10(query: string): Promise<Cid10Result[]> {
  const supabase = await createServerClient();
  const result = await searchCid10Impl(supabase, { query });
  if (result.ok) {
    return result.results;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Treatment Plan
// ---------------------------------------------------------------------------

export async function getTreatmentPlan(input: {
  patientId: string;
}): Promise<GetTreatmentPlanResult> {
  const supabase = await createServerClient();
  return getTreatmentPlanImpl(supabase, input);
}

export async function upsertTreatmentPlan(input: {
  patientId: string;
  goals: Goal[];
  phases: Phase[];
  resources: string | null;
  successCriteria: string | null;
}): Promise<UpsertTreatmentPlanResult> {
  const supabase = await createServerClient();
  return upsertTreatmentPlanImpl(supabase, input);
}

export async function listTreatmentPlanVersions(input: {
  planId: string;
}): Promise<ListTreatmentPlanVersionsResult> {
  const supabase = await createServerClient();
  return listTreatmentPlanVersionsImpl(supabase, input);
}

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------

export async function listScalesForPatient(input: {
  patientId: string;
}): Promise<ListScalesForPatientResult> {
  const supabase = await createServerClient();
  return listScalesForPatientImpl(supabase, input);
}

export async function createScaleApplication(input: {
  patientId: string;
  scaleKey: string;
  mode: 'in-session' | 'remote';
  expiresInHours?: number;
}): Promise<CreateScaleApplicationResult> {
  const supabase = await createServerClient();
  return createScaleApplicationImpl(supabase, input);
}

export async function submitScaleResponses(input: {
  applicationId: string;
  responses: Record<string, number>;
}): Promise<SubmitScaleResponsesResult> {
  const supabase = await createServerClient();
  return submitScaleResponsesImpl(supabase, input);
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export async function listAttachments(input: {
  patientId: string;
  category?: AttachmentCategory;
}): Promise<ListAttachmentsResult> {
  const supabase = await createServerClient();
  return listAttachmentsImpl(supabase, input);
}

export async function uploadAttachment(
  patientId: string,
  formData: FormData,
): Promise<UploadAttachmentResult> {
  const supabase = await createServerClient();
  return uploadAttachmentImpl(supabase, patientId, formData);
}

export async function getAttachmentSignedUrl(input: {
  attachmentId: string;
}): Promise<GetAttachmentSignedUrlResult> {
  const supabase = await createServerClient();
  return getAttachmentSignedUrlImpl(supabase, input);
}

export async function deleteAttachment(input: {
  attachmentId: string;
}): Promise<DeleteAttachmentResult> {
  const supabase = await createServerClient();
  return deleteAttachmentImpl(supabase, input);
}

// ---------------------------------------------------------------------------
// Personal Notes
// ---------------------------------------------------------------------------

export async function getPersonalNotes(input: {
  patientId: string;
  password?: string;
}): Promise<GetPersonalNotesResult> {
  const supabase = await createServerClient();
  return getPersonalNotesImpl(supabase, input);
}

export async function upsertPersonalNotes(input: {
  patientId: string;
  content: string;
}): Promise<UpsertPersonalNotesResult> {
  const supabase = await createServerClient();
  return upsertPersonalNotesImpl(supabase, input);
}

export async function setPersonalNotesPassword(input: {
  patientId: string;
  newPassword: string;
}): Promise<SetPersonalNotesPasswordResult> {
  const supabase = await createServerClient();
  return setPersonalNotesPasswordImpl(supabase, input);
}

export async function removePersonalNotesPassword(input: {
  patientId: string;
  currentPassword: string;
}): Promise<RemovePersonalNotesPasswordResult> {
  const supabase = await createServerClient();
  return removePersonalNotesPasswordImpl(supabase, input);
}

// ---------------------------------------------------------------------------
// Clinical Documents
// ---------------------------------------------------------------------------

export async function createDocument(input: {
  patientId: string;
  document_type: DocumentType;
  title?: string;
  content?: Record<string, unknown>;
}): Promise<CreateDocumentResult> {
  const supabase = await createServerClient();
  return createDocumentImpl(supabase, input);
}

export async function updateDocument(input: {
  documentId: string;
  title?: string;
  content?: Record<string, unknown>;
}): Promise<UpdateDocumentResult> {
  const supabase = await createServerClient();
  return updateDocumentImpl(supabase, input);
}

export async function listDocumentsByPatient(input: {
  patientId: string;
  type?: DocumentType;
  status?: 'draft' | 'finalized';
}): Promise<ListDocumentsByPatientResult> {
  const supabase = await createServerClient();
  return listDocumentsByPatientImpl(supabase, input);
}

export async function getDocumentDetail(input: { documentId: string }) {
  const supabase = await createServerClient();
  return getDocumentDetailImpl(supabase, input);
}

export async function finalizeDocument(input: {
  documentId: string;
  cid10ConsentConfirmed?: boolean;
}): Promise<FinalizeDocumentResult> {
  const supabase = await createServerClient();
  return finalizeDocumentImpl(supabase, input);
}

export async function getDocumentPdfUrl(input: {
  documentId: string;
}): Promise<GetDocumentPdfUrlResult> {
  const supabase = await createServerClient();
  return getDocumentPdfUrlImpl(supabase, input);
}
