import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/shared/lib/logger';

/**
 * The three MVP setup items projected from the owner's `onboarding_checklist`
 * row for the step-4 ("Pronto") summary. A missing row means the user has not
 * completed any item yet, so every flag defaults to `false`.
 */
export interface OnboardingChecklistSummary {
  profileCompleted: boolean;
  locationConfigured: boolean;
  firstPatientAdded: boolean;
}

/**
 * Reads the authenticated psychologist's onboarding checklist summary through
 * the request's RLS-scoped Supabase client.
 *
 * Unlike {@link getOnboardingChecklist} (which takes a Drizzle client and is
 * documented to require an RLS-scoped one), this helper queries via the
 * Supabase JS client, which carries the caller's session cookies and is
 * enforced by Postgres RLS at the row level — `auth.uid()` is the only thing
 * that can widen the result set, so a row that is not the caller's can never be
 * returned. The query selects ONLY the three boolean summary columns; no PII is
 * read or logged.
 *
 * Returns all-`false` when there is no checklist row yet (the lazy upsert means
 * a brand-new user has none) and, defensively, when the read errors — the step-4
 * summary is non-blocking ("Configurar agora" links), so it must never crash the
 * terminal screen.
 */
export async function readOnboardingChecklistSummary(
  supabase: SupabaseClient,
): Promise<OnboardingChecklistSummary> {
  const empty: OnboardingChecklistSummary = {
    profileCompleted: false,
    locationConfigured: false,
    firstPatientAdded: false,
  };

  // The Supabase client here is untyped (no generated DB types), so `data` is
  // `any`. Pin the selected columns to a narrow row shape so the projection is
  // type-safe instead of leaking `any` into the result.
  interface ChecklistRow {
    profile_completed: boolean | null;
    location_configured: boolean | null;
    first_patient_added: boolean | null;
  }

  const { data, error } = await supabase
    .from('onboarding_checklist')
    .select('profile_completed, location_configured, first_patient_added')
    .maybeSingle<ChecklistRow>();

  if (error) {
    logger.error(
      { event: 'read_onboarding_checklist_summary_failed', errorCode: error.code },
      'failed to read onboarding checklist summary',
    );
    return empty;
  }

  if (!data) {
    return empty;
  }

  return {
    profileCompleted: data.profile_completed ?? false,
    locationConfigured: data.location_configured ?? false,
    firstPatientAdded: data.first_patient_added ?? false,
  };
}
