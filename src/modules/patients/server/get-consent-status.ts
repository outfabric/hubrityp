import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ConsentStatus = 'pending' | 'signed' | 'revoked';

export type ConsentStatusInfo = {
  status: ConsentStatus;
  signedAt: Date | null;
  revokedAt: Date | null;
  signedPdfPath: string | null;
  consentId: string | null;
  token: string | null;
};

export type GetConsentStatusResult =
  | { ok: true; consent: ConsentStatusInfo }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'patient_not_found' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Returns the consent status for a patient.
 *
 * Status logic:
 *   - "signed": patient has `consent_signed_at` set (active, non-revoked consent)
 *   - "revoked": most recent consent term has `revoked_at` set
 *   - "pending": no consent terms exist, or all are revoked with no active signing
 *
 * The function returns the most recent consent term's metadata regardless of
 * status, so the UI can show signing date, PDF link, or revocation date.
 */
export async function getConsentStatusImpl(
  supabase: SupabaseClient,
  patientId: string,
): Promise<GetConsentStatusResult> {
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
    .select({
      id: patients.id,
      consentSignedAt: patients.consentSignedAt,
    })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    return { ok: false, error: 'patient_not_found' };
  }

  // 3. Fetch the most recent consent term for this patient
  const [latestTerm] = await db
    .select({
      id: consentTerms.id,
      signedAt: consentTerms.signedAt,
      revokedAt: consentTerms.revokedAt,
      signedPdfPath: consentTerms.signedPdfPath,
      signatureToken: consentTerms.signatureToken,
    })
    .from(consentTerms)
    .where(and(eq(consentTerms.patientId, patientId), eq(consentTerms.userId, userId)))
    .orderBy(desc(consentTerms.createdAt))
    .limit(1);

  // 4. Determine status
  if (!latestTerm) {
    // No consent terms exist at all
    return {
      ok: true,
      consent: {
        status: 'pending',
        signedAt: null,
        revokedAt: null,
        signedPdfPath: null,
        consentId: null,
        token: null,
      },
    };
  }

  // If the patient has consent_signed_at set, the consent is active
  if (patient.consentSignedAt) {
    return {
      ok: true,
      consent: {
        status: 'signed',
        signedAt: latestTerm.signedAt,
        revokedAt: null,
        signedPdfPath: latestTerm.signedPdfPath,
        consentId: latestTerm.id,
        token: latestTerm.signatureToken,
      },
    };
  }

  // If the latest term was revoked, status is "revoked".
  // Token is intentionally null — a revoked token must not be shared.
  if (latestTerm.revokedAt) {
    return {
      ok: true,
      consent: {
        status: 'revoked',
        signedAt: latestTerm.signedAt,
        revokedAt: latestTerm.revokedAt,
        signedPdfPath: latestTerm.signedPdfPath,
        consentId: latestTerm.id,
        token: null,
      },
    };
  }

  // Term exists but not yet signed — still pending
  return {
    ok: true,
    consent: {
      status: 'pending',
      signedAt: null,
      revokedAt: null,
      signedPdfPath: null,
      consentId: latestTerm.id,
      token: latestTerm.signatureToken,
    },
  };
}
