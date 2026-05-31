import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import {
  createPatientImpl,
  type CreatePatientResult,
  importPatientsCsvImpl,
  type ImportPatientsCsvResult,
} from '@/modules/patients';
import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { onboardingChecklist } from '@/shared/db/schema/onboarding/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

// `consent_required` is the onboarding-specific gate: the psychologist has not
// accepted the LGPD sensitive-data consent term, so they MUST NOT ingest any
// patient (clinical) data yet. The UI directs them to "Configurações >
// Privacidade" to accept the term first. This is the SERVER-side gate (the
// client also disables the control, but a crafted request bypasses that).
export type ImportOnboardingPatientsResult =
  | { ok: true; importedCount: number }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'consent_required' }
  | { ok: false; error: 'validation_error'; message: string }
  | { ok: false; error: 'db_error'; message: string };

export type QuickAddOnboardingPatientResult =
  | { ok: true; patientId: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'duplicate_phone'; message: string }
  | { ok: false; error: 'duplicate_email'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Sensitive-data consent gate (RN-11.03)
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the authenticated psychologist has accepted the
 * sensitive-data consent term (`profiles.sensitive_data_consent_at IS NOT
 * NULL`). The read is owner-scoped (`WHERE user_id = <session uid>`) so it can
 * never reflect another tenant's consent state.
 *
 * The check runs against the module-level Drizzle client, mirroring the way the
 * production service-role connection writes onboarding state; ownership is
 * enforced in SQL (the `eq(profiles.userId, userId)` predicate), and RLS is the
 * backstop on user-scoped connections.
 */
async function hasSensitiveDataConsent(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ sensitiveDataConsentAt: profiles.sensitiveDataConsentAt })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  return row?.sensitiveDataConsentAt != null;
}

/**
 * Flips `onboarding_checklist.first_patient_added = TRUE` for the owner and
 * advances `profiles.onboarding_step` to the NEXT step `'done'` ABSOLUTELY
 * (idempotent). The user just COMPLETED the `patients` step (by importing or
 * quick-adding a patient), so the persisted step moves forward to `done`,
 * routing them to the terminal step 4 next (see the onboarding-wizard spec).
 * Lazily upserts the checklist row so the data-model row exists on first write.
 * Scoped to the session owner; RLS is the backstop.
 */
async function markFirstPatientAdded(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(onboardingChecklist)
      .values({ userId, firstPatientAdded: true })
      .onConflictDoUpdate({
        target: onboardingChecklist.userId,
        set: { firstPatientAdded: true, updatedAt: new Date() },
      });

    await tx
      .update(profiles)
      .set({ onboardingStep: 'done', updatedAt: new Date() })
      .where(eq(profiles.userId, userId));
  });
}

// ---------------------------------------------------------------------------
// CSV import (gated)
// ---------------------------------------------------------------------------

/**
 * Completes onboarding wizard step 3 ("Importe pacientes") via CSV import,
 * REUSING the patients module's {@link importPatientsCsvImpl}. The onboarding
 * concern this adds on top is the LGPD sensitive-data consent gate.
 *
 * Flow:
 *   1. Authenticate via `supabase.auth.getUser()` (NEVER `getSession()`).
 *   2. SERVER-side consent gate: refuse to start the import unless
 *      `profiles.sensitive_data_consent_at IS NOT NULL`. This is enforced here,
 *      not only in the UI — a crafted request that skips the disabled control
 *      is rejected with `consent_required`.
 *   3. Delegate the actual insert to the patients module (which re-validates
 *      the rows with Zod and inserts in one transaction).
 *   4. On a successful, non-empty import, flip the checklist flag and advance
 *      the step.
 *
 * Authorization is `auth.uid()` only; any client-supplied user id is ignored
 * (IDOR-safe). Errors are sanitized; no PII is logged.
 */
export async function importOnboardingPatientsImpl(
  supabase: SupabaseClient,
  rows: unknown,
): Promise<ImportOnboardingPatientsResult> {
  // 1. Authenticate.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }
  const userId = user.id;

  // 2. SERVER-side consent gate (RN-11.03). The UI disables the CSV control
  // when consent is missing, but the gate MUST also live here.
  if (!(await hasSensitiveDataConsent(userId))) {
    logger.warn(
      { event: 'onboarding_csv_import_blocked_no_consent', userId },
      'CSV patient import refused: sensitive-data consent missing',
    );
    return { ok: false, error: 'consent_required' };
  }

  // 3. Delegate to the patients module's import (auth + Zod + transactional
  // insert). It re-authenticates from the same session, so the gate above and
  // the insert authorize the SAME user.
  const result: ImportPatientsCsvResult = await importPatientsCsvImpl(supabase, rows);
  if (!result.ok) {
    return result;
  }

  // 4. Flip the checklist flag + advance the step. A failure here does not
  // undo the import (the patients already exist); surface a sanitized db_error.
  try {
    await markFirstPatientAdded(userId);
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'onboarding_csv_import_flag_failed', userId, errorCode: pgError.code },
      'patients imported but failed to flip onboarding checklist flag',
    );
    return {
      ok: false,
      error: 'db_error',
      message: 'Pacientes importados, mas houve um erro ao salvar o progresso. Tente novamente.',
    };
  }

  return { ok: true, importedCount: result.importedCount };
}

// ---------------------------------------------------------------------------
// Quick-add (single patient)
// ---------------------------------------------------------------------------

/**
 * Completes onboarding wizard step 3 via the quick "add first patient" path,
 * REUSING the patients module's {@link createPatientImpl}. Adding a single
 * patient is the lightest way to satisfy the step.
 *
 * Unlike the CSV import, the quick-add is NOT gated by the sensitive-data
 * consent term: the spec only requires the gate on CSV upload (bulk ingestion).
 * Creating one patient through the standard create path mirrors what the
 * psychologist can already do anywhere in the app, so it stays available.
 *
 * Flow mirrors the import: authenticate, delegate to the patients create path
 * (auth + Zod + ownership), then flip the checklist flag and advance the step.
 * Authorization is `auth.uid()` only (IDOR-safe); errors are sanitized.
 */
export async function quickAddOnboardingPatientImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<QuickAddOnboardingPatientResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }
  const userId = user.id;

  const created: CreatePatientResult = await createPatientImpl(supabase, input);
  if (!created.ok) {
    return created;
  }

  try {
    await markFirstPatientAdded(userId);
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'onboarding_quick_add_flag_failed', userId, errorCode: pgError.code },
      'patient created but failed to flip onboarding checklist flag',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Paciente criado, mas houve um erro ao salvar o progresso. Tente novamente.',
    };
  }

  return { ok: true, patientId: created.patientId };
}
