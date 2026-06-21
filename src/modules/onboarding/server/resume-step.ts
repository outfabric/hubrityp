import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { locations } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

import type { OnboardingStep } from '../lib/branded';
import { resolveResumeStep, type WizardStep } from '../lib/wizard';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ResumeOnboardingStepResult =
  | { ok: true; resumeStep: WizardStep }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Resolves the wizard segment the authenticated psychologist should resume at,
 * DATA-AWARE: the resume point is the first **pending** step computed from BOTH
 * the persisted `profiles.onboarding_step` cursor AND the owner's real domain
 * data (onboarding-wizard spec, "Wizard is resumable").
 *
 * A step whose underlying data already exists — `full_name` set (profile), ≥1
 * location (location), ≥1 active patient (patients) — is treated as satisfied
 * and fast-forwarded, so a psychologist who configured data elsewhere
 * (Configurações) or on a reactivated account is never routed back into a step
 * they have effectively completed. The probes are the SAME existence checks the
 * dashboard recompute uses, keeping the wizard and the checklist on a single
 * source of truth (real rows, not stored flags).
 *
 * After computing the pending step we SYNCHRONIZE `profiles.onboarding_step` to
 * it idempotently (absolute write, owner-scoped) so the cursor stays a coherent
 * cache of the real progress instead of a divergent source — and only when the
 * value actually changes, to avoid a redundant write on every render.
 *
 * Security: input is irrelevant (the function takes none); authorization is
 * `auth.uid()` only — every probe and the sync write are scoped to the verified
 * owner (`db` bypasses RLS, so the explicit predicate is the tenant boundary;
 * RLS is the backstop). When the profile row has not materialized yet (signup/
 * trigger race) we fall back to the first step (`profile`) via the `welcome`
 * default. Sanitized errors, no PII logged.
 */
export async function resumeOnboardingStepImpl(
  supabase: SupabaseClient,
): Promise<ResumeOnboardingStepResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  try {
    // Read the cursor + profile probe, and the location/patient existence
    // probes, in parallel — independent owner-scoped reads, no waterfall.
    const [profileRows, locationRows, patientRows] = await Promise.all([
      db
        .select({ onboardingStep: profiles.onboardingStep, fullName: profiles.fullName })
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .limit(1),
      db
        .select({ one: sql<number>`1` })
        .from(locations)
        .where(eq(locations.userId, userId))
        .limit(1),
      db
        .select({ one: sql<number>`1` })
        .from(patients)
        .where(and(eq(patients.userId, userId), eq(patients.status, 'active')))
        .limit(1),
    ]);

    const profileRow = profileRows[0];

    // No profile row yet (signup/trigger race) → start at the beginning. The
    // DB stores `onboarding_step` as `text` with a CHECK constraint pinning it
    // to the `OnboardingStep` union, so the narrowing cast is safe.
    const cursorStep: OnboardingStep =
      (profileRow?.onboardingStep as OnboardingStep | undefined) ?? 'welcome';

    const resumeStep = resolveResumeStep(cursorStep, {
      profile: (profileRow?.fullName?.trim().length ?? 0) > 0,
      location: locationRows.length > 0,
      patients: patientRows.length > 0,
    });

    // Synchronize the cursor to the computed pending step ABSOLUTELY, owner-
    // scoped, and only when it diverges — so the persisted cursor mirrors the
    // real progress for the next render without a write on every visit.
    if (resumeStep !== cursorStep) {
      await db
        .update(profiles)
        .set({ onboardingStep: resumeStep, updatedAt: new Date() })
        .where(eq(profiles.userId, userId));
    }

    return { ok: true, resumeStep };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'resume_onboarding_step_failed', userId, errorCode: pgError.code },
      'unexpected error resolving onboarding resume step',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao retomar o onboarding. Tente novamente.',
    };
  }
}
