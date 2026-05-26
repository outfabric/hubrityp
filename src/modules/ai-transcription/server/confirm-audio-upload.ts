'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';
import { serverEnv } from '@/shared/env';

import { inngest } from '../inngest/client';
import { AI_TRANSCRIPTION_EVENTS, audioUploadedEventSchema } from '../inngest/events';
import { ConfirmAudioUploadInputSchema } from '../lib/audio-input-schemas';
import type { TranscriptionId } from '../lib/branded-types';
import { assertAiConsentActive } from '../lib/consent';
import { createTranscriptionLogger } from '../lib/logger';

import { validateAudioMagicNumbers } from './validators/mime';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ConfirmAudioUploadResult =
  | { ok: true; transcriptionId: TranscriptionId }
  | {
      ok: false;
      code:
        | 'UNAUTHORIZED'
        | 'NOT_FOUND'
        | 'CONSENT_INACTIVE'
        | 'INVALID_MIME'
        | 'SIZE_MISMATCH'
        | 'ALREADY_CONFIRMED';
    };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** First N bytes to download for magic-number validation. */
const MAGIC_HEADER_BYTES = 8192;

/** Allowable relative deviation between declared and actual size. */
const SIZE_TOLERANCE_FRACTION = 0.05;

/** File extensions produced by `requestAudioUploadUrl`. */
const POSSIBLE_EXTENSIONS = ['mp3', 'm4a', 'wav', 'webm'] as const;

/**
 * Reverse map from file extension to the declared content type used during
 * upload. Used to reconstruct the declared MIME for magic-number comparison.
 */
const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  webm: 'audio/webm',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Discovers the uploaded object by probing each known extension.
 * Returns the key, extension, and raw Blob if found; null otherwise.
 */
async function discoverUploadedObject(
  supabase: SupabaseClient,
  bucket: string,
  userId: string,
  transcriptionId: string,
): Promise<{ objectKey: string; ext: string; blob: Blob } | null> {
  for (const ext of POSSIBLE_EXTENSIONS) {
    const candidateKey = `${userId}/${transcriptionId}.${ext}`;
    const { data } = await supabase.storage.from(bucket).download(candidateKey);

    if (data) {
      return { objectKey: candidateKey, ext, blob: data };
    }
  }
  return null;
}

/**
 * Marks a transcription row as failed with a specific error code.
 * Defense-in-depth: scoped to user_id = caller.
 */
async function markFailed(
  transcriptionId: string,
  userId: string,
  errorCode: string,
): Promise<void> {
  await db
    .update(aiTranscriptions)
    .set({
      status: 'failed',
      errorCode,
      updatedAt: new Date(),
    })
    .where(and(eq(aiTranscriptions.id, transcriptionId), eq(aiTranscriptions.userId, userId)));
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Validates the uploaded audio object and finalizes the transcription row.
 *
 * Flow:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. Validate input with Zod.
 *   3. SELECT the row — require `status='pending'` AND `user_id = caller`.
 *   4. Re-validate AI consent for the row's patient (consent may have been
 *      revoked between `requestAudioUploadUrl` and `confirmAudioUpload`).
 *   5. Discover the uploaded object key by probing known extensions.
 *   6. Download for magic-number validation (first 8KB).
 *   7. Run `validateAudioMagicNumbers` — if mismatch, mark failed.
 *   8. Verify object size against declared size (±5% tolerance) and MAX.
 *   9. UPDATE the row with the validated metadata.
 *  10. Dispatch `ai-transcription/audio.uploaded` event (fire-and-forget).
 *  11. Return success.
 *
 * Security:
 *   - `userId` always comes from the session, never from client input.
 *   - Row ownership is enforced via WHERE `user_id = caller` (defense-in-depth
 *     on top of RLS).
 *   - Object key uses UUIDs only — no PII.
 *   - Errors are sanitized: no stack traces, no table names, no SQL.
 */
export async function confirmAudioUploadImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<ConfirmAudioUploadResult> {
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
  const parsed = ConfirmAudioUploadInputSchema.safeParse(input);
  if (!parsed.success) {
    log.debug({ event: 'confirm_upload_validation_failed' });
    return { ok: false, code: 'NOT_FOUND' };
  }

  const { transcriptionId, audioDurationSeconds } = parsed.data;

  // 3. SELECT the row — only rows owned by the caller
  const [row] = await db
    .select({
      id: aiTranscriptions.id,
      userId: aiTranscriptions.userId,
      patientId: aiTranscriptions.patientId,
      status: aiTranscriptions.status,
      audioObjectKey: aiTranscriptions.audioObjectKey,
      audioSizeBytes: aiTranscriptions.audioSizeBytes,
    })
    .from(aiTranscriptions)
    .where(and(eq(aiTranscriptions.id, transcriptionId), eq(aiTranscriptions.userId, userId)))
    .limit(1);

  if (!row) {
    log.debug({ event: 'confirm_upload_row_not_found', transcriptionId });
    return { ok: false, code: 'NOT_FOUND' };
  }

  // Double-confirm idempotency: if the row already has an audio_object_key
  // set, or is no longer pending, a previous confirm already processed it.
  if (row.audioObjectKey || row.status !== 'pending') {
    log.debug({
      event: 'confirm_upload_already_processed',
      transcriptionId,
      currentStatus: row.status,
    });
    return { ok: false, code: 'ALREADY_CONFIRMED' };
  }

  // 4. Re-validate AI consent for the row's patient
  const consentResult = await assertAiConsentActive({ userId, patientId: row.patientId }, { db });

  if (!consentResult.ok) {
    log.debug({
      event: 'confirm_upload_consent_revoked',
      transcriptionId,
      patientId: row.patientId,
    });

    await markFailed(transcriptionId, userId, 'consent_revoked_during_upload');

    // TODO: Schedule object deletion. The future discard cron will pick up
    // failed rows and delete the Storage objects. For now, setting
    // status='failed' is sufficient — the object will be cleaned up by the
    // retention policy.

    return { ok: false, code: 'CONSENT_INACTIVE' };
  }

  // 5. Discover the uploaded object
  const bucket = serverEnv.AI_TRANSCRIPTION_BUCKET;
  const discovered = await discoverUploadedObject(supabase, bucket, userId, transcriptionId);

  if (!discovered) {
    log.debug({ event: 'confirm_upload_object_not_found', transcriptionId });
    return { ok: false, code: 'NOT_FOUND' };
  }

  const { objectKey, ext, blob } = discovered;

  // 6. Extract first 8KB for magic-number validation
  const arrayBuffer = await blob.arrayBuffer();
  const fullBuffer = Buffer.from(arrayBuffer);
  const headerBuffer = fullBuffer.subarray(0, MAGIC_HEADER_BYTES);

  // Derive the declared content type from the extension (reverse of the
  // mapping used in `requestAudioUploadUrl` when generating the signed URL).
  const declaredContentType = EXT_TO_CONTENT_TYPE[ext] ?? 'application/octet-stream';

  // 7. Run magic-number validation
  const mimeResult = await validateAudioMagicNumbers(headerBuffer, declaredContentType);

  if (!mimeResult.ok) {
    log.debug({
      event: 'confirm_upload_mime_mismatch',
      transcriptionId,
      reason: mimeResult.reason,
    });

    await markFailed(transcriptionId, userId, 'invalid_mime');

    // TODO: Schedule object deletion — same note as above.

    return { ok: false, code: 'INVALID_MIME' };
  }

  // 8. Verify object size
  const actualSize = fullBuffer.length;
  const maxBytes = serverEnv.AI_TRANSCRIPTION_MAX_AUDIO_MB * 1024 * 1024;

  if (actualSize > maxBytes) {
    log.debug({
      event: 'confirm_upload_size_exceeded',
      transcriptionId,
      actualSize,
      maxBytes,
    });

    await markFailed(transcriptionId, userId, 'size_exceeded');
    return { ok: false, code: 'SIZE_MISMATCH' };
  }

  // Check declared vs actual size — ±5% tolerance
  const declaredSize = row.audioSizeBytes;
  if (declaredSize !== null && declaredSize > 0) {
    const deviation = Math.abs(actualSize - declaredSize) / declaredSize;
    if (deviation > SIZE_TOLERANCE_FRACTION) {
      log.debug({
        event: 'confirm_upload_size_deviation',
        transcriptionId,
        actualSize,
        declaredSize,
        deviation,
      });

      await markFailed(transcriptionId, userId, 'size_mismatch');
      return { ok: false, code: 'SIZE_MISMATCH' };
    }
  }

  // 9. UPDATE the row with validated metadata
  await db
    .update(aiTranscriptions)
    .set({
      audioObjectKey: objectKey,
      audioSizeBytes: actualSize,
      audioDurationSeconds: audioDurationSeconds,
      updatedAt: new Date(),
    })
    .where(and(eq(aiTranscriptions.id, transcriptionId), eq(aiTranscriptions.userId, userId)));

  // 10. Dispatch event (fire-and-forget)
  try {
    const eventPayload = audioUploadedEventSchema.parse({
      transcriptionId,
      userId,
      patientId: row.patientId,
      source: 'manual_upload',
    });

    await inngest.send({
      name: AI_TRANSCRIPTION_EVENTS.AUDIO_UPLOADED,
      data: eventPayload,
    });
  } catch (inngestErr: unknown) {
    // Fire-and-forget: log without PII, do not fail the action
    const errMsg = inngestErr instanceof Error ? inngestErr.message : 'unknown';
    log.error(
      {
        event: 'inngest_send_failed',
        eventName: AI_TRANSCRIPTION_EVENTS.AUDIO_UPLOADED,
        transcriptionId,
        error: errMsg,
      },
      'failed to send ai-transcription/audio.uploaded event',
    );
  }

  log.info({ event: 'confirm_upload_success', transcriptionId });

  // 11. Return success
  return {
    ok: true,
    transcriptionId: transcriptionId as TranscriptionId,
  };
}
