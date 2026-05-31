import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { onboardingStepSchema } from '@/modules/onboarding/lib/schemas';
import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { onboardingChecklist } from '@/shared/db/schema/onboarding/tables';
import { logger } from '@/shared/lib/logger';

import type { OnboardingStep } from '../lib/branded';
import { isValidStep, nextStep } from '../lib/wizard';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type SaveOnboardingStepResult =
  | { ok: true; step: OnboardingStep }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Completed-step -> checklist flag mapping
// ---------------------------------------------------------------------------

// Maps the COMPLETED onboarding step to the `onboarding_checklist` boolean
// column it marks done. The shipped data-model table (see
// `src/shared/db/schema/onboarding/tables.ts`) only carries a flag for the
// `profile` step (`profile_completed`) and the `patients` step
// (`first_patient_added`). The `location` step has no dedicated boolean in the
// current schema, and the terminal `welcome`/`done` values flip nothing — so
// the map is intentionally partial and the action only upserts a flag when an
// entry exists. This keeps `saveOnboardingStep` schema-driven instead of
// hard-coding which steps own a flag.
const STEP_TO_CHECKLIST_FLAG = {
  profile: 'profileCompleted',
  patients: 'firstPatientAdded',
} as const satisfies Partial<Record<OnboardingStep, keyof typeof onboardingChecklist.$inferInsert>>;

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

interface SaveOnboardingStepInput {
  // The step the user just COMPLETED (e.g. 'profile' when finishing step 1).
  // Validated with Zod at the boundary. The impl flips this step's checklist
  // flag (when it owns one) and persists the NEXT step into
  // `profiles.onboarding_step`, so the user advances forward.
  step: unknown;
  // Any client-supplied user id is intentionally accepted in the type but
  // IGNORED at runtime: authorization comes exclusively from the session's
  // `auth.uid()`, never from this field. Closing the IDOR vector.
  userId?: unknown;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Advances the authenticated psychologist's onboarding progress by recording
 * that a step was completed.
 *
 * Server-authoritative and session-scoped per the wizard design:
 *   1. Authenticate via `supabase.auth.getUser()` (NEVER `getSession()`).
 *   2. Zod-validate the completed step at the boundary.
 *   3. Lazily upsert the owner's `onboarding_checklist` row, flipping the flag
 *      the COMPLETED step owns (when one exists).
 *   4. Set `profiles.onboarding_step` to the NEXT step ABSOLUTELY (not by
 *      increment), so concurrent re-submits from two tabs converge — the write
 *      is idempotent. The terminal step (`done`) and the pre-wizard `welcome`
 *      have no successor, so they persist unchanged.
 *
 * Persisting the NEXT step (rather than the just-completed one) is what lets
 * the page guard and `resumeOnboardingStep` route the user forward to the step
 * they should be on — see the onboarding-wizard spec, scenario "Advancing step
 * 1 … sets onboarding_step = 'location'".
 *
 * The returned `step` is the NEXT (persisted) step, not the completed one.
 *
 * Authorization is `auth.uid()` only: any `userId` in `input` is ignored, and
 * every write is scoped `WHERE user_id = <session uid>` with RLS as the
 * backstop. Errors are sanitized — callers receive a stable shape, never a
 * Postgres message or stack trace, and no PII is logged.
 */
export async function saveOnboardingStepImpl(
  supabase: SupabaseClient,
  input: SaveOnboardingStepInput,
): Promise<SaveOnboardingStepResult> {
  // 1. Authenticate — `getUser()` revalidates the JWT with GoTrue.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate the target step. `input.userId` is deliberately never read.
  const parsed = onboardingStepSchema.safeParse(input.step);
  if (!parsed.success) {
    // `onboardingStepSchema` is a primitive enum, so its errors land on
    // `formErrors` rather than per-field. Surface them under a `step` key so the
    // result shape stays a stable `Record<string, string[]>` for the caller.
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: { step: parsed.error.flatten().formErrors },
    };
  }

  const completedStep = parsed.data;
  const userId = user.id;

  // Advance to the NEXT step. `welcome` (pre-wizard) and `done` (terminal) have
  // no successor — `isValidStep` excludes `welcome`, and `nextStep('done')` is
  // null — so in those cases we persist the value unchanged (idempotent).
  const targetStep: OnboardingStep = isValidStep(completedStep)
    ? (nextStep(completedStep) ?? completedStep)
    : completedStep;

  // Partial lookup: `undefined` for completed steps that own no checklist flag.
  // Note this keys off the COMPLETED step, not the (next) target step.
  const flag: (typeof STEP_TO_CHECKLIST_FLAG)[keyof typeof STEP_TO_CHECKLIST_FLAG] | undefined =
    STEP_TO_CHECKLIST_FLAG[completedStep as keyof typeof STEP_TO_CHECKLIST_FLAG];

  try {
    await db.transaction(async (tx) => {
      // 3. Lazily upsert the checklist row, flipping the COMPLETED step's flag
      // (if any). The data-model row is created on first write, then the flag is
      // set to TRUE on conflict. When the completed step owns no flag (e.g.
      // `location`) we still ensure the row exists so the checklist nudge has
      // somewhere to hang, but flip nothing.
      if (flag) {
        await tx
          .insert(onboardingChecklist)
          .values({ userId, [flag]: true })
          .onConflictDoUpdate({
            target: onboardingChecklist.userId,
            set: { [flag]: true, updatedAt: new Date() },
          });
      } else {
        await tx
          .insert(onboardingChecklist)
          .values({ userId })
          .onConflictDoNothing({ target: onboardingChecklist.userId });
      }

      // 4. Set the NEXT step ABSOLUTELY (idempotent). Scoped to the session
      // owner.
      await tx
        .update(profiles)
        .set({ onboardingStep: targetStep, updatedAt: new Date() })
        .where(eq(profiles.userId, userId));
    });

    return { ok: true, step: targetStep };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'save_onboarding_step_failed', userId, errorCode: pgError.code },
      'unexpected error persisting onboarding step',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao salvar o progresso. Tente novamente.',
    };
  }
}
