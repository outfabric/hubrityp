import 'server-only';

import { randomBytes } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

import { getDefaultConsentTemplate } from '../lib/default-consent-template';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type GenerateConsentResult =
  | { ok: true; consentId: string; token: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'patient_not_found' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Generates a new consent term for a patient.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify patient exists and belongs to the authenticated psychologist.
 *   3. Fetch the psychologist profile for template interpolation.
 *   4. Generate a 64-char hex token via `crypto.randomBytes(32)`.
 *   5. Build the term text from the default consent template.
 *   6. Insert a new `consent_terms` row with the token and template text.
 *   7. Return the consent ID and token.
 *
 * The caller (UI) constructs the public signing link from the token
 * (e.g., `/termo/{token}`). This keeps the server action independent of
 * the deployment URL.
 */
export async function generateConsentImpl(
  supabase: SupabaseClient,
  patientId: string,
): Promise<GenerateConsentResult> {
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

  // 3. Fetch psychologist profile for template interpolation
  const [profile] = await db
    .select({
      fullName: profiles.fullName,
      crpNumber: profiles.crpNumber,
      crpUf: profiles.crpUf,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  // This should never happen — a valid session always has a profile row.
  // Defensive guard for data integrity.
  if (!profile) {
    logger.error(
      { event: 'generate_consent_missing_profile', userId },
      'authenticated user has no profile row',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro ao gerar o termo. Perfil profissional não encontrado.',
    };
  }

  // 4. Generate token (256 bits of entropy -> 64-char hex string)
  const token = randomBytes(32).toString('hex');

  // 5. Build term text from the default template (custom templates in a future iteration)
  const termText = getDefaultConsentTemplate({
    psychologistName: profile.fullName,
    psychologistCrp: `${profile.crpNumber}/${profile.crpUf}`,
  });

  // 6. Insert consent_terms row
  try {
    const [inserted] = await db
      .insert(consentTerms)
      .values({
        patientId,
        userId,
        termText,
        signatureToken: token,
      })
      .returning({ id: consentTerms.id });

    return { ok: true, consentId: inserted!.id, token };
  } catch (err: unknown) {
    const pgError = err as { code?: string; constraint?: string };

    // Handle the extremely unlikely case of a token collision
    if (pgError.code === '23505' && pgError.constraint?.includes('signature_token')) {
      logger.warn(
        { event: 'consent_token_collision' },
        'signature token collision detected — caller should retry',
      );
      return {
        ok: false,
        error: 'unknown',
        message: 'Erro ao gerar o termo. Tente novamente.',
      };
    }

    logger.error(
      { event: 'generate_consent_failed', errorCode: pgError.code },
      'unexpected error generating consent term',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao gerar o termo de consentimento. Tente novamente.',
    };
  }
}
