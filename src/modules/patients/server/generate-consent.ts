import 'server-only';

import { randomBytes } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { consentTerms } from '@/shared/db/schema/patients/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default consent term template used when the psychologist has not configured
 * a custom template. Section 6 will introduce a proper template management
 * system — until then this placeholder is used.
 */
const DEFAULT_CONSENT_TEMPLATE =
  'Eu, paciente abaixo identificado(a), autorizo o(a) psicólogo(a) a realizar ' +
  'o tratamento psicológico proposto, incluindo a coleta e o tratamento dos meus ' +
  'dados pessoais e dados pessoais sensíveis, nos termos da Lei Geral de Proteção ' +
  'de Dados (Lei nº 13.709/2018). Declaro que fui informado(a) sobre a natureza ' +
  'do atendimento, os procedimentos a serem realizados, a duração estimada, os ' +
  'possíveis benefícios e riscos, bem como sobre o sigilo profissional e suas ' +
  'exceções legais previstas no Código de Ética Profissional do Psicólogo.';

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
 *   3. Generate a 64-char hex token via `crypto.randomBytes(32)`.
 *   4. Fetch the consent template (default for now — custom templates in section 6).
 *   5. Insert a new `consent_terms` row with the token and template text.
 *   6. Return the consent ID and token.
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

  // 3. Generate token (256 bits of entropy -> 64-char hex string)
  const token = randomBytes(32).toString('hex');

  // 4. Use default template (custom templates will be added in section 6)
  const termText = DEFAULT_CONSENT_TEMPLATE;

  // 5. Insert consent_terms row
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
