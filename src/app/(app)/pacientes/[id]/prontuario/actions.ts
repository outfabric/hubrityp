'use server';

// Server Actions for the Prontuario shell — hypothesis CRUD, CID-10 search,
// and treatment-plan CRUD.
// Consumed by ProntuarioTabs (client component) which passes them to
// HypothesesTab and TreatmentPlanTab.

import type {
  CreateHypothesisResult,
  CreateScaleApplicationResult,
  GetTreatmentPlanResult,
  HypothesisStatus,
  ListHypothesesResult,
  ListScalesForPatientResult,
  ListTreatmentPlanVersionsResult,
  SubmitScaleResponsesResult,
  UpdateHypothesisResult,
  UpdateHypothesisStatusResult,
  UpsertTreatmentPlanResult,
} from '@/modules/medical-records';
import {
  createHypothesisImpl,
  createScaleApplicationImpl,
  getTreatmentPlanImpl,
  listHypothesesByPatientImpl,
  listScalesForPatient as listScalesForPatientImpl,
  listTreatmentPlanVersionsImpl,
  searchCid10Impl,
  submitScaleResponsesImpl,
  updateHypothesisImpl,
  updateHypothesisStatusImpl,
  upsertTreatmentPlanImpl,
} from '@/modules/medical-records';
import type { Cid10Result } from '@/modules/medical-records/lib/cid10-search';
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
