import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { upsertAnamnesisSchema } from '@/modules/patients/lib/anamnesis-input-schema';
import { db } from '@/shared/db/client';
import { anamnesis } from '@/shared/db/schema/patients/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type UpsertAnamnesisResult =
  | { ok: true; anamnesisId: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'patient_not_found' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates or updates the anamnesis for a patient.
 *
 * Uses INSERT ... ON CONFLICT (patient_id) DO UPDATE SET to handle both
 * initial creation and subsequent saves (manual or auto-save) in a single
 * operation. All clinical sections are sent in one request.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input against `upsertAnamnesisSchema`.
 *   3. Verify patient exists and belongs to authenticated user.
 *   4. Upsert via Drizzle `onConflictDoUpdate` targeting patient_id.
 *   5. Return anamnesis ID on success.
 */
export async function upsertAnamnesisImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<UpsertAnamnesisResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = upsertAnamnesisSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data = parsed.data;

  // 3. Verify patient exists and belongs to user (defense-in-depth + RLS)
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, data.patientId), eq(patients.userId, user.id)))
    .limit(1);

  if (!patient) {
    return { ok: false, error: 'patient_not_found' };
  }

  // 4. Upsert via Drizzle — INSERT ON CONFLICT (patient_id) DO UPDATE
  try {
    const [row] = await db
      .insert(anamnesis)
      .values({
        patientId: data.patientId,
        chiefComplaint: data.chiefComplaint ?? null,
        historyPresentIllness: data.historyPresentIllness ?? null,
        familyHistory: data.familyHistory ?? null,
        educationalProfessional: data.educationalProfessional ?? null,
        physicalHealth: data.physicalHealth ?? null,
        priorTherapy: data.priorTherapy ?? null,
        initialHypothesis: data.initialHypothesis ?? null,
        treatmentPlan: data.treatmentPlan ?? null,
        customSections: data.customSections ?? null,
      })
      .onConflictDoUpdate({
        target: anamnesis.patientId,
        set: {
          chiefComplaint: data.chiefComplaint ?? null,
          historyPresentIllness: data.historyPresentIllness ?? null,
          familyHistory: data.familyHistory ?? null,
          educationalProfessional: data.educationalProfessional ?? null,
          physicalHealth: data.physicalHealth ?? null,
          priorTherapy: data.priorTherapy ?? null,
          initialHypothesis: data.initialHypothesis ?? null,
          treatmentPlan: data.treatmentPlan ?? null,
          customSections: data.customSections ?? null,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: anamnesis.id });

    return { ok: true, anamnesisId: row!.id };
  } catch (err: unknown) {
    const pgError = err as { code?: string; detail?: string };
    logger.error(
      { event: 'upsert_anamnesis_failed', errorCode: pgError.code },
      'unexpected error upserting anamnesis',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao salvar anamnese. Tente novamente.',
    };
  }
}
