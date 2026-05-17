'use server';

// Server Actions for the Prontuario shell — hypothesis CRUD and CID-10 search.
// Consumed by ProntuarioTabs (client component) which passes them to HypothesesTab.

import type {
  CreateHypothesisResult,
  HypothesisStatus,
  ListHypothesesResult,
  UpdateHypothesisResult,
  UpdateHypothesisStatusResult,
} from '@/modules/medical-records';
import {
  createHypothesisImpl,
  listHypothesesByPatientImpl,
  searchCid10Impl,
  updateHypothesisImpl,
  updateHypothesisStatusImpl,
} from '@/modules/medical-records';
import type { Cid10Result } from '@/modules/medical-records/lib/cid10-search';
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
