import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray } from 'drizzle-orm';

import { createEvolutionImpl } from '@/modules/medical-records';
import { db } from '@/shared/db/client';
import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';

import { assertAiConsentActive } from '../lib/consent';
import { createTranscriptionLogger } from '../lib/logger';
import {
  GeneratedNoteSchema,
  SaveTranscriptionToProntuarioInputSchema,
  type SaveTranscriptionToProntuarioResult,
} from '../lib/review-schemas';
import { serializeNoteAsEvolution } from '../lib/serialize-note';

// Statuses from which a transcription may be committed to the prontuario.
const SAVEABLE_STATUSES = ['ready', 'reviewed'] as const;

// Name of the partial UNIQUE index that enforces one evolution per AI
// transcription (see the medical-records schema + its migration).
const AI_TRANSCRIPTION_UNIQUE_INDEX = 'idx_evolutions_ai_transcription_id_unique';

/**
 * Detects a Postgres unique-violation (`23505`) on the AI-transcription backlink
 * index anywhere in the error's `cause` chain. The `postgres` (postgres.js)
 * driver exposes the violated constraint as `constraint_name` (not `constraint`),
 * and Drizzle may wrap the driver error so the pg fields live on `err.cause` —
 * we walk the chain and check both field spellings to be safe.
 */
function isAiTranscriptionUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    const candidate = current as {
      code?: unknown;
      constraint_name?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    const constraintName =
      typeof candidate.constraint_name === 'string'
        ? candidate.constraint_name
        : typeof candidate.constraint === 'string'
          ? candidate.constraint
          : undefined;
    if (candidate.code === '23505' && constraintName === AI_TRANSCRIPTION_UNIQUE_INDEX) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/**
 * Commits a reviewed AI note to the patient's prontuario as a flagged
 * evolution, then marks the transcription as reviewed+saved.
 *
 * Flow:
 *   1. Authenticate via `getUser`.
 *   2. Zod-validate — `reviewedChecked` MUST be literal `true`; otherwise the
 *      parse fails and we return `MUST_REVIEW` WITHOUT any DB access.
 *   3. Re-read the row (owner-scoped): require `status IN ('ready','reviewed')`
 *      AND `saved_to_prontuario = false`. Missing/foreign row → `NOT_FOUND`;
 *      already-saved row → `ALREADY_SAVED`.
 *   4. Validate the stored `generated_note` JSONB; drift → `SAVE_FAILED`.
 *   5. `createEvolutionImpl({ aiAssisted: true, aiTranscriptionId })` — this
 *      runs its own internal transaction (evolution + v1 + audit row). If it
 *      throws or returns `!ok`, we stop here and never touch the transcription
 *      row, so no partial state is left behind.
 *   6. UPDATE the transcription, idempotency-guarded by `saved_to_prontuario =
 *      false` in the WHERE clause. A racing second writer that already flipped
 *      the flag matches zero rows; we then surface `ALREADY_SAVED` rather than
 *      orphaning the freshly created evolution.
 *
 * Security: `userId` from session; ownership enforced in every WHERE clause
 * (IDOR-safe); no clinical content logged.
 */
export async function saveTranscriptionToProntuarioImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<SaveTranscriptionToProntuarioResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;
  const log = createTranscriptionLogger({ userId });

  // 2. Validate input — `reviewedChecked` literal `true` is mandatory.
  const parsed = SaveTranscriptionToProntuarioInputSchema.safeParse(input);
  if (!parsed.success) {
    log.debug({ event: 'save_to_prontuario_must_review' });
    return { ok: false, code: 'MUST_REVIEW' };
  }

  const { transcriptionId } = parsed.data;

  // 3. Re-read the row, owner-scoped and gated on a saveable status.
  const [row] = await db
    .select({
      id: aiTranscriptions.id,
      patientId: aiTranscriptions.patientId,
      sessionId: aiTranscriptions.sessionId,
      generatedNote: aiTranscriptions.generatedNote,
      savedToProntuario: aiTranscriptions.savedToProntuario,
    })
    .from(aiTranscriptions)
    .where(
      and(
        eq(aiTranscriptions.id, transcriptionId),
        eq(aiTranscriptions.userId, userId),
        inArray(aiTranscriptions.status, [...SAVEABLE_STATUSES]),
      ),
    )
    .limit(1);

  if (!row) {
    log.debug({ event: 'save_to_prontuario_not_found', transcriptionId });
    return { ok: false, code: 'NOT_FOUND' };
  }

  if (row.savedToProntuario) {
    log.debug({ event: 'save_to_prontuario_already_saved', transcriptionId });
    return { ok: false, code: 'ALREADY_SAVED' };
  }

  // 4. The stored draft must still match the current schema to be committed.
  const noteParsed = GeneratedNoteSchema.safeParse(row.generatedNote);
  if (!noteParsed.success) {
    log.warn({ event: 'save_to_prontuario_note_drift', transcriptionId });
    return { ok: false, code: 'SAVE_FAILED' };
  }

  // 4b. Re-verify AI consent for the patient before committing AI-derived
  // content into the permanent clinical record. A `ready` note survives
  // mid-flight revocation (RN-10.06), but persisting it to the prontuario is a
  // fresh write of AI-sourced data, so it must respect the current consent
  // state — same guarantee `confirmAudioUpload` applies at ingest time.
  const consent = await assertAiConsentActive({ userId, patientId: row.patientId }, { db });
  if (!consent.ok) {
    log.debug({ event: 'save_to_prontuario_consent_inactive', transcriptionId });
    return { ok: false, code: 'SAVE_FAILED' };
  }

  // 5. Create the flagged evolution first. `createEvolutionImpl` authenticates
  // and authorizes ownership itself; if it fails we abort before mutating the
  // transcription row (no rollback needed — nothing was written here).
  //
  // A concurrent writer racing on the SAME transcription with a NULL `sessionId`
  // (manual upload, so the per-session UNIQUE does not fire) can pass the
  // `saved_to_prontuario` read guard above and reach this insert too. The
  // partial UNIQUE index `idx_evolutions_ai_transcription_id_unique` makes the
  // database reject the loser's INSERT with a `23505` violation, which
  // `createEvolutionImpl` re-throws (its own catch only maps `session_id`
  // duplicates). We catch it here and surface `ALREADY_SAVED` — no orphaned
  // evolution is left behind, since the DB never committed the duplicate row.
  let evolutionResult: Awaited<ReturnType<typeof createEvolutionImpl>>;
  try {
    evolutionResult = await createEvolutionImpl(supabase, {
      patientId: row.patientId,
      sessionId: row.sessionId ?? undefined,
      templateType: 'livre',
      content: serializeNoteAsEvolution(noteParsed.data),
      aiAssisted: true,
      aiTranscriptionId: transcriptionId,
    });
  } catch (err: unknown) {
    if (isAiTranscriptionUniqueViolation(err)) {
      log.warn({ event: 'save_to_prontuario_concurrent_evolution', transcriptionId });
      return { ok: false, code: 'ALREADY_SAVED' };
    }
    throw err;
  }

  if (!evolutionResult.ok) {
    log.warn({
      event: 'save_to_prontuario_evolution_failed',
      transcriptionId,
      evolutionCode: evolutionResult.code,
    });
    return { ok: false, code: 'SAVE_FAILED' };
  }

  // 6. Flip the transcription to reviewed+saved. The `saved_to_prontuario =
  // false` predicate makes this idempotent under concurrency.
  const updated = await db
    .update(aiTranscriptions)
    .set({
      status: 'reviewed',
      savedToProntuario: true,
      evolutionId: evolutionResult.id,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiTranscriptions.id, transcriptionId),
        eq(aiTranscriptions.userId, userId),
        eq(aiTranscriptions.savedToProntuario, false),
      ),
    )
    .returning({ id: aiTranscriptions.id });

  if (updated.length === 0) {
    // A concurrent writer won the race and already saved. The evolution we
    // created is a duplicate; surface ALREADY_SAVED so the UI does not double
    // count. (Per the spec the second caller is rejected.)
    log.warn({ event: 'save_to_prontuario_concurrent_save', transcriptionId });
    return { ok: false, code: 'ALREADY_SAVED' };
  }

  log.info({ event: 'save_to_prontuario_success', transcriptionId });
  return { ok: true, evolutionId: evolutionResult.id };
}
