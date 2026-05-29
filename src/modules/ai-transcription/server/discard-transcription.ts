'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { auditLog } from '@/shared/db/schema/medical-records/tables';

import { createTranscriptionLogger } from '../lib/logger';
import {
  DiscardTranscriptionInputSchema,
  type DiscardTranscriptionResult,
} from '../lib/review-schemas';

// A transcription may only be discarded while it is still awaiting review.
// Once `reviewed`, the action is a no-op (idempotent → ALREADY_REVIEWED).
const DISCARDABLE_STATUSES = ['ready', 'failed', 'cancelled'] as const;

/**
 * Marks a transcription as reviewed-without-saving (the psychologist chose to
 * write the evolution manually instead of keeping the AI draft).
 *
 * Flow:
 *   1. Authenticate via `getUser`.
 *   2. Zod-validate input.
 *   3. In a single transaction: owner-scoped UPDATE to `status='reviewed',
 *      saved_to_prontuario=false, reviewed_at=now()` gated on a discardable
 *      status. If a row is updated, write an `ai_transcription_discarded`
 *      audit-log entry (IDs only — never PII).
 *   4. 0 rows updated → distinguish "already reviewed" from "not found" by a
 *      cheap owner-scoped existence probe, so the second call is idempotent
 *      (`ALREADY_REVIEWED`) and a foreign/missing id is `NOT_FOUND`.
 *
 * Security: `userId` from session; ownership enforced in every WHERE clause
 * (IDOR-safe). The audit row carries only `user_id` and the transcription id.
 */
export async function discardTranscriptionImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<DiscardTranscriptionResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;
  const log = createTranscriptionLogger({ userId });

  // 2. Validate input
  const parsed = DiscardTranscriptionInputSchema.safeParse(input);
  if (!parsed.success) {
    log.debug({ event: 'discard_validation_failed' });
    return { ok: false, code: 'INVALID_INPUT' };
  }

  const { transcriptionId } = parsed.data;

  // Consent note: discarding marks a note reviewed-without-saving — the user is
  // choosing NOT to persist any AI-derived clinical data. There is nothing to
  // gate on consent here (no clinical write happens), and the action must work
  // even after revocation so the user can clear the queue. The table is
  // imported dynamically (the repo's documented escape hatch from
  // `require-assert-ai-consent`).
  const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

  // 3 + 4. UPDATE and audit in one transaction; resolve the no-op case after.
  const updatedId = await db.transaction(async (tx) => {
    const updated = await tx
      .update(aiTranscriptions)
      .set({
        status: 'reviewed',
        savedToProntuario: false,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiTranscriptions.id, transcriptionId),
          eq(aiTranscriptions.userId, userId),
          inArray(aiTranscriptions.status, [...DISCARDABLE_STATUSES]),
        ),
      )
      .returning({ id: aiTranscriptions.id });

    if (updated.length === 0) {
      return null;
    }

    // Audit trail — IDs only, no clinical content / PII.
    await tx.insert(auditLog).values({
      userId,
      action: 'ai_transcription_discarded',
      resourceType: 'ai_transcription',
      resourceId: transcriptionId,
      metadata: {},
    });

    return updated[0]!.id;
  });

  if (updatedId !== null) {
    log.info({ event: 'discard_success', transcriptionId });
    return { ok: true };
  }

  // No row updated: was it already reviewed, or does it not exist for us?
  const [existing] = await db
    .select({ id: aiTranscriptions.id })
    .from(aiTranscriptions)
    .where(and(eq(aiTranscriptions.id, transcriptionId), eq(aiTranscriptions.userId, userId)))
    .limit(1);

  if (!existing) {
    log.debug({ event: 'discard_not_found', transcriptionId });
    return { ok: false, code: 'NOT_FOUND' };
  }

  log.debug({ event: 'discard_already_reviewed', transcriptionId });
  return { ok: false, code: 'ALREADY_REVIEWED' };
}
