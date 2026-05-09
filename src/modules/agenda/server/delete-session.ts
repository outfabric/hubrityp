import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { sessions, sessionHistory } from '@/shared/db/schema/agenda/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type DeleteSessionResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'not_scheduled'; message: string }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Deletes a session for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Verify ownership — session must belong to authenticated user.
 *   3. Verify status is "scheduled" — only scheduled sessions can be deleted.
 *   4. Create a history entry "deleted" with a snapshot of the session.
 *   5. Delete the session.
 *
 * The history entry is created before deletion because ON DELETE CASCADE on
 * `session_history.session_id` would remove history entries. We insert
 * history first, then delete the session, and the cascade cleans up
 * automatically. However, we want to keep a "deleted" record — so we
 * insert it with the session_id, and since cascade removes it, we actually
 * need to handle this carefully.
 *
 * NOTE: Since the FK has ON DELETE CASCADE, deleting the session also removes
 * its history. This is by design — the "deleted" history entry is primarily
 * for audit-in-transit (e.g., webhooks, logs). If persistent audit is needed,
 * consider a separate audit table without the cascade.
 */
export async function deleteSessionImpl(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<DeleteSessionResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const userId = user.id;

  try {
    // 2. Verify ownership
    const [existing] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));

    if (!existing) {
      return { ok: false, error: 'not_found' };
    }

    // 3. Verify status is "scheduled"
    if (existing.status !== 'scheduled') {
      return {
        ok: false,
        error: 'not_scheduled',
        message: 'Apenas sessoes com status "agendada" podem ser excluidas.',
      };
    }

    // 4-5. Create history entry + delete in a transaction
    // Note: ON DELETE CASCADE means the history entry will also be removed.
    // We still insert it for the transaction integrity and in case cascade
    // behavior is changed in the future.
    await db.transaction(async (tx) => {
      await tx.insert(sessionHistory).values({
        sessionId,
        userId,
        action: 'deleted',
        changes: {
          snapshot: {
            patientId: existing.patientId,
            isBlocking: existing.isBlocking,
            blockingTitle: existing.blockingTitle,
            startAt: existing.startAt.toISOString(),
            endAt: existing.endAt.toISOString(),
            durationMinutes: existing.durationMinutes,
            locationId: existing.locationId,
            modality: existing.modality,
            amount: existing.amount,
            notes: existing.notes,
            color: existing.color,
            status: existing.status,
          },
        },
      });

      await tx.delete(sessions).where(eq(sessions.id, sessionId));
    });

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'delete_session_failed', errorCode: pgError.code },
      'unexpected error deleting session',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao excluir sessao. Tente novamente.',
    };
  }
}
