import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/shared/db/client';
import { patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const updatePatientOptOutInputSchema = z.object({
  patient_id: z.string().uuid(),
  whatsapp_opt_out: z.boolean(),
  opt_out_reason: z.string().optional(),
});

export type UpdatePatientOptOutInput = z.infer<typeof updatePatientOptOutInputSchema>;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type UpdatePatientOptOutResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Toggles the WhatsApp opt-out status of a patient.
 *
 * When `whatsapp_opt_out` is `true`, sets `whatsapp_opt_out = true` and
 * `whatsapp_opt_out_at = now()`. When `false`, clears both fields.
 *
 * The optional `opt_out_reason` is logged for audit purposes but NOT stored
 * in the database (there is no column for it — it is informational).
 */
export async function updatePatientWhatsappOptOutImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<UpdatePatientOptOutResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = updatePatientOptOutInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { patient_id: patientId, whatsapp_opt_out: optOut, opt_out_reason: optOutReason } =
    parsed.data;
  const userId = user.id;

  // 3. Verify patient exists and belongs to user
  const [existing] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!existing) {
    return { ok: false, error: 'not_found' };
  }

  // 4. Update opt-out status
  try {
    await db
      .update(patients)
      .set({
        whatsappOptOut: optOut,
        whatsappOptOutAt: optOut ? sql`now()` : null,
        updatedAt: sql`now()`,
      })
      .where(and(eq(patients.id, patientId), eq(patients.userId, userId)));

    logger.info(
      {
        event: optOut ? 'patient_whatsapp_opted_out' : 'patient_whatsapp_opted_in',
        userId,
        patientId,
        hasReason: !!optOutReason,
      },
      optOut ? 'Patient opted out of WhatsApp reminders' : 'Patient opted back in to WhatsApp reminders',
    );

    return { ok: true };
  } catch (err: unknown) {
    logger.error(
      {
        event: 'update_patient_opt_out_failed',
        errorName: err instanceof Error ? err.name : 'UnknownError',
      },
      'unexpected error updating patient WhatsApp opt-out',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao atualizar preferência WhatsApp. Tente novamente.',
    };
  }
}
