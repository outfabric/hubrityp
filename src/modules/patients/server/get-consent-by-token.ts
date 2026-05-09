import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ConsentByTokenData = {
  consentId: string;
  termText: string;
  patientName: string;
  psychologistName: string;
  psychologistCrp: string;
  /** Whether the consent has already been signed. */
  alreadySigned: boolean;
};

export type GetConsentByTokenResult =
  | { ok: true; data: ConsentByTokenData }
  | { ok: false; error: 'not_found' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Looks up a consent term by its signature token for the public signing page.
 *
 * This function runs WITHOUT authentication — the token itself is the
 * authorization credential (256 bits of entropy). It uses Drizzle's app-level
 * `db` client which bypasses RLS (the integration test environment runs as
 * superuser; in production, the connection string is the service-role pool).
 *
 * Returns the term text, patient name, psychologist name/CRP, and whether the
 * consent has already been signed. Returns `not_found` if the token does not
 * match any row or the consent has been revoked.
 */
export async function getConsentByTokenImpl(token: string): Promise<GetConsentByTokenResult> {
  // Validate token format: must be exactly 64 hex characters
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return { ok: false, error: 'not_found' };
  }

  // Single query with joins to patients and profiles
  const rows = await db
    .select({
      consentId: consentTerms.id,
      termText: consentTerms.termText,
      signedAt: consentTerms.signedAt,
      revokedAt: consentTerms.revokedAt,
      patientName: patients.fullName,
      psychologistName: profiles.fullName,
      psychologistCrpNumber: profiles.crpNumber,
      psychologistCrpUf: profiles.crpUf,
    })
    .from(consentTerms)
    .innerJoin(patients, eq(patients.id, consentTerms.patientId))
    .innerJoin(profiles, eq(profiles.userId, consentTerms.userId))
    .where(eq(consentTerms.signatureToken, token))
    .limit(1);

  const row = rows[0];

  // Token not found
  if (!row) {
    return { ok: false, error: 'not_found' };
  }

  // Revoked consent terms are not accessible via the public page
  if (row.revokedAt) {
    return { ok: false, error: 'not_found' };
  }

  return {
    ok: true,
    data: {
      consentId: row.consentId,
      termText: row.termText,
      patientName: row.patientName,
      psychologistName: row.psychologistName,
      psychologistCrp: `${row.psychologistCrpNumber}/${row.psychologistCrpUf}`,
      alreadySigned: row.signedAt !== null,
    },
  };
}
