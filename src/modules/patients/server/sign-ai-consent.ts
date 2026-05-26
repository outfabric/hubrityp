import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { consentTerms } from '@/shared/db/schema/patients/tables';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SignAiConsentResult =
  | { ok: true }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'expired' }
  | { ok: false; error: 'already_signed' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Unsigned AI consent terms expire 7 days after creation (design decision D4). */
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Produces a full SHA-256 hex digest (64 chars) of `value + salt`.
 * Used for signing metadata (IP, user-agent) to create a legally defensible
 * audit trail without storing PII.
 */
function hashWithSalt(value: string): string {
  return createHash('sha256')
    .update(value + serverEnv.SIGNATURE_HASH_SALT)
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Signs an AI consent term identified by its signature token.
 *
 * This function runs WITHOUT authentication -- the token itself is the
 * authorization credential. Unlike general consent signing, AI consent
 * signing does NOT generate a PDF or update the patient table -- it only
 * records the signing metadata on the consent_terms row.
 *
 * Flow:
 *   1. Validate token format (base64url, 43 chars).
 *   2. Look up consent_terms row by token (must be ai_recording, not revoked).
 *   3. Check expiry: created_at + 7 days must be in the future.
 *   4. Verify not already signed.
 *   5. UPDATE row with signed_at, signed_ip = sha256(ip + salt),
 *      signed_user_agent = sha256(ua + salt).
 */
export async function signAiConsentImpl(
  token: string,
  ip: string,
  userAgent: string,
): Promise<SignAiConsentResult> {
  // 1. Validate token format: must be base64url (43 chars for 32 bytes)
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return { ok: false, error: 'not_found' };
  }

  // 2. Look up consent term by token -- must be ai_recording, not revoked
  const termRows = await db
    .select({
      id: consentTerms.id,
      signedAt: consentTerms.signedAt,
      createdAt: consentTerms.createdAt,
    })
    .from(consentTerms)
    .where(
      and(
        eq(consentTerms.signatureToken, token),
        eq(consentTerms.kind, 'ai_recording'),
        isNull(consentTerms.revokedAt),
      ),
    )
    .limit(1);

  const term = termRows[0];

  if (!term) {
    return { ok: false, error: 'not_found' };
  }

  // 3. Check expiry
  const expiresAt = term.createdAt.getTime() + TOKEN_EXPIRY_MS;
  if (expiresAt < Date.now()) {
    return { ok: false, error: 'expired' };
  }

  // 4. Reject if already signed
  if (term.signedAt !== null) {
    return { ok: false, error: 'already_signed' };
  }

  // 5. Record signing metadata with SHA-256 hashed IP and user-agent
  const now = new Date();

  try {
    const updated = await db
      .update(consentTerms)
      .set({
        signedAt: now,
        signedIp: hashWithSalt(ip),
        signedUserAgent: hashWithSalt(userAgent),
      })
      .where(
        and(
          eq(consentTerms.id, term.id),
          // Optimistic concurrency: only update if still unsigned and not revoked
          isNull(consentTerms.signedAt),
          isNull(consentTerms.revokedAt),
        ),
      )
      .returning({ id: consentTerms.id });

    // If no rows were updated, another request signed or revoked concurrently
    if (updated.length === 0) {
      return { ok: false, error: 'already_signed' };
    }

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'sign_ai_consent_failed', errorCode: pgError.code },
      'unexpected error signing AI consent',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao assinar o termo. Tente novamente.',
    };
  }
}
