import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { createGuardianSchema } from '@/modules/patients/lib/guardian-input-schema';
import { formatPhone } from '@/modules/patients/lib/patient-validators';
import { db } from '@/shared/db/client';
import { patientGuardians, patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type AddGuardianResult =
  | { ok: true; guardianId: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'validation_error'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'patient_not_found' }
  | { ok: false; error: 'not_minor_patient'; message: string }
  | { ok: false; error: 'limit_reached'; message: string }
  | { ok: false; error: 'internal_error'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a new guardian for a minor patient.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input against `createGuardianSchema`.
 *   3. Verify patient exists and belongs to the authenticated user.
 *   4. Verify patient is a minor (patient_type = 'child' or 'adolescent').
 *   5. Check guardian count limit (max 2 per patient).
 *   6. If this is the first guardian, force `is_primary = true`.
 *   7. Insert via Drizzle.
 */
export async function addGuardianImpl(
  supabase: SupabaseClient,
  patientId: string,
  input: unknown,
): Promise<AddGuardianResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = createGuardianSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_error',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data = parsed.data;
  const userId = user.id;

  // 3. Verify patient exists and belongs to user
  const [patient] = await db
    .select({ id: patients.id, patientType: patients.patientType })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    return { ok: false, error: 'patient_not_found' };
  }

  // 4. Verify patient is a minor
  if (patient.patientType !== 'child' && patient.patientType !== 'adolescent') {
    return {
      ok: false,
      error: 'not_minor_patient',
      message: 'Responsáveis só podem ser adicionados a pacientes do tipo criança ou adolescente.',
    };
  }

  // 5. Check guardian count limit (max 2)
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(patientGuardians)
    .where(eq(patientGuardians.patientId, patientId));

  const currentCount = countResult?.count ?? 0;
  if (currentCount >= 2) {
    return {
      ok: false,
      error: 'limit_reached',
      message: 'Cada paciente pode ter no máximo 2 responsáveis.',
    };
  }

  // 6. Determine is_primary: first guardian is always primary
  const isPrimary = currentCount === 0 ? true : data.isPrimary;

  // Normalize phone
  const normalizedPhone = formatPhone(data.phone);

  // 7. Insert via Drizzle
  try {
    const [inserted] = await db
      .insert(patientGuardians)
      .values({
        patientId,
        fullName: data.fullName,
        relationship: data.relationship,
        phone: normalizedPhone,
        cpf: data.cpf && data.cpf.trim() !== '' ? data.cpf.trim() : null,
        email: data.email && data.email.trim() !== '' ? data.email.trim() : null,
        isPrimary,
      })
      .returning({ id: patientGuardians.id });

    return { ok: true, guardianId: inserted!.id };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'add_guardian_failed', errorCode: pgError.code },
      'unexpected error inserting guardian',
    );
    return {
      ok: false,
      error: 'internal_error',
      message: 'Erro inesperado ao adicionar responsável. Tente novamente.',
    };
  }
}
