import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { locationInputSchema } from '@/modules/agenda/lib/location-input-schema';
import { db } from '@/shared/db/client';
import { locations } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type UpdateLocationResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Updates an existing location for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input against `locationInputSchema`.
 *   3. Verify location exists and belongs to user (ownership check).
 *   4. If `is_default` changed to true, clear the previous default in a
 *      transaction.
 *   5. Update the location.
 *
 * Returns `not_found` for both non-existent locations and locations owned
 * by another user — no information leakage.
 */
export async function updateLocationImpl(
  supabase: SupabaseClient,
  locationId: string,
  input: unknown,
): Promise<UpdateLocationResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = locationInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data = parsed.data;
  const userId = user.id;

  // 3. Verify ownership
  const [existing] = await db
    .select({ id: locations.id, isDefault: locations.isDefault })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.userId, userId)))
    .limit(1);

  if (!existing) {
    return { ok: false, error: 'not_found' };
  }

  const newIsDefault = data.is_default ?? false;
  const defaultChangedToTrue = newIsDefault && !existing.isDefault;

  // 4. Update (with default toggle in transaction if needed)
  try {
    const updatePayload = {
      name: data.name,
      address: data.address ?? null,
      type: data.type,
      color: data.color ?? null,
      arrivalInstructions: data.arrival_instructions ?? null,
      isDefault: newIsDefault,
      updatedAt: sql`now()`,
    };

    if (defaultChangedToTrue) {
      // Clear previous default and update in a single transaction
      await db.transaction(async (tx) => {
        await tx
          .update(locations)
          .set({ isDefault: false, updatedAt: sql`now()` })
          .where(and(eq(locations.userId, userId), eq(locations.isDefault, true)));

        await tx
          .update(locations)
          .set(updatePayload)
          .where(and(eq(locations.id, locationId), eq(locations.userId, userId)));
      });
    } else {
      await db
        .update(locations)
        .set(updatePayload)
        .where(and(eq(locations.id, locationId), eq(locations.userId, userId)));
    }

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'update_location_failed', errorCode: pgError.code },
      'unexpected error updating location',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao atualizar local. Tente novamente.',
    };
  }
}
