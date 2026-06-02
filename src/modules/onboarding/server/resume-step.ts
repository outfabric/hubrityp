import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { logger } from '@/shared/lib/logger';

import type { OnboardingStep } from '../lib/branded';
import { resumeStepFromOnboardingStep, type WizardStep } from '../lib/wizard';

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
 * Resolves the wizard segment the authenticated psychologist should resume at.
 *
 * Reads the owner's persisted `profiles.onboarding_step` server-side and maps
 * it to a navigable wizard step via the pure {@link resumeStepFromOnboardingStep}
 * rule. Resume position derives EXCLUSIVELY from the persisted column, never
 * from a client cookie or query param, so a tampered client cannot jump the
 * flow.
 *
 * When the profile row has not materialized yet (race between signup and the
 * `handle_new_user()` trigger), we fall back to the first step (`profile`) via
 * the `welcome` default — treating the brand-new user as "start at the
 * beginning". No client input — authorization is `auth.uid()` only (RLS
 * backstop on the owner-scoped SELECT). Sanitized errors, no PII logged.
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
    const [row] = await db
      .select({ onboardingStep: profiles.onboardingStep })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);

    // No profile row yet (signup/trigger race) → start at the beginning. The
    // DB stores `onboarding_step` as `text` with a CHECK constraint pinning it
    // to the `OnboardingStep` union, so the narrowing cast is safe.
    const step: OnboardingStep = (row?.onboardingStep as OnboardingStep | undefined) ?? 'welcome';

    return { ok: true, resumeStep: resumeStepFromOnboardingStep(step) };
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
