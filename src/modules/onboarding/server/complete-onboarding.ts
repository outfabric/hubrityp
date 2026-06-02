import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type CompleteOnboardingResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Marks the authenticated psychologist's onboarding as complete.
 *
 * Sets `profiles.onboarding_step = 'done'` and stamps
 * `onboarding_completed_at = now()` — the stamp is what tells the checklist the
 * flow finished, so it no longer nudges. Idempotent: re-running re-stamps the
 * timestamp but never moves the step backward.
 *
 * Takes no client input: there is nothing to authorize beyond the session, so
 * authorization is `auth.uid()` only (RLS is the backstop on the owner-scoped
 * UPDATE). Sanitized errors, no PII logged.
 */
export async function completeOnboardingImpl(
  supabase: SupabaseClient,
): Promise<CompleteOnboardingResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  try {
    await db
      .update(profiles)
      .set({
        onboardingStep: 'done',
        onboardingCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(profiles.userId, userId));

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'complete_onboarding_failed', userId, errorCode: pgError.code },
      'unexpected error completing onboarding',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao concluir o onboarding. Tente novamente.',
    };
  }
}
