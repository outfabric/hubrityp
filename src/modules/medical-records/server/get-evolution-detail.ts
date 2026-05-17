import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/shared/db/client';
import { auditLog, evolutions, type Evolution } from '@/shared/db/schema/medical-records/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const getEvolutionDetailSchema = z.object({
  evolutionId: z.string().uuid({ message: 'evolutionId deve ser um UUID válido.' }),
});

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type EvolutionFull = Evolution;

export type GetEvolutionDetailResult =
  | { ok: true; evolution: EvolutionFull }
  | { ok: false; code: 'NOT_FOUND' | 'UNAUTHORIZED' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Retrieves full evolution detail by ID for the authenticated psychologist.
 *
 * RLS guarantees ownership — if the evolution belongs to a different user,
 * the query returns zero rows and we report NOT_FOUND (no information
 * leakage about existence to unauthorized callers).
 *
 * Side-effect: writes audit_log 'evolution.read'.
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function getEvolutionDetailImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<GetEvolutionDetailResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = getEvolutionDetailSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  const { evolutionId } = parsed.data;
  const userId = user.id;

  try {
    // 3. Fetch evolution (defense-in-depth: explicit userId filter + RLS)
    const [evolution] = await db
      .select()
      .from(evolutions)
      .where(and(eq(evolutions.id, evolutionId), eq(evolutions.userId, userId)))
      .limit(1);

    if (!evolution) {
      return { ok: false, code: 'NOT_FOUND' };
    }

    // 4. Write audit_log entry for read access
    await db.insert(auditLog).values({
      userId,
      action: 'evolution.read',
      resourceType: 'evolution',
      resourceId: evolutionId,
      metadata: {},
    });

    return { ok: true, evolution };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'get_evolution_detail_failed', errorCode: pgError.code },
      'unexpected error fetching evolution detail',
    );
    throw err;
  }
}
