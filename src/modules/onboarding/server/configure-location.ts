import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { createLocationImpl } from '@/modules/agenda';
import { db } from '@/shared/db/client';
import { agendaSettings } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { onboardingChecklist } from '@/shared/db/schema/onboarding/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ConfigureLocationResult =
  | { ok: true; locationId: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Completes onboarding wizard step 2 ("Local e agenda") by REUSING the agenda
 * module's location-create path. There is intentionally NO onboarding-specific
 * location table or CRUD — `locations` and `agenda_settings` are owned by the
 * agenda domain; this action only orchestrates the existing pieces and records
 * that the setup step is done.
 *
 * Flow:
 *   1. Delegate to {@link createLocationImpl}, which authenticates via
 *      `supabase.auth.getUser()`, Zod-validates against `locationInputSchema`,
 *      and inserts the row scoped to the session owner (`auth.uid()`). Any
 *      client-supplied user id is ignored there and here — IDOR-safe.
 *   2. On success, in a single transaction:
 *        a. Ensure an `agenda_settings` row exists for the owner. The INSERT is
 *           a no-op on conflict, so the table defaults apply — session duration
 *           50 min, interval 10 min, and the standard working hours.
 *        b. Upsert the owner's `onboarding_checklist` row, flipping
 *           `location_configured = TRUE`.
 *        c. Advance `profiles.onboarding_step` to the NEXT step `'patients'`
 *           ABSOLUTELY (idempotent), so concurrent re-submits converge. The
 *           user just COMPLETED `location`, so persisting `patients` routes
 *           them to step 3 next (see the onboarding-wizard spec).
 *
 * Authorization is `auth.uid()` only; RLS is the backstop on every write.
 * Errors are sanitized — callers receive a stable shape, never a Postgres
 * message or stack trace, and no PII is logged.
 */
export async function configureLocationImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<ConfigureLocationResult> {
  // 1. Create the location via the agenda module (auth + validation + insert).
  const created = await createLocationImpl(supabase, input);
  if (!created.ok) {
    return created;
  }

  // The location insert already proved the session is authenticated; re-read
  // the user id from the verified session for the follow-up writes.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  try {
    await db.transaction(async (tx) => {
      // 2a. Ensure an agenda_settings row exists (table defaults apply: 50 min
      // duration, 10 min interval, standard working hours). No-op if present.
      await tx
        .insert(agendaSettings)
        .values({ userId })
        .onConflictDoNothing({ target: agendaSettings.userId });

      // 2b. Flip the location_configured checklist flag (lazy upsert).
      await tx
        .insert(onboardingChecklist)
        .values({ userId, locationConfigured: true })
        .onConflictDoUpdate({
          target: onboardingChecklist.userId,
          set: { locationConfigured: true, updatedAt: new Date() },
        });

      // 2c. Advance to the NEXT step (`patients`) ABSOLUTELY (idempotent),
      // scoped to owner. The user just COMPLETED `location`.
      await tx
        .update(profiles)
        .set({ onboardingStep: 'patients', updatedAt: new Date() })
        .where(eq(profiles.userId, userId));
    });

    return { ok: true, locationId: created.locationId };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'configure_location_step_failed', userId, errorCode: pgError.code },
      'unexpected error completing onboarding location step',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao salvar o local. Tente novamente.',
    };
  }
}
