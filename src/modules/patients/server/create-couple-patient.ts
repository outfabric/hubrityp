import 'server-only';

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createPatientSchema } from '@/modules/patients/lib/patient-input-schema';
import type { CreatePatientInput } from '@/modules/patients/lib/patient-types';
import { formatPhone } from '@/modules/patients/lib/patient-validators';
import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Each partner's data follows the same shape as a regular patient creation,
 * but `patientType` is forced to `"couple"` server-side (ignored if provided
 * by the client).
 */
type PartnerInput = Omit<CreatePatientInput, 'patientType'>;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CreateCouplePatientResult =
  | { ok: true; patientAId: string; patientBId: string; coupleId: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input_a'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'invalid_input_b'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInsertValues(userId: string, data: CreatePatientInput, coupleId: string) {
  const normalizedPhone = data.phone ? formatPhone(data.phone) : null;
  const normalizedEmail = data.email && data.email.trim() !== '' ? data.email.trim() : null;

  return {
    userId,
    fullName: data.fullName,
    patientType: 'couple' as const,
    coupleId,
    birthDate: data.birthDate ?? null,
    approximateAge: data.approximateAge ?? null,
    gender: data.gender ?? null,
    phone: normalizedPhone,
    email: normalizedEmail,
    cpf: data.cpf ?? null,
    address: data.address ? JSON.stringify(data.address) : null,
    profession: data.profession ?? null,
    maritalStatus: data.maritalStatus ?? null,
    source: data.source ?? null,
    tags: data.tags ?? [],
    notes: data.notes ?? null,
    status: 'active' as const,
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates two patients linked as a couple in a single atomic transaction.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate both partner inputs against `createPatientSchema`.
 *   3. Generate a shared `couple_id` UUID.
 *   4. Insert both patients inside `db.transaction()` — if the second
 *      insert fails, both are rolled back.
 *   5. Return both patient IDs and the shared couple ID on success.
 */
export async function createCouplePatientImpl(
  supabase: SupabaseClient,
  partnerA: unknown,
  partnerB: unknown,
): Promise<CreateCouplePatientResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate both inputs — force patientType to "couple"
  const parsedA = createPatientSchema.safeParse({
    ...(partnerA as PartnerInput),
    patientType: 'couple',
  });
  if (!parsedA.success) {
    return {
      ok: false,
      error: 'invalid_input_a',
      fieldErrors: parsedA.error.flatten().fieldErrors,
    };
  }

  const parsedB = createPatientSchema.safeParse({
    ...(partnerB as PartnerInput),
    patientType: 'couple',
  });
  if (!parsedB.success) {
    return {
      ok: false,
      error: 'invalid_input_b',
      fieldErrors: parsedB.error.flatten().fieldErrors,
    };
  }

  const userId = user.id;
  const coupleId = randomUUID();

  // 3. Atomic insert of both patients
  try {
    const result = await db.transaction(async (tx) => {
      const [insertedA] = await tx
        .insert(patients)
        .values(buildInsertValues(userId, parsedA.data, coupleId))
        .returning({ id: patients.id });

      const [insertedB] = await tx
        .insert(patients)
        .values(buildInsertValues(userId, parsedB.data, coupleId))
        .returning({ id: patients.id });

      return { patientAId: insertedA!.id, patientBId: insertedB!.id };
    });

    return { ok: true, ...result, coupleId };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'create_couple_patient_failed', errorCode: pgError.code },
      'unexpected error creating couple patients',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao criar casal de pacientes. Tente novamente.',
    };
  }
}
