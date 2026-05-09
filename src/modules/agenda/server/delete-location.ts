import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { locations } from '@/shared/db/schema/agenda/tables';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type DeleteLocationResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'has_linked_sessions'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Deletes a location for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify location exists and belongs to user.
 *   3. Check if location has linked sessions — block deletion if so.
 *   4. Delete the location.
 *
 * Returns `not_found` for both non-existent locations and locations owned
 * by another user — no information leakage.
 */
export async function deleteLocationImpl(
  supabase: SupabaseClient,
  locationId: string,
): Promise<DeleteLocationResult> {
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

  // 3. Check for linked sessions
  const linkedSessions = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.locationId, locationId))
    .limit(1);

  if (linkedSessions.length > 0) {
    return {
      ok: false,
      error: 'has_linked_sessions',
      message: 'Este local esta vinculado a sessoes. Remova o vinculo antes de excluir.',
    };
  }

  // 4. Delete
  try {
    const deleted = await db
      .delete(locations)
      .where(and(eq(locations.id, locationId), eq(locations.userId, userId)))
      .returning({ id: locations.id });

    if (deleted.length === 0) {
      return { ok: false, error: 'not_found' };
    }

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'delete_location_failed', errorCode: pgError.code },
      'unexpected error deleting location',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao excluir local. Tente novamente.',
    };
  }
}
