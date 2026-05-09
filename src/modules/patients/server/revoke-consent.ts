import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type RevokeConsentResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'patient_not_found' }
  | { ok: false; error: 'no_active_consent' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Revokes the active (signed, non-revoked) consent term for a patient.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify patient exists and belongs to the authenticated psychologist.
 *   3. Find the most recent signed, non-revoked consent term for the patient.
 *   4. Set `consent_terms.revoked_at = now()`.
 *   5. Clear `patients.consent_signed_at` to null (and set consent_revoked_at).
 *
 * Only one consent term is revoked at a time (the most recently signed one).
 * If no active consent exists, returns `no_active_consent`.
 */
export async function revokeConsentImpl(
  supabase: SupabaseClient,
  patientId: string,
): Promise<RevokeConsentResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  // 2. Verify patient exists and belongs to user (defense-in-depth + RLS)
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    return { ok: false, error: 'patient_not_found' };
  }

  // 3. Find active (signed, non-revoked) consent term
  const [activeTerm] = await db
    .select({ id: consentTerms.id })
    .from(consentTerms)
    .where(
      and(
        eq(consentTerms.patientId, patientId),
        eq(consentTerms.userId, userId),
        isNotNull(consentTerms.signedAt),
        isNull(consentTerms.revokedAt),
      ),
    )
    .limit(1);

  if (!activeTerm) {
    return { ok: false, error: 'no_active_consent' };
  }

  // 4 & 5. Revoke consent term and clear patient's consent_signed_at
  try {
    await db
      .update(consentTerms)
      .set({ revokedAt: sql`now()` })
      .where(eq(consentTerms.id, activeTerm.id));

    await db
      .update(patients)
      .set({
        consentSignedAt: null,
        consentRevokedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(patients.id, patientId), eq(patients.userId, userId)));

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'revoke_consent_failed', errorCode: pgError.code },
      'unexpected error revoking consent',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao revogar o consentimento. Tente novamente.',
    };
  }
}
