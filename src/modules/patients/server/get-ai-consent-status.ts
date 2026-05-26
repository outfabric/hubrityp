import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';

import {
  GetAiConsentStatusInputSchema,
  type AiConsentStatusView,
  type GetAiConsentStatusResult,
} from '../lib/ai-consent-schemas';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Unsigned AI consent terms expire 7 days after creation (design decision D4). */
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Returns the AI consent status for a patient.
 *
 * Reads the most recent `ai_recording` consent term and maps the DB row
 * to one of four UI states: `none`, `pending`, `active`, `revoked`.
 *
 * Uses the RLS-scoped client via the Drizzle `db` (defense-in-depth —
 * explicit `userId` filter in the WHERE clause catches any RLS bypass).
 */
export async function getAiConsentStatusImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<GetAiConsentStatusResult> {
  // 1. Authenticate — getUser() revalidates the JWT with GoTrue
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // 2. Validate input
  const parsed = GetAiConsentStatusInputSchema.safeParse(input);
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
    // Returns 'none' state — does not leak patient existence for another user.
    // Per the spec, another user's patient yields 'none'.
    return { ok: true, consent: { state: 'none' } };
  }

  // 4. Fetch the most recent ai_recording consent term
  const [latestTerm] = await db
    .select({
      id: consentTerms.id,
      signedAt: consentTerms.signedAt,
      revokedAt: consentTerms.revokedAt,
      signatureToken: consentTerms.signatureToken,
      templateVersion: consentTerms.templateVersion,
      revocationReason: consentTerms.revocationReason,
      createdAt: consentTerms.createdAt,
    })
    .from(consentTerms)
    .where(
      and(
        eq(consentTerms.patientId, patientId),
        eq(consentTerms.userId, userId),
        eq(consentTerms.kind, 'ai_recording'),
      ),
    )
    .orderBy(desc(consentTerms.createdAt))
    .limit(1);

  // 5. Map DB row to UI state
  if (!latestTerm) {
    return { ok: true, consent: { state: 'none' } };
  }

  const consent = mapToView(latestTerm);
  return { ok: true, consent };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapToView(row: {
  signedAt: Date | null;
  revokedAt: Date | null;
  signatureToken: string;
  templateVersion: number;
  revocationReason: string | null;
  createdAt: Date;
}): AiConsentStatusView {
  // Revoked (signed and then revoked, OR revoked before signing)
  if (row.revokedAt) {
    return {
      state: 'revoked',
      revokedAt: row.revokedAt,
      reason: row.revocationReason,
    };
  }

  // Active (signed, not revoked)
  if (row.signedAt) {
    return {
      state: 'active',
      signedAt: row.signedAt,
      templateVersion: row.templateVersion,
    };
  }

  // Pending (not signed, not revoked) — check if expired
  const expiresAt = new Date(row.createdAt.getTime() + TOKEN_EXPIRY_MS);
  if (expiresAt.getTime() < Date.now()) {
    // Expired unsigned terms are treated as 'none' — the psychologist
    // can generate a new one.
    return { state: 'none' };
  }

  return {
    state: 'pending',
    publicUrl: `/termo/${row.signatureToken}`,
    expiresAt,
    createdAt: row.createdAt,
  };
}
