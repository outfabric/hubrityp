import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import {
  CONTENT_SCHEMA_MAP,
  createEvolutionInputSchema,
} from '@/modules/medical-records/lib/evolution-schemas';
import { db } from '@/shared/db/client';
import { auditLog, evolutions, evolutionVersions } from '@/shared/db/schema/medical-records/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CreateEvolutionResult =
  | { ok: true; id: string }
  | { ok: false; code: 'DUPLICATE_SESSION' | 'INVALID_TEMPLATE' | 'UNAUTHORIZED' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a new clinical evolution note for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input with Zod (createEvolutionInputSchema).
 *   3. Validate content against the template-specific schema.
 *   4. Insert evolution row + initial evolution_versions v1 row.
 *   5. Write audit_log 'evolution.create'.
 *   6. Return evolution ID on success.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function createEvolutionImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<CreateEvolutionResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate top-level input
  const parsed = createEvolutionInputSchema.safeParse(input);
  if (!parsed.success) {
    // If templateType is invalid at the enum level, report INVALID_TEMPLATE
    const fieldErrors = parsed.error.flatten().fieldErrors;
    if (fieldErrors.templateType) {
      return { ok: false, code: 'INVALID_TEMPLATE' };
    }
    // Any other validation failure is treated as invalid template content
    return { ok: false, code: 'INVALID_TEMPLATE' };
  }

  const { patientId, sessionId, templateType, content } = parsed.data;
  const userId = user.id;

  // 3. Validate content against the template-specific schema
  const contentSchema = CONTENT_SCHEMA_MAP[templateType];
  if (!contentSchema) {
    return { ok: false, code: 'INVALID_TEMPLATE' };
  }

  const contentParsed = contentSchema.safeParse(content);
  if (!contentParsed.success) {
    return { ok: false, code: 'INVALID_TEMPLATE' };
  }

  const validatedContent = contentParsed.data as Record<string, unknown>;

  // 4. Insert evolution + v1 version in a transaction
  try {
    const result = await db.transaction(async (tx) => {
      // Check for duplicate session_id (unique constraint, but pre-check for friendly error)
      if (sessionId) {
        const existing = await tx
          .select({ id: evolutions.id })
          .from(evolutions)
          .where(eq(evolutions.sessionId, sessionId))
          .limit(1);

        if (existing.length > 0) {
          return { ok: false as const, code: 'DUPLICATE_SESSION' as const };
        }
      }

      // Insert evolution row
      const [evolution] = await tx
        .insert(evolutions)
        .values({
          userId,
          patientId,
          sessionId: sessionId ?? null,
          templateType,
          content: validatedContent,
          currentVersion: 1,
        })
        .returning({ id: evolutions.id });

      // Insert initial version (v1, not an addendum)
      await tx.insert(evolutionVersions).values({
        evolutionId: evolution!.id,
        versionNumber: 1,
        content: validatedContent,
        isAddendum: false,
        modifiedBy: userId,
        reason: null,
      });

      // Write audit_log entry for creation
      await tx.insert(auditLog).values({
        userId,
        action: 'evolution.create',
        resourceType: 'evolution',
        resourceId: evolution!.id,
        metadata: { templateType, patientId },
      });

      return { ok: true as const, id: evolution!.id };
    });

    return result;
  } catch (err: unknown) {
    const pgError = err as { code?: string; constraint?: string };

    // Handle unique constraint violation on session_id
    if (pgError.code === '23505' && pgError.constraint?.includes('session_id')) {
      return { ok: false, code: 'DUPLICATE_SESSION' };
    }

    logger.error(
      { event: 'create_evolution_failed', errorCode: pgError.code },
      'unexpected error creating evolution',
    );
    // Re-throw unexpected errors — caller (Server Action boundary) handles
    throw err;
  }
}
