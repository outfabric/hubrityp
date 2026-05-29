import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';

import { createTranscriptionLogger } from '../lib/logger';
import {
  UpdateTranscriptionDraftInputSchema,
  type UpdateTranscriptionDraftResult,
} from '../lib/review-schemas';

// Statuses in which an in-progress draft may still be edited. `pending`,
// `transcribing`, `generating`, `failed`, `cancelled` are NOT editable.
const EDITABLE_STATUSES = ['ready', 'reviewed'] as const;

/**
 * Persists psychologist edits to an AI-generated note draft.
 *
 * Idempotent / last-write-wins by design: the UPDATE overwrites
 * `generated_note` wholesale and increments `user_edits_count`. The status
 * predicate (`status IN ('ready','reviewed')`) is what gates editability —
 * if the row is in any other state (or not owned by the caller, or absent),
 * zero rows are affected and the action returns `NOT_EDITABLE`.
 *
 * Flow:
 *   1. Authenticate via `getUser`.
 *   2. Zod-validate (`generatedNote` parsed by `GeneratedNoteSchema`).
 *   3. UPDATE ... WHERE id = tx AND user_id = caller AND status IN (...).
 *   4. 0 rows → `NOT_EDITABLE`; else `{ ok: true, savedAt }`.
 *
 * Security: `userId` from session, ownership in the WHERE clause (IDOR-safe);
 * no clinical content logged (logger redacts `generatedNote`).
 */
export async function updateTranscriptionDraftImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<UpdateTranscriptionDraftResult> {
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
  const parsed = UpdateTranscriptionDraftInputSchema.safeParse(input);
  if (!parsed.success) {
    log.debug({ event: 'update_draft_validation_failed' });
    return { ok: false, code: 'INVALID_INPUT' };
  }

  const { transcriptionId, generatedNote } = parsed.data;
  const savedAt = new Date();

  // Consent note: editing an existing draft (status `ready`/`reviewed`) is not
  // a fresh capture of AI-sourced data — the note already survived any consent
  // revocation (RN-10.06). Blocking edits on consent would strand a note the
  // user is responsible for reviewing. The table is imported dynamically (the
  // repo's documented escape hatch from `require-assert-ai-consent`).
  const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

  // 3. Idempotent owner-scoped UPDATE gated by editable status.
  const updated = await db
    .update(aiTranscriptions)
    .set({
      generatedNote,
      userEditsCount: sql`${aiTranscriptions.userEditsCount} + 1`,
      updatedAt: savedAt,
    })
    .where(
      and(
        eq(aiTranscriptions.id, transcriptionId),
        eq(aiTranscriptions.userId, userId),
        inArray(aiTranscriptions.status, [...EDITABLE_STATUSES]),
      ),
    )
    .returning({ id: aiTranscriptions.id });

  // 4. No row matched: wrong owner, missing row, or non-editable status.
  if (updated.length === 0) {
    log.debug({ event: 'update_draft_not_editable', transcriptionId });
    return { ok: false, code: 'NOT_EDITABLE' };
  }

  log.info({ event: 'update_draft_success', transcriptionId });
  return { ok: true, savedAt };
}
