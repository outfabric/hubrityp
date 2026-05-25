import 'server-only';

import { randomBytes } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNull } from 'drizzle-orm';

import { AI_CONSENT_TEMPLATE_V1 } from '@/modules/ai-transcription/lib/consent-template';
import { db } from '@/shared/db/client';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

import {
  GenerateAiConsentInputSchema,
  type GenerateAiConsentResult,
} from '../lib/ai-consent-schemas';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Unsigned AI consent terms expire 7 days after creation (design decision D4). */
const TOKEN_EXPIRY_DAYS = 7;
const TOKEN_EXPIRY_MS = TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Generates a new AI recording consent term for a patient.
 *
 * Flow:
 *   1. Authenticate via `supabase.auth.getUser()`.
 *   2. Validate input via Zod.
 *   3. Confirm patient exists and belongs to the authenticated psychologist
 *      (defense-in-depth — RLS would also block cross-tenant access).
 *   4. Check for an existing pending or active `ai_recording` term.
 *      If one exists, return `ALREADY_ACTIVE`.
 *   5. Generate a 32-byte token encoded as base64url (43 chars).
 *   6. INSERT `consent_terms` row with `kind='ai_recording'`.
 *   7. Return `{ ok: true, publicUrl, expiresAt }`.
 *
 * The `publicUrl` is a relative path (`/termo/{token}`). The UI or caller
 * prepends the origin if an absolute URL is needed — this keeps the action
 * independent of the deployment URL.
 */
export async function generateAiConsentTermImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<GenerateAiConsentResult> {
  // 1. Authenticate — getUser() revalidates the JWT with GoTrue
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // 2. Validate input
  const parsed = GenerateAiConsentInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { patientId } = parsed.data;

  // 3. Confirm patient ownership (defense-in-depth + RLS)
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    // Generic NOT_FOUND — does not leak whether the patient exists for another user
    return { ok: false, error: 'NOT_FOUND' };
  }

  // 4. Check for existing pending or active ai_recording term
  //    Pending: signed_at IS NULL AND revoked_at IS NULL
  //    Active:  signed_at IS NOT NULL AND revoked_at IS NULL
  const [existingTerm] = await db
    .select({ id: consentTerms.id })
    .from(consentTerms)
    .where(
      and(
        eq(consentTerms.patientId, patientId),
        eq(consentTerms.userId, userId),
        eq(consentTerms.kind, 'ai_recording'),
        isNull(consentTerms.revokedAt),
      ),
    )
    .limit(1);

  if (existingTerm) {
    return { ok: false, error: 'ALREADY_ACTIVE' };
  }

  // 5. Generate token (32 bytes → base64url, 43 chars)
  const token = randomBytes(32).toString('base64url');

  // 6. Compute expiry date
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_EXPIRY_MS);

  // 7. Insert consent_terms row
  try {
    await db.insert(consentTerms).values({
      patientId,
      userId,
      kind: 'ai_recording',
      // AI consent uses the structured template snapshot — termText is a
      // human-readable fallback derived from the template title.
      termText: AI_CONSENT_TEMPLATE_V1.title,
      templateVersion: AI_CONSENT_TEMPLATE_V1.version,
      templateSnapshot: AI_CONSENT_TEMPLATE_V1,
      signatureToken: token,
      revocationTakesEffectImmediately: true,
    });

    const publicUrl = `/termo/${token}`;

    return { ok: true, publicUrl, expiresAt };
  } catch (err: unknown) {
    const pgError = err as { code?: string; constraint?: string };

    // Handle the extremely unlikely case of a token collision
    if (pgError.code === '23505' && pgError.constraint?.includes('signature_token')) {
      logger.warn(
        { event: 'ai_consent_token_collision' },
        'AI consent signature token collision — caller should retry',
      );
      return { ok: false, error: 'INTERNAL_ERROR' };
    }

    logger.error(
      { event: 'generate_ai_consent_failed', errorCode: pgError.code },
      'unexpected error generating AI consent term',
    );
    return { ok: false, error: 'INTERNAL_ERROR' };
  }
}
