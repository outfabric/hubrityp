import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { shouldForceAddendum } from '@/modules/medical-records/lib/immutability-helpers';
import { db } from '@/shared/db/client';
import { auditLog, evolutions, evolutionVersions } from '@/shared/db/schema/medical-records/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Input schema (server-side — follows design.md signature exactly)
// ---------------------------------------------------------------------------

const updateEvolutionServerSchema = z.object({
  evolutionId: z.string().uuid({ message: 'evolutionId deve ser um UUID válido.' }),
  content: z.record(z.string(), z.unknown()).refine((obj) => Object.keys(obj).length > 0, {
    message: 'Conteúdo não pode ser vazio.',
  }),
  reason: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type UpdateEvolutionResult =
  | { ok: true; version: number; isAddendum: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'UNAUTHORIZED' | 'REASON_REQUIRED' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Updates an existing evolution note for the authenticated psychologist.
 *
 * Logic (RN-05.02 — 30-day immutability):
 *   - If within the 30-day edit window: update evolutions.content, increment
 *     current_version, create evolution_versions row (is_addendum=false).
 *   - If past the window: create addendum version only (is_addendum=true),
 *     set finalized_at if null, require `reason` (else REASON_REQUIRED).
 *     Do NOT update evolutions.content — the original is preserved.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 * Ownership check uses explicit userId filter + RLS as defense-in-depth.
 */
export async function updateEvolutionImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<UpdateEvolutionResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = updateEvolutionServerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  const { evolutionId, content, reason } = parsed.data;
  const userId = user.id;

  // 3. Fetch the evolution (defense-in-depth: explicit userId filter + RLS)
  const [evolution] = await db
    .select({
      id: evolutions.id,
      createdAt: evolutions.createdAt,
      currentVersion: evolutions.currentVersion,
      finalizedAt: evolutions.finalizedAt,
    })
    .from(evolutions)
    .where(and(eq(evolutions.id, evolutionId), eq(evolutions.userId, userId)))
    .limit(1);

  if (!evolution) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  // 4. Determine if addendum is forced (30-day immutability rule)
  const isAddendum = shouldForceAddendum(evolution.createdAt);

  if (isAddendum && (!reason || reason.trim().length === 0)) {
    return { ok: false, code: 'REASON_REQUIRED' };
  }

  const newVersion = evolution.currentVersion + 1;

  try {
    await db.transaction(async (tx) => {
      if (isAddendum) {
        // Past the 30-day window: addendum only — do NOT update evolutions.content
        // Set finalized_at if not already set (marks first addendum transition)
        if (!evolution.finalizedAt) {
          await tx
            .update(evolutions)
            .set({
              finalizedAt: new Date(),
              currentVersion: newVersion,
              updatedAt: new Date(),
            })
            .where(and(eq(evolutions.id, evolutionId), eq(evolutions.userId, userId)));
        } else {
          await tx
            .update(evolutions)
            .set({
              currentVersion: newVersion,
              updatedAt: new Date(),
            })
            .where(and(eq(evolutions.id, evolutionId), eq(evolutions.userId, userId)));
        }

        // Create addendum version
        await tx.insert(evolutionVersions).values({
          evolutionId,
          versionNumber: newVersion,
          content,
          isAddendum: true,
          modifiedBy: userId,
          reason: reason!.trim(),
        });
      } else {
        // Within the 30-day window: update content normally
        await tx
          .update(evolutions)
          .set({
            content,
            currentVersion: newVersion,
            updatedAt: new Date(),
          })
          .where(and(eq(evolutions.id, evolutionId), eq(evolutions.userId, userId)));

        // Create version snapshot (not an addendum)
        await tx.insert(evolutionVersions).values({
          evolutionId,
          versionNumber: newVersion,
          content,
          isAddendum: false,
          modifiedBy: userId,
          reason: reason?.trim() || null,
        });
      }

      // Write audit_log
      await tx.insert(auditLog).values({
        userId,
        action: isAddendum ? 'evolution.addendum' : 'evolution.update',
        resourceType: 'evolution',
        resourceId: evolutionId,
        metadata: { version: newVersion, isAddendum },
      });
    });

    return { ok: true, version: newVersion, isAddendum };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'update_evolution_failed', errorCode: pgError.code },
      'unexpected error updating evolution',
    );
    throw err;
  }
}
