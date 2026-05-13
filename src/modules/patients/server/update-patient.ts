import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, ne, sql } from 'drizzle-orm';

import { updatePatientSchema } from '@/modules/patients/lib/patient-input-schema';
import type { UpdatePatientInput } from '@/modules/patients/lib/patient-types';
import { formatPhone } from '@/modules/patients/lib/patient-validators';
import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type UpdatePatientResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'duplicate_phone'; message: string }
  | { ok: false; error: 'duplicate_email'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Updates an existing patient for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input against `updatePatientSchema`.
 *   3. Verify patient exists and belongs to user (RLS + explicit check).
 *   4. If phone is being updated, check for duplicates (excluding self).
 *   5. If email is being updated, check for duplicates (excluding self).
 *   6. Update via Drizzle with `updated_at = now()`.
 *
 * Returns `not_found` for both non-existent patients and patients owned
 * by another user — no information leakage.
 */
export async function updatePatientImpl(
  supabase: SupabaseClient,
  patientId: string,
  input: unknown,
): Promise<UpdatePatientResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = updatePatientSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data: UpdatePatientInput = parsed.data;
  const userId = user.id;

  // 3. Verify patient exists and belongs to user (fetch whatsappOptOut for transition detection)
  const [existing] = await db
    .select({ id: patients.id, whatsappOptOut: patients.whatsappOptOut })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!existing) {
    return { ok: false, error: 'not_found' };
  }

  // 4. Check duplicate phone (if phone is being updated)
  const normalizedPhone =
    data.phone !== undefined ? (data.phone ? formatPhone(data.phone) : null) : undefined;

  if (normalizedPhone) {
    const existingByPhone = await db
      .select({ id: patients.id })
      .from(patients)
      .where(
        and(
          eq(patients.userId, userId),
          eq(patients.phone, normalizedPhone),
          ne(patients.id, patientId),
        ),
      )
      .limit(1);

    if (existingByPhone.length > 0) {
      return {
        ok: false,
        error: 'duplicate_phone',
        message: 'Já existe um paciente com este telefone.',
      };
    }
  }

  // 5. Check duplicate email (if email is being updated)
  const normalizedEmail =
    data.email !== undefined
      ? data.email && data.email.trim() !== ''
        ? data.email.trim()
        : null
      : undefined;

  if (normalizedEmail) {
    const existingByEmail = await db
      .select({ id: patients.id })
      .from(patients)
      .where(
        and(
          eq(patients.userId, userId),
          eq(patients.email, normalizedEmail),
          ne(patients.id, patientId),
        ),
      )
      .limit(1);

    if (existingByEmail.length > 0) {
      return {
        ok: false,
        error: 'duplicate_email',
        message: 'Já existe um paciente com este email.',
      };
    }
  }

  // 6. Build update payload (only include fields that were provided)
  const updatePayload: Record<string, unknown> = {
    updatedAt: sql`now()`,
  };

  if (data.fullName !== undefined) updatePayload.fullName = data.fullName;
  if (data.patientType !== undefined) updatePayload.patientType = data.patientType;
  if (data.birthDate !== undefined) updatePayload.birthDate = data.birthDate ?? null;
  if (data.approximateAge !== undefined) updatePayload.approximateAge = data.approximateAge ?? null;
  if (data.gender !== undefined) updatePayload.gender = data.gender ?? null;
  if (normalizedPhone !== undefined) updatePayload.phone = normalizedPhone;
  if (normalizedEmail !== undefined) updatePayload.email = normalizedEmail;
  if (data.cpf !== undefined) updatePayload.cpf = data.cpf ?? null;
  if (data.address !== undefined)
    updatePayload.address = data.address ? JSON.stringify(data.address) : null;
  if (data.profession !== undefined) updatePayload.profession = data.profession ?? null;
  if (data.maritalStatus !== undefined) updatePayload.maritalStatus = data.maritalStatus ?? null;
  if (data.source !== undefined) updatePayload.source = data.source ?? null;
  if (data.tags !== undefined) updatePayload.tags = data.tags ?? [];
  if (data.notes !== undefined) updatePayload.notes = data.notes ?? null;
  if (data.status !== undefined) updatePayload.status = data.status;

  // WhatsApp opt-out controls
  if (data.whatsapp_opt_out !== undefined) {
    updatePayload.whatsappOptOut = data.whatsapp_opt_out;

    // Handle opt-out timestamp transitions
    const wasOptedOut = existing.whatsappOptOut;
    const isNowOptedOut = data.whatsapp_opt_out;

    if (!wasOptedOut && isNowOptedOut) {
      // Transitioning false -> true: set timestamp
      updatePayload.whatsappOptOutAt = new Date();
    } else if (wasOptedOut && !isNowOptedOut) {
      // Transitioning true -> false: clear timestamp
      updatePayload.whatsappOptOutAt = null;
    }
  }
  if (data.reminder_phone !== undefined) updatePayload.reminderPhone = data.reminder_phone ?? null;

  try {
    await db
      .update(patients)
      .set(updatePayload)
      .where(and(eq(patients.id, patientId), eq(patients.userId, userId)));

    return { ok: true };
  } catch (err: unknown) {
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
      return {
        ok: false,
        error: 'unknown',
        message: 'Registro duplicado detectado.',
      };
    }

    logger.error(
      { event: 'update_patient_failed', errorCode: pgError.code },
      'unexpected error updating patient',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao atualizar paciente. Tente novamente.',
    };
  }
}
