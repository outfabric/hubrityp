import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { sql } from 'drizzle-orm';

import { agendaSettingsInputSchema } from '@/modules/agenda/lib/agenda-settings-input-schema';
import { db } from '@/shared/db/client';
import { agendaSettings } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SaveAgendaSettingsResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates or updates agenda settings for the authenticated psychologist.
 *
 * Uses INSERT ... ON CONFLICT (user_id) DO UPDATE to handle both initial
 * creation and subsequent saves in a single operation, following the same
 * upsert pattern used by `upsertAnamnesisImpl`.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input against `agendaSettingsInputSchema`.
 *   3. Upsert via Drizzle `onConflictDoUpdate` targeting user_id (PK).
 */
export async function saveAgendaSettingsImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<SaveAgendaSettingsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = agendaSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data = parsed.data;

  // 3. Upsert via Drizzle — INSERT ON CONFLICT (user_id) DO UPDATE
  try {
    await db
      .insert(agendaSettings)
      .values({
        userId: user.id,
        defaultDurationMinutes: data.default_duration_minutes,
        intervalMinutes: data.interval_minutes,
        businessHours: data.business_hours,
        cancellationPolicy: data.cancellation_policy ?? null,
        defaultColor: data.default_color ?? null,
      })
      .onConflictDoUpdate({
        target: agendaSettings.userId,
        set: {
          defaultDurationMinutes: data.default_duration_minutes,
          intervalMinutes: data.interval_minutes,
          businessHours: data.business_hours,
          cancellationPolicy: data.cancellation_policy ?? null,
          defaultColor: data.default_color ?? null,
          updatedAt: sql`now()`,
        },
      });

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'save_agenda_settings_failed', errorCode: pgError.code },
      'unexpected error upserting agenda settings',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao salvar configurações da agenda. Tente novamente.',
    };
  }
}
