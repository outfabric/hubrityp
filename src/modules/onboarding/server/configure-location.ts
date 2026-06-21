import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq, sql } from 'drizzle-orm';

import { createLocationImpl } from '@/modules/agenda';
import { db } from '@/shared/db/client';
import { agendaSettings, locations } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { onboardingChecklist } from '@/shared/db/schema/onboarding/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ConfigureLocationResult =
  | {
      ok: true;
      /**
       * The newly inserted location id, or `null` when the step was satisfied by
       * an already-existing location (idempotent path — no insert performed).
       */
      locationId: string | null;
      /** True when this call reused an existing location instead of inserting. */
      reusedExisting: boolean;
    }
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
 * IDEMPOTENT against existing locations (onboarding-wizard spec, "Step 2 reuses
 * existing location"). The step must never blindly INSERT a second location when
 * the owner already configured one elsewhere (Configurações) or on a previous
 * pass — that is the duplication bug seen on reactivated accounts. Flow:
 *   1. Authenticate via `supabase.auth.getUser()` (NEVER `getSession`). Any
 *      client-supplied user id is ignored here and in the agenda path — IDOR-safe.
 *   2. Probe whether the owner already has ≥1 location (owner-scoped existence
 *      `SELECT 1 ... LIMIT 1`).
 *        - If YES → the step is already satisfied. We do NOT insert another
 *          location (and do NOT validate the form input — the user may pass
 *          through without re-filling it). `reusedExisting = true`,
 *          `locationId = null`.
 *        - If NO  → delegate to {@link createLocationImpl}, which Zod-validates
 *          against `locationInputSchema` and inserts the row scoped to
 *          `auth.uid()`. `reusedExisting = false`, `locationId` = the new id.
 *   3. Either way, in a single transaction:
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
  // 1. Authenticate up front — `getUser()` revalidates the JWT with GoTrue. We
  // need the verified owner id BEFORE deciding whether to insert, so the
  // existence probe and the agenda create path both key off the same session.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  // 2. Idempotency probe: does the owner already have a location? Bounded
  // existence check, owner-scoped (`db` bypasses RLS, so the explicit predicate
  // is what keeps a tenant from seeing another's data — RLS is the backstop).
  const existing = await db
    .select({ one: sql<number>`1` })
    .from(locations)
    .where(eq(locations.userId, userId))
    .limit(1);
  const hasLocation = existing.length > 0;

  let locationId: string | null = null;

  if (!hasLocation) {
    // No location yet → create one via the agenda module (validates + inserts,
    // scoped to `auth.uid()`). On validation/transport failure we propagate the
    // sanitized error unchanged.
    const created = await createLocationImpl(supabase, input);
    if (!created.ok) {
      return created;
    }
    locationId = created.locationId;
  }

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

    return { ok: true, locationId, reusedExisting: hasLocation };
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
