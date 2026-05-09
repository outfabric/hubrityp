import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { locations } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SetLocationDefaultResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Marks a location as the default for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify location exists and belongs to user (ownership check).
 *   3. Clear the previous default and set the new one in a transaction.
 *
 * This is a dedicated action to avoid requiring full location input data
 * just to toggle the `is_default` flag.
 */
export async function setLocationDefaultImpl(
  supabase: SupabaseClient,
  locationId: string,
): Promise<SetLocationDefaultResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  // 2. Verify ownership
  const [existing] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.userId, userId)))
    .limit(1);

  if (!existing) {
    return { ok: false, error: 'not_found' };
  }

  // 3. Clear previous default + set new one in a transaction
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(locations)
        .set({ isDefault: false, updatedAt: sql`now()` })
        .where(and(eq(locations.userId, userId), eq(locations.isDefault, true)));

      await tx
        .update(locations)
        .set({ isDefault: true, updatedAt: sql`now()` })
        .where(and(eq(locations.id, locationId), eq(locations.userId, userId)));
    });

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'set_location_default_failed', errorCode: pgError.code },
      'unexpected error setting location as default',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao marcar local como padrao. Tente novamente.',
    };
  }
}
