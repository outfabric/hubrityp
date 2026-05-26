import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';

import { inngest } from '@/modules/ai-transcription/inngest/client';
import {
  AI_TRANSCRIPTION_EVENTS,
  consentRevokedEventSchema,
} from '@/modules/ai-transcription/inngest/events';
import { db } from '@/shared/db/client';
import { consentTerms } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

import { RevokeAiConsentInputSchema, type RevokeAiConsentResult } from '../lib/ai-consent-schemas';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Revokes the active (signed, non-revoked) AI consent term for a patient.
 *
 * Flow:
 *   1. Authenticate via `supabase.auth.getUser()`.
 *   2. Validate input via Zod.
 *   3. Find the active `ai_recording` term (signed_at IS NOT NULL, revoked_at IS NULL).
 *   4. UPDATE `revoked_at = now()`, `revocation_reason = reason`.
 *   5. Fire-and-forget Inngest event `ai-transcription/consent.revoked`.
 *      If inngest.send fails, the DB update is still committed and the user
 *      receives `ok: true`. The error is logged without PII.
 *   6. Return `{ ok: true }`.
 */
export async function revokeAiConsentTermImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<RevokeAiConsentResult> {
  // 1. Authenticate — getUser() revalidates the JWT with GoTrue
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // 2. Validate input
  const parsed = RevokeAiConsentInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { patientId, reason } = parsed.data;

  // 3. Find active ai_recording term (signed + not revoked)
  // The WHERE includes userId for defense-in-depth — even though RLS
  // would block cross-tenant access, we want explicit ownership check.
  const [activeTerm] = await db
    .select({ id: consentTerms.id })
    .from(consentTerms)
    .where(
      and(
        eq(consentTerms.patientId, patientId),
        eq(consentTerms.userId, userId),
        eq(consentTerms.kind, 'ai_recording'),
        isNotNull(consentTerms.signedAt),
        isNull(consentTerms.revokedAt),
      ),
    )
    .limit(1);

  if (!activeTerm) {
    return { ok: false, error: 'NOT_FOUND' };
  }

  // 4. Revoke the term
  try {
    const revokedAt = new Date();

    await db
      .update(consentTerms)
      .set({
        revokedAt: sql`now()`,
        revocationReason: reason,
      })
      .where(eq(consentTerms.id, activeTerm.id));

    // 5. Fire-and-forget Inngest event
    try {
      const payload = consentRevokedEventSchema.parse({
        termId: activeTerm.id,
        userId,
        patientId,
        revokedAt,
        reason,
      });

      await inngest.send({
        name: AI_TRANSCRIPTION_EVENTS.CONSENT_REVOKED,
        data: payload,
      });
    } catch (inngestErr: unknown) {
      // Log without PII — only the event name and a sanitized error message
      const errMsg = inngestErr instanceof Error ? inngestErr.message : 'unknown';
      logger.error(
        {
          event: 'inngest_send_failed',
          eventName: AI_TRANSCRIPTION_EVENTS.CONSENT_REVOKED,
          termId: activeTerm.id,
          error: errMsg,
        },
        'failed to send ai-transcription/consent.revoked event',
      );
    }

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'revoke_ai_consent_failed', errorCode: pgError.code },
      'unexpected error revoking AI consent',
    );
    return { ok: false, error: 'INTERNAL_ERROR' };
  }
}
