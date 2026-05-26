'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { serverEnv } from '@/shared/env';
import { enforceRateLimit } from '@/shared/lib/rate-limit/postgres';

import { CONTENT_TYPE_TO_EXT, RequestAudioUploadUrlInputSchema } from '../lib/audio-input-schemas';
import type { TranscriptionId } from '../lib/branded-types';
import { assertAiConsentActive } from '../lib/consent';
import { createTranscriptionLogger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type RequestAudioUploadUrlResult =
  | {
      ok: true;
      transcriptionId: TranscriptionId;
      uploadUrl: string;
      expiresAt: Date;
      objectKey: string;
    }
  | {
      ok: false;
      code:
        | 'UNAUTHORIZED'
        | 'NOT_FOUND'
        | 'CONSENT_INACTIVE'
        | 'CONTENT_TYPE_NOT_ALLOWED'
        | 'SIZE_EXCEEDED'
        | 'RATE_LIMITED';
    };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Rate limit: 6 requests per 60-second window per user. */
const RATE_LIMIT_MAX = 6;
const RATE_LIMIT_WINDOW_SECONDS = 60;

/** Signed upload URL TTL in seconds (5 minutes). */
const SIGNED_URL_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Generates a signed upload URL for manual audio upload.
 *
 * Flow:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. Validate input with Zod.
 *   3. Verify patient ownership (defense-in-depth: explicit check + RLS).
 *   4. If sessionId provided, verify session belongs to caller AND patient.
 *   5. Assert AI consent is active for this patient.
 *   6. Validate contentType is in the allowlist (Zod already does this, but
 *      belt-and-suspenders for the extension mapping).
 *   7. Validate sizeBytes against the configured maximum.
 *   8. Enforce rate limit (6 req/min/user).
 *   9. INSERT a row with status='pending', source='manual_upload'.
 *  10. Generate signed upload URL via Supabase Storage.
 *  11. Return URL + metadata.
 *
 * Security:
 *   - `userId` always comes from the session, never from client input.
 *   - Patient/session ownership is verified via explicit WHERE clauses.
 *   - Object key uses UUIDs only — no PII.
 *   - Errors are sanitized: no stack traces, no table names, no SQL.
 */
export async function requestAudioUploadUrlImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<RequestAudioUploadUrlResult> {
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
  const parsed = RequestAudioUploadUrlInputSchema.safeParse(input);
  if (!parsed.success) {
    log.debug({ event: 'request_upload_url_validation_failed' });
    // Determine which field failed for a more specific error code
    const fieldErrors = parsed.error.flatten().fieldErrors;
    if (fieldErrors.contentType) {
      return { ok: false, code: 'CONTENT_TYPE_NOT_ALLOWED' };
    }
    // Generic validation failure for other fields — map to closest code
    return { ok: false, code: 'NOT_FOUND' };
  }

  const { patientId, sessionId, contentType, sizeBytes } = parsed.data;

  // 3. Verify patient belongs to the authenticated user
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    log.debug({ event: 'request_upload_url_patient_not_found', patientId });
    return { ok: false, code: 'NOT_FOUND' };
  }

  // 4. If sessionId is provided, verify it belongs to the same caller AND patient
  if (sessionId !== null) {
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.userId, userId),
          eq(sessions.patientId, patientId),
        ),
      )
      .limit(1);

    if (!session) {
      log.debug({ event: 'request_upload_url_session_not_found' });
      return { ok: false, code: 'NOT_FOUND' };
    }
  }

  // 5. Assert AI consent is active
  const consentResult = await assertAiConsentActive({ userId, patientId }, { db });
  if (!consentResult.ok) {
    log.debug({ event: 'request_upload_url_consent_inactive', patientId });
    return { ok: false, code: 'CONSENT_INACTIVE' };
  }

  // 6. Content type is validated by Zod enum, but confirm extension mapping
  // exists as a safety net.
  const ext = CONTENT_TYPE_TO_EXT[contentType];
  if (!ext) {
    return { ok: false, code: 'CONTENT_TYPE_NOT_ALLOWED' };
  }

  // 7. Validate size against the configured maximum
  const maxBytes = serverEnv.AI_TRANSCRIPTION_MAX_AUDIO_MB * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    log.debug({ event: 'request_upload_url_size_exceeded', sizeBytes, maxBytes });
    return { ok: false, code: 'SIZE_EXCEEDED' };
  }

  // 8. Enforce rate limit (6 requests / minute / user)
  const rateLimitResult = await enforceRateLimit({
    key: `audio-upload:${userId}`,
    max: RATE_LIMIT_MAX,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
  });

  if (!rateLimitResult.allowed) {
    log.debug({ event: 'request_upload_url_rate_limited', userId });
    return { ok: false, code: 'RATE_LIMITED' };
  }

  // 9. INSERT a new ai_transcriptions row with status='pending'
  const [row] = await db
    .insert(aiTranscriptions)
    .values({
      userId,
      patientId,
      sessionId,
      source: 'manual_upload',
      status: 'pending',
      audioSizeBytes: sizeBytes,
      // audio_object_key is set on confirm, not here
    })
    .returning({ id: aiTranscriptions.id });

  if (!row) {
    log.error({ event: 'request_upload_url_insert_failed' });
    return { ok: false, code: 'NOT_FOUND' };
  }

  const transcriptionId = row.id as TranscriptionId;

  // 10. Generate signed upload URL
  // Object key: <userId>/<transcriptionId>.<ext> — UUIDs only, no PII
  const objectKey = `${userId}/${transcriptionId}.${ext}`;

  const { data, error } = await supabase.storage
    .from(serverEnv.AI_TRANSCRIPTION_BUCKET)
    .createSignedUploadUrl(objectKey, {
      upsert: false,
    });

  if (error || !data) {
    log.error({ event: 'request_upload_url_storage_error', transcriptionId });
    // Clean up the inserted row on storage failure
    await db
      .delete(aiTranscriptions)
      .where(and(eq(aiTranscriptions.id, transcriptionId), eq(aiTranscriptions.userId, userId)));
    return { ok: false, code: 'NOT_FOUND' };
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000);

  log.info({ event: 'request_upload_url_success', transcriptionId });

  // 11. Return URL + metadata
  return {
    ok: true,
    transcriptionId,
    uploadUrl: data.signedUrl,
    expiresAt,
    objectKey,
  };
}
