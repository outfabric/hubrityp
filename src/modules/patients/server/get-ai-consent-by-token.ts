import 'server-only';

import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type AiConsentByTokenData = {
  consentId: string;
  patientName: string;
  psychologistName: string;
  psychologistCrp: string;
  /** Raw JSONB snapshot of the template at generation time. */
  templateSnapshot: unknown;
  /** Whether the term has already been signed. */
  alreadySigned: boolean;
  /** Whether the unsigned term has expired (created_at + 7 days < now). */
  expired: boolean;
};

export type GetAiConsentByTokenResult =
  | { ok: true; data: AiConsentByTokenData }
  | { ok: false; error: 'not_found' };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Unsigned AI consent terms expire 7 days after creation (design decision D4). */
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Looks up an AI consent term by its signature token for the public signing page.
 *
 * This function runs WITHOUT authentication -- the token itself is the
 * authorization credential (256 bits of entropy, base64url encoded). It uses
 * the Drizzle app-level `db` client which bypasses RLS (justified: the public
 * signing endpoint is token-gated, not session-gated, and needs cross-tenant
 * access to look up the term).
 *
 * Returns the template snapshot, patient/psychologist info, and status flags.
 * Returns `not_found` for invalid tokens, revoked terms, or non-ai_recording kinds.
 */
export async function getAiConsentByTokenImpl(token: string): Promise<GetAiConsentByTokenResult> {
  // Validate token format: must be a base64url string (43 chars for 32 bytes)
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return { ok: false, error: 'not_found' };
  }

  const rows = await db
    .select({
      consentId: consentTerms.id,
      signedAt: consentTerms.signedAt,
      revokedAt: consentTerms.revokedAt,
      createdAt: consentTerms.createdAt,
      templateSnapshot: consentTerms.templateSnapshot,
      kind: consentTerms.kind,
      patientName: patients.fullName,
      psychologistName: profiles.fullName,
      psychologistCrpNumber: profiles.crpNumber,
      psychologistCrpUf: profiles.crpUf,
    })
    .from(consentTerms)
    .innerJoin(patients, eq(patients.id, consentTerms.patientId))
    .innerJoin(profiles, eq(profiles.userId, consentTerms.userId))
    .where(and(eq(consentTerms.signatureToken, token), eq(consentTerms.kind, 'ai_recording')))
    .limit(1);

  const row = rows[0];

  if (!row) {
    return { ok: false, error: 'not_found' };
  }

  // Revoked consent terms are not accessible via the public page
  if (row.revokedAt) {
    return { ok: false, error: 'not_found' };
  }

  // Compute expiry from created_at + 7 days
  const expired = !row.signedAt && row.createdAt.getTime() + TOKEN_EXPIRY_MS < Date.now();

  return {
    ok: true,
    data: {
      consentId: row.consentId,
      patientName: row.patientName,
      psychologistName: row.psychologistName,
      psychologistCrp: `${row.psychologistCrpNumber}/${row.psychologistCrpUf}`,
      templateSnapshot: row.templateSnapshot,
      alreadySigned: row.signedAt !== null,
      expired,
    },
  };
}
