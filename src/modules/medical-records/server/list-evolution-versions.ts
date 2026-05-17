import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/shared/db/client';
import {
  evolutions,
  evolutionVersions,
  type EvolutionVersion,
} from '@/shared/db/schema/medical-records/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const listEvolutionVersionsSchema = z.object({
  evolutionId: z.string().uuid({ message: 'evolutionId deve ser um UUID válido.' }),
});

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ListEvolutionVersionsResult =
  | { ok: true; versions: EvolutionVersion[] }
  | { ok: false; code: 'NOT_FOUND' | 'UNAUTHORIZED' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Returns all version snapshots for an evolution, ordered by version_number
 * DESC (most recent first).
 *
 * Ownership check: verifies the parent evolution belongs to the authenticated
 * psychologist before returning versions. RLS on evolution_versions uses a
 * JOIN-scoped subquery, so this is defense-in-depth.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function listEvolutionVersionsImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<ListEvolutionVersionsResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = listEvolutionVersionsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  const { evolutionId } = parsed.data;
  const userId = user.id;

  try {
    // 3. Verify ownership of the parent evolution
    const [evolution] = await db
      .select({ id: evolutions.id })
      .from(evolutions)
      .where(and(eq(evolutions.id, evolutionId), eq(evolutions.userId, userId)))
      .limit(1);

    if (!evolution) {
      return { ok: false, code: 'NOT_FOUND' };
    }

    // 4. Fetch all versions ordered by version_number DESC
    const versions = await db
      .select()
      .from(evolutionVersions)
      .where(eq(evolutionVersions.evolutionId, evolutionId))
      .orderBy(desc(evolutionVersions.versionNumber));

    return { ok: true, versions };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'list_evolution_versions_failed', errorCode: pgError.code },
      'unexpected error listing evolution versions',
    );
    throw err;
  }
}
