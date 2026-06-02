import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type SkipOnboardingResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Skips the guided onboarding for the authenticated psychologist.
 *
 * Advances `profiles.onboarding_step` to `'done'` WITHOUT stamping
 * `onboarding_completed_at`. The missing completion stamp is deliberate: it
 * lets the dashboard checklist keep nudging the user toward the unfinished
 * setup items later, even though the wizard itself is dismissed. Contrast with
 * {@link completeOnboardingImpl}, which stamps completion.
 *
 * No client input — authorization is `auth.uid()` only (RLS backstop on the
 * owner-scoped UPDATE). Sanitized errors, no PII logged.
 */
export async function skipOnboardingImpl(supabase: SupabaseClient): Promise<SkipOnboardingResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  try {
    // Note: `onboarding_completed_at` is intentionally NOT set here.
    await db
      .update(profiles)
      .set({ onboardingStep: 'done', updatedAt: new Date() })
      .where(eq(profiles.userId, userId));

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'skip_onboarding_failed', userId, errorCode: pgError.code },
      'unexpected error skipping onboarding',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao pular o onboarding. Tente novamente.',
    };
  }
}
