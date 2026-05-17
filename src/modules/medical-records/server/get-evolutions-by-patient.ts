import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/shared/db/client';
import { auditLog, evolutions } from '@/shared/db/schema/medical-records/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const getEvolutionsByPatientSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID válido.' }),
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface EvolutionSummary {
  id: string;
  patientId: string;
  sessionId: string | null;
  templateType: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  finalizedAt: Date | null;
}

export type GetEvolutionsByPatientResult =
  | { ok: true; evolutions: EvolutionSummary[]; nextCursor: string | null }
  | { ok: false; code: 'UNAUTHORIZED' | 'INVALID_INPUT' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Returns a paginated list of evolution summaries for a given patient,
 * ordered by created_at DESC (most recent first).
 *
 * Cursor-based pagination uses the `created_at` of the last item in the
 * previous page. Content is NOT included in the summary to keep payloads
 * small — use getEvolutionDetail for full content.
 *
 * Side-effect: writes audit_log 'prontuario.read' on each successful fetch.
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function getEvolutionsByPatientImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<GetEvolutionsByPatientResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = getEvolutionsByPatientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT' };
  }

  const { patientId, cursor, limit } = parsed.data;
  const userId = user.id;

  try {
    // 3. Build query conditions
    const conditions = [eq(evolutions.userId, userId), eq(evolutions.patientId, patientId)];

    if (cursor) {
      conditions.push(lt(evolutions.createdAt, new Date(cursor)));
    }

    // 4. Fetch one extra to determine nextCursor
    const rows = await db
      .select({
        id: evolutions.id,
        patientId: evolutions.patientId,
        sessionId: evolutions.sessionId,
        templateType: evolutions.templateType,
        currentVersion: evolutions.currentVersion,
        createdAt: evolutions.createdAt,
        updatedAt: evolutions.updatedAt,
        finalizedAt: evolutions.finalizedAt,
      })
      .from(evolutions)
      .where(and(...conditions))
      .orderBy(desc(evolutions.createdAt))
      .limit(limit + 1);

    // 5. Determine next cursor
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      rows.pop();
      const lastItem = rows[rows.length - 1]!;
      nextCursor = lastItem.createdAt.toISOString();
    }

    // 6. Write audit_log for prontuario access
    await db.insert(auditLog).values({
      userId,
      action: 'prontuario.read',
      resourceType: 'patient',
      resourceId: patientId,
      metadata: { itemCount: rows.length },
    });

    return { ok: true, evolutions: rows, nextCursor };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'get_evolutions_by_patient_failed', errorCode: pgError.code },
      'unexpected error fetching evolutions by patient',
    );
    throw err;
  }
}
