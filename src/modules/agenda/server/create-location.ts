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

export type CreateLocationResult =
  | { ok: true; locationId: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a new location for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input against `locationInputSchema`.
 *   3. If `is_default` is true, clear the previous default in a transaction.
 *   4. Insert the new location.
 *   5. Return the new location ID.
 */
export async function createLocationImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<CreateLocationResult> {
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
  const isDefault = data.is_default ?? false;

  // 3. Insert (with default toggle in transaction if needed)
  try {
    if (isDefault) {
      // Clear previous default and insert in a single transaction
      const [inserted] = await db.transaction(async (tx) => {
        await tx
          .update(locations)
          .set({ isDefault: false, updatedAt: sql`now()` })
          .where(and(eq(locations.userId, userId), eq(locations.isDefault, true)));

        return tx
          .insert(locations)
          .values({
            userId,
            name: data.name,
            address: data.address ?? null,
            type: data.type,
            color: data.color ?? null,
            arrivalInstructions: data.arrival_instructions ?? null,
            isDefault: true,
          })
          .returning({ id: locations.id });
      });

      return { ok: true, locationId: inserted!.id };
    }

    // No default toggle — simple insert
    const [inserted] = await db
      .insert(locations)
      .values({
        userId,
        name: data.name,
        address: data.address ?? null,
        type: data.type,
        color: data.color ?? null,
        arrivalInstructions: data.arrival_instructions ?? null,
        isDefault: false,
      })
      .returning({ id: locations.id });

    return { ok: true, locationId: inserted!.id };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'create_location_failed', errorCode: pgError.code },
      'unexpected error inserting location',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao criar local. Tente novamente.',
    };
  }
}
