import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { createPatientBaseSchema } from '@/modules/patients/lib/patient-input-schema';
import type { CreatePatientInput } from '@/modules/patients/lib/patient-types';
import { formatPhone } from '@/modules/patients/lib/patient-validators';
import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CreatePatientResult =
  | { ok: true; patientId: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'duplicate_phone'; message: string }
  | { ok: false; error: 'duplicate_email'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a new patient for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input against `createPatientSchema`.
 *   3. Normalize phone (format to canonical BR format).
 *   4. Check for duplicate phone (same user).
 *   5. Check for duplicate email (same user, non-null email).
 *   6. Insert via Drizzle (RLS ensures user_id matches).
 *   7. Return patient ID on success.
 *
 * Unique constraint violations from the DB are caught as a safety net
 * (the pre-check queries handle the normal case with user-friendly messages).
 */
export async function createPatientImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<CreatePatientResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  // Use createPatientBaseSchema (without superRefine) because the guardian
  // requirement is a *form-level* concern enforced by the client.  The server
  // action creates the patient record first; guardians are added separately
  // via addGuardianImpl. The superRefine on createPatientSchema would reject
  // child/adolescent payloads that arrive without inline guardians.
  const parsed = createPatientBaseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data: CreatePatientInput = parsed.data;
  const userId = user.id;

  // 3. Normalize phone
  const normalizedPhone = data.phone ? formatPhone(data.phone) : null;

  // 4. Check duplicate phone (same user)
  if (normalizedPhone) {
    const existingByPhone = await db
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.userId, userId), eq(patients.phone, normalizedPhone)))
      .limit(1);

    if (existingByPhone.length > 0) {
      return {
        ok: false,
        error: 'duplicate_phone',
        message: 'Já existe um paciente com este telefone.',
      };
    }
  }

  // 5. Check duplicate email (same user, non-null email)
  const normalizedEmail = data.email && data.email.trim() !== '' ? data.email.trim() : null;
  if (normalizedEmail) {
    const existingByEmail = await db
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.userId, userId), eq(patients.email, normalizedEmail)))
      .limit(1);

    if (existingByEmail.length > 0) {
      return {
        ok: false,
        error: 'duplicate_email',
        message: 'Já existe um paciente com este email.',
      };
    }
  }

  // 6. Insert via Drizzle
  try {
    const whatsappOptOut = data.whatsapp_opt_out ?? false;

    const [inserted] = await db
      .insert(patients)
      .values({
        userId,
        fullName: data.fullName,
        patientType: data.patientType,
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
        status: 'active',
        whatsappOptOut,
        whatsappOptOutAt: whatsappOptOut ? new Date() : null,
        reminderPhone: data.reminder_phone ?? null,
      })
      .returning({ id: patients.id });

    return { ok: true, patientId: inserted!.id };
  } catch (err: unknown) {
    // Safety net: catch unique constraint violations from the DB
    const pgError = err as { code?: string; constraint?: string; detail?: string };
    if (pgError.code === '23505') {
      if (pgError.constraint?.includes('email') || pgError.detail?.includes('email')) {
        return {
          ok: false,
          error: 'duplicate_email',
          message: 'Já existe um paciente com este email.',
        };
      }
      if (pgError.constraint?.includes('phone') || pgError.detail?.includes('phone')) {
        return {
          ok: false,
          error: 'duplicate_phone',
          message: 'Já existe um paciente com este telefone.',
        };
      }
      // Generic unique violation
      return {
        ok: false,
        error: 'unknown',
        message: 'Registro duplicado detectado.',
      };
    }

    logger.error(
      { event: 'create_patient_failed', errorCode: pgError.code },
      'unexpected error inserting patient',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao criar paciente. Tente novamente.',
    };
  }
}
