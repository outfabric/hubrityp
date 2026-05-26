import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import type { AppDb } from '@/shared/db/client';
import { consentTerms } from '@/shared/db/schema/patients/tables';

import { createTranscriptionLogger } from './logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Discriminated union returned by `assertAiConsentActive`.
 *
 * - `ok: true` — an active, signed, non-revoked AI consent exists.
 * - `ok: false` — one of the five failure reasons applies.
 */
export type AssertAiConsentResult =
  | { ok: true; termId: string; signedAt: Date; templateVersion: number }
  | {
      ok: false;
      reason: 'never_signed' | 'pending_signature' | 'revoked' | 'expired' | 'patient_not_found';
    };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Unsigned terms expire 7 days after creation (design decision D4). */
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Dependencies (injection for testability)
// ---------------------------------------------------------------------------

export interface AssertAiConsentDeps {
  db: Pick<AppDb, 'select'>;
  /** Defaults to `Date.now()`; tests can override for determinism. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Single authority for "is AI recording allowed for this patient?".
 *
 * Executes exactly one Drizzle query: SELECT the most recent `ai_recording`
 * consent term for the given user+patient pair, ordered by `created_at DESC
 * LIMIT 1`, and maps the row to one of the five outcome states.
 *
 * This helper lives in the `ai-transcription` module (consumer) to avoid
 * circular deps with `patients` (producer) — see design.md D3.
 *
 * LGPD: logs only IDs and timestamps, never patient name, token, or reason.
 */
export async function assertAiConsentActive(
  input: { userId: string; patientId: string },
  deps: AssertAiConsentDeps,
): Promise<AssertAiConsentResult> {
  const log = createTranscriptionLogger({ userId: input.userId });
  const now = deps.now?.() ?? Date.now();

  const rows = await deps.db
    .select({
      id: consentTerms.id,
      signedAt: consentTerms.signedAt,
      revokedAt: consentTerms.revokedAt,
      templateVersion: consentTerms.templateVersion,
      createdAt: consentTerms.createdAt,
    })
    .from(consentTerms)
    .where(
      and(
        eq(consentTerms.userId, input.userId),
        eq(consentTerms.patientId, input.patientId),
        eq(consentTerms.kind, 'ai_recording'),
      ),
    )
    .orderBy(desc(consentTerms.createdAt))
    .limit(1);

  const row = rows[0];

  if (!row) {
    log.debug({ event: 'consent_check', patientId: input.patientId, result: 'never_signed' });
    return { ok: false, reason: 'never_signed' };
  }

  // Signed and then revoked
  if (row.signedAt && row.revokedAt) {
    log.debug({
      event: 'consent_check',
      patientId: input.patientId,
      termId: row.id,
      result: 'revoked',
    });
    return { ok: false, reason: 'revoked' };
  }

  // Not yet signed
  if (!row.signedAt) {
    // Check if the unsigned term has expired (created_at + 7 days < now)
    const expiresAt = row.createdAt.getTime() + TOKEN_EXPIRY_MS;
    if (expiresAt < now) {
      log.debug({
        event: 'consent_check',
        patientId: input.patientId,
        termId: row.id,
        result: 'expired',
      });
      return { ok: false, reason: 'expired' };
    }

    log.debug({
      event: 'consent_check',
      patientId: input.patientId,
      termId: row.id,
      result: 'pending_signature',
    });
    return { ok: false, reason: 'pending_signature' };
  }

  // Signed and not revoked → active
  log.debug({
    event: 'consent_check',
    patientId: input.patientId,
    termId: row.id,
    result: 'ok',
    signedAt: row.signedAt,
  });
  return {
    ok: true,
    termId: row.id,
    signedAt: row.signedAt,
    templateVersion: row.templateVersion,
  };
}
