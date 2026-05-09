import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { asc, desc, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { locations, type Location } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ListLocationsResult =
  | { ok: true; locations: Location[] }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Lists all locations for the authenticated psychologist.
 *
 * Results are ordered by `is_default DESC, name ASC` so the default location
 * always appears first, followed by alphabetical order.
 *
 * RLS guarantees ownership scope, but we add an explicit `userId` filter for
 * defense-in-depth.
 */
export async function listLocationsImpl(supabase: SupabaseClient): Promise<ListLocationsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Query locations ordered by is_default DESC, name ASC
  try {
    const rows = await db
      .select()
      .from(locations)
      .where(eq(locations.userId, user.id))
      .orderBy(desc(locations.isDefault), asc(locations.name));

    return { ok: true, locations: rows };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'list_locations_failed', errorCode: pgError.code },
      'unexpected error listing locations',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao listar locais. Tente novamente.',
    };
  }
}
