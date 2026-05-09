import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { anamnesis, patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

import { exportPatientPdfInputSchema } from '../lib/csv-import-schema';
import { generatePatientPdf } from '../lib/generate-patient-pdf';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ExportPatientPdfResult =
  | { ok: true; pdfBase64: string; fileName: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'validation_error'; message: string }
  | { ok: false; error: 'patient_not_found' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Generates a PDF export of a patient's data.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Fetch the patient (defense-in-depth + RLS scoping).
 *   3. Fetch the psychologist's profile for the header.
 *   4. Optionally fetch anamnesis if `includeClinicalData` is true.
 *   5. Generate the PDF via the pure `generatePatientPdf` helper.
 *   6. Return the PDF as a base64-encoded string (no storage).
 *
 * The caller (UI) converts the base64 string into a downloadable blob.
 */
export async function exportPatientPdfImpl(
  supabase: SupabaseClient,
  patientId: unknown,
  includeClinicalData: unknown,
): Promise<ExportPatientPdfResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input via Zod
  const parsed = exportPatientPdfInputSchema.safeParse({ patientId, includeClinicalData });
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_error',
      message: 'Parâmetros de exportação inválidos.',
    };
  }

  const { patientId: validPatientId, includeClinicalData: validIncludeClinical } = parsed.data;
  const userId = user.id;

  // 3. Fetch patient (defense-in-depth filter on userId + RLS)
  const [patient] = await db
    .select()
    .from(patients)
    .where(and(eq(patients.id, validPatientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    return { ok: false, error: 'patient_not_found' };
  }

  // 4. Fetch psychologist profile for PDF header
  const [profile] = await db
    .select({
      fullName: profiles.fullName,
      crpNumber: profiles.crpNumber,
      crpUf: profiles.crpUf,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  if (!profile) {
    logger.error(
      { event: 'export_patient_pdf_missing_profile', userId },
      'authenticated user has no profile row',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro ao exportar. Perfil profissional não encontrado.',
    };
  }

  // 5. Optionally fetch anamnesis
  let anamnesisRow = null;

  if (validIncludeClinical) {
    const [row] = await db
      .select()
      .from(anamnesis)
      .where(eq(anamnesis.patientId, validPatientId))
      .limit(1);

    anamnesisRow = row ?? null;
  }

  // 6. Generate PDF
  try {
    const pdfBuffer = await generatePatientPdf({
      psychologistName: profile.fullName,
      psychologistCrp: `${profile.crpUf}/${profile.crpNumber}`,
      fullName: patient.fullName,
      birthDate: patient.birthDate,
      approximateAge: patient.approximateAge,
      phone: patient.phone,
      email: patient.email,
      cpf: patient.cpf,
      address: patient.address,
      profession: patient.profession,
      maritalStatus: patient.maritalStatus,
      source: patient.source,
      tags: patient.tags,
      notes: patient.notes,
      status: patient.status,
      createdAt: patient.createdAt,
      anamnesis: anamnesisRow,
      includeClinicalData: validIncludeClinical,
    });

    // Sanitize patient name for file name (remove accents + special chars)
    const safeName = patient.fullName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();

    const fileName = `ficha-${safeName}.pdf`;

    return {
      ok: true,
      pdfBase64: pdfBuffer.toString('base64'),
      fileName,
    };
  } catch (err: unknown) {
    logger.error(
      {
        event: 'export_patient_pdf_failed',
        patientId: validPatientId,
        err: err instanceof Error ? { message: err.message } : 'unknown',
      },
      'unexpected error generating patient PDF',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao gerar o PDF. Tente novamente.',
    };
  }
}
