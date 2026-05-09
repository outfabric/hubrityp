import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { consentTerms, patients } from '@/shared/db/schema/patients/tables';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';

import { generateConsentPdf } from '../lib/generate-consent-pdf';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SignConsentResult =
  | { ok: true }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'already_signed' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Signs a consent term identified by its signature token.
 *
 * This function runs WITHOUT authentication — the token itself is the
 * authorization credential. It uses the service-role Supabase client for
 * Storage uploads (the bucket is private, so anon key cannot write).
 *
 * Flow:
 *   1. Look up the consent term by token (must exist, not revoked).
 *   2. Verify it has not already been signed (signed_at must be null).
 *   3. Set signed_at, signed_ip, signed_user_agent on the consent term.
 *   4. Generate a PDF of the signed consent via pdfkit.
 *   5. Upload the PDF to Supabase Storage (`consent-pdfs/{user_id}/{patient_id}/{consent_id}.pdf`).
 *   6. Set signed_pdf_path on the consent term.
 *   7. Update patient.consent_signed_at.
 */
export async function signConsentImpl(
  token: string,
  ip: string,
  userAgent: string,
): Promise<SignConsentResult> {
  // 1. Validate token format
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return { ok: false, error: 'not_found' };
  }

  // 2. Look up consent term by token — must not be revoked
  const termRows = await db
    .select({
      id: consentTerms.id,
      patientId: consentTerms.patientId,
      userId: consentTerms.userId,
      termText: consentTerms.termText,
      signedAt: consentTerms.signedAt,
    })
    .from(consentTerms)
    .where(and(eq(consentTerms.signatureToken, token), isNull(consentTerms.revokedAt)))
    .limit(1);

  const term = termRows[0];

  if (!term) {
    return { ok: false, error: 'not_found' };
  }

  // 3. Reject if already signed
  if (term.signedAt !== null) {
    return { ok: false, error: 'already_signed' };
  }

  // 4. Fetch patient name and psychologist info for PDF generation
  // Parallelized: these two queries are independent reads.
  const [patientRows, psychologistRows] = await Promise.all([
    db
      .select({ fullName: patients.fullName })
      .from(patients)
      .where(eq(patients.id, term.patientId))
      .limit(1),
    db
      .select({
        fullName: profiles.fullName,
        crpNumber: profiles.crpNumber,
        crpUf: profiles.crpUf,
      })
      .from(profiles)
      .where(eq(profiles.userId, term.userId))
      .limit(1),
  ]);

  const patient = patientRows[0];
  const psychologist = psychologistRows[0];

  if (!patient || !psychologist) {
    logger.error(
      { event: 'sign_consent_missing_data', consentId: term.id },
      'patient or psychologist not found for consent term',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Dados do termo incompletos. Contate o psicólogo.',
    };
  }

  // 5. Record signing metadata on the consent term (optimistic concurrency)
  const now = new Date();

  try {
    const updated = await db
      .update(consentTerms)
      .set({
        signedAt: now,
        signedIp: ip,
        signedUserAgent: userAgent,
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

    // 6. Generate PDF
    const pdfBuffer = await generateConsentPdf({
      termText: term.termText,
      patientName: patient.fullName,
      psychologistName: psychologist.fullName,
      psychologistCrp: `${psychologist.crpNumber}/${psychologist.crpUf}`,
      signedAt: now,
      signedIp: ip,
    });

    // 7. Upload PDF to Supabase Storage
    // TODO: The `consent-pdfs` bucket must be created in Supabase Storage
    // before the first upload. For local dev, run:
    //   supabase storage create consent-pdfs --public=false
    // For production, create it via the Supabase dashboard or deploy script.
    // The code degrades gracefully if the bucket does not exist (signing
    // succeeds, PDF path is set to null for later retry).
    const storagePath = `${term.userId}/${term.patientId}/${term.id}.pdf`;

    const supabaseAdmin = createSupabaseClient(
      serverEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    const { error: uploadError } = await supabaseAdmin.storage
      .from('consent-pdfs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      logger.error(
        {
          event: 'consent_pdf_upload_failed',
          consentId: term.id,
          uploadError: uploadError.message,
        },
        'failed to upload consent PDF to storage',
      );
      // Continue — the signing is recorded even if PDF upload fails.
      // The PDF can be regenerated later.
    }

    // 8 & 9. Set signed_pdf_path + update patient.consent_signed_at atomically
    // Wrapped in a transaction to prevent inconsistent state if one write fails.
    const pdfPath = uploadError ? null : storagePath;

    await db.transaction(async (tx) => {
      await tx
        .update(consentTerms)
        .set({ signedPdfPath: pdfPath })
        .where(eq(consentTerms.id, term.id));

      await tx
        .update(patients)
        .set({
          consentSignedAt: now,
          updatedAt: sql`now()`,
        })
        .where(eq(patients.id, term.patientId));
    });

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'sign_consent_failed', errorCode: pgError.code },
      'unexpected error signing consent',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao assinar o termo. Tente novamente.',
    };
  }
}
