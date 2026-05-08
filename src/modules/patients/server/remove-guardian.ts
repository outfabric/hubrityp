import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, ne, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { patientGuardians, patients } from '@/shared/db/schema/patients/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type RemoveGuardianResult =
  | { ok: true; warning?: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'internal_error'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Removes a guardian from a patient owned by the authenticated user.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify guardian exists and its patient belongs to the user.
 *   3. Delete the guardian row.
 *   4. If the removed guardian was primary and another guardian remains,
 *      promote the remaining one to primary.
 *   5. If no guardians remain, return a warning message.
 */
export async function removeGuardianImpl(
  supabase: SupabaseClient,
  guardianId: string,
): Promise<RemoveGuardianResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  // 2. Verify guardian exists and its patient belongs to the user
  const [existing] = await db
    .select({
      guardianId: patientGuardians.id,
      patientId: patientGuardians.patientId,
      isPrimary: patientGuardians.isPrimary,
    })
    .from(patientGuardians)
    .innerJoin(patients, eq(patientGuardians.patientId, patients.id))
    .where(and(eq(patientGuardians.id, guardianId), eq(patients.userId, userId)))
    .limit(1);

  if (!existing) {
    return { ok: false, error: 'not_found' };
  }

  const { patientId, isPrimary } = existing;

  // 3. Delete the guardian + promote remaining (atomically in a transaction)
  try {
    let noGuardiansRemaining = false;

    await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(patientGuardians)
        .where(eq(patientGuardians.id, guardianId))
        .returning({ id: patientGuardians.id });

      if (deleted.length === 0) {
        throw new Error('NOT_FOUND');
      }

      // 4. If the removed guardian was primary, promote the next remaining one
      if (isPrimary) {
        const [remaining] = await tx
          .select({ id: patientGuardians.id })
          .from(patientGuardians)
          .where(
            and(eq(patientGuardians.patientId, patientId), ne(patientGuardians.id, guardianId)),
          )
          .limit(1);

        if (remaining) {
          await tx
            .update(patientGuardians)
            .set({ isPrimary: true })
            .where(eq(patientGuardians.id, remaining.id));
        }
      }

      // 5. Check if any guardians remain after deletion
      const [countResult] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(patientGuardians)
        .where(eq(patientGuardians.patientId, patientId));

      const remainingCount = countResult?.count ?? 0;
      noGuardiansRemaining = remainingCount === 0;
    });

    if (noGuardiansRemaining) {
      return {
        ok: true,
        warning: 'Este paciente menor está sem responsável cadastrado.',
      };
    }

    return { ok: true };
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'NOT_FOUND') {
      return { ok: false, error: 'not_found' };
    }

    const pgError = err as { code?: string };
    logger.error(
      { event: 'remove_guardian_failed', errorCode: pgError.code },
      'unexpected error removing guardian',
    );
    return {
      ok: false,
      error: 'internal_error',
      message: 'Erro inesperado ao remover responsável. Tente novamente.',
    };
  }
}
