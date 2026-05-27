import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { assertAiConsentActive } from '@/modules/ai-transcription';
import { toggleRecordingInputSchema } from '@/modules/telepsicologia/lib/schemas';
import { getStreamClient } from '@/modules/telepsicologia/server/stream-client';
import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import {
  videoRecordings,
  videoRooms,
  videoSessionLogs,
} from '@/shared/db/schema/telepsicologia/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ToggleRecordingResult =
  | { ok: true }
  | { ok: false; code: 'UNAUTHENTICATED' }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]> }
  | { ok: false; code: 'ROOM_NOT_FOUND' }
  | { ok: false; code: 'CONSENT_INVALID' }
  | { ok: false; code: 'UNKNOWN'; message: string };

// ---------------------------------------------------------------------------
// MVP transition strategy — dual consent gate
// ---------------------------------------------------------------------------
// This file enforces TWO independent consent checks before allowing a
// recording to start:
//
// 1. Legacy gate: `patients.recording_consent_signed_at IS NOT NULL` AND
//    `patients.recording_consent_revoked_at IS NULL`. This predicate existed
//    before the AI-transcription feature and will be removed in a future
//    cleanup change (`ai-transcription-consent-cleanup`).
//
// 2. AI consent gate: `assertAiConsentActive({ userId, patientId })` must
//    return `ok: true`. This queries `consent_terms` for `kind = 'ai_recording'`.
//
// BOTH gates must pass for recording to proceed. If the legacy gate passes
// but the AI gate fails, the psychologist needs to generate the AI consent
// term for the patient (see OpenSpec change `ai-transcription-consent`).
//
// Design decision: D6 in `openspec/changes/ai-transcription-audio-upload/design.md`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Starts or stops recording for a telepsychology video session.
 *
 * **Dual consent gate (MVP transition):** starting a recording requires BOTH
 * the legacy patient consent fields AND an active AI consent term. See the
 * transition strategy comment block above for rationale and cleanup plan.
 *
 * Flow:
 *   1. Authenticate via supabase.auth.getUser().
 *   2. Validate input (room_id, action: 'start' | 'stop').
 *   3. Verify room ownership (user_id = auth.uid()).
 *   4. If start: resolve patientId from room → session → patient.
 *   5. If start: check BOTH consent gates:
 *      a. Legacy: signed_at IS NOT NULL AND revoked_at IS NULL.
 *      b. AI: assertAiConsentActive returns ok: true.
 *      Return CONSENT_INVALID if either fails.
 *   6. If start: call Stream startRecording(), UPSERT video_recordings
 *      with status='recording', UPDATE video_rooms SET recording_enabled=true,
 *      INSERT log event_type='recording_started'.
 *   7. If stop: call Stream stopRecording(), UPDATE video_recordings
 *      status='processing', UPDATE video_rooms SET recording_enabled=false,
 *      INSERT log event_type='recording_ended'.
 *   8. Return { ok: true }.
 */
export async function toggleRecordingImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<ToggleRecordingResult> {
  // 1. Authenticate — MUST be first, before any DB/Stream calls
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED' };
  }

  // 2. Validate input
  const parsed = toggleRecordingInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { room_id: roomId, action } = parsed.data;
  const userId = user.id;

  try {
    // 3. Verify room ownership — scoped by user_id to prevent IDOR.
    //    Also fetch sessionId and streamCallId for later use.
    const [room] = await db
      .select({
        id: videoRooms.id,
        sessionId: videoRooms.sessionId,
        streamCallId: videoRooms.streamCallId,
        status: videoRooms.status,
      })
      .from(videoRooms)
      .where(and(eq(videoRooms.id, roomId), eq(videoRooms.userId, userId)))
      .limit(1);

    if (!room) {
      return { ok: false, code: 'ROOM_NOT_FOUND' };
    }

    if (action === 'start') {
      return await handleStartRecording(room, userId);
    }

    return await handleStopRecording(room, userId);
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'toggle_recording_failed', errorCode: pgError.code },
      'unexpected error toggling recording',
    );
    return {
      ok: false,
      code: 'UNKNOWN',
      message: 'Erro inesperado ao alterar gravação. Tente novamente.',
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface RoomRow {
  id: string;
  sessionId: string;
  streamCallId: string;
  status: string;
}

/**
 * Handles the 'start' action: validates both consent gates, calls Stream,
 * and persists the recording state atomically.
 */
async function handleStartRecording(room: RoomRow, userId: string): Promise<ToggleRecordingResult> {
  // 4. Resolve patientId and check legacy consent in a single query.
  //    We select the patient row regardless of consent state so we can
  //    evaluate each gate independently and log the transitional case.
  const [patientRow] = await db
    .select({
      patientId: patients.id,
      recordingConsentSignedAt: patients.recordingConsentSignedAt,
      recordingConsentRevokedAt: patients.recordingConsentRevokedAt,
    })
    .from(videoRooms)
    .innerJoin(sessions, eq(videoRooms.sessionId, sessions.id))
    .innerJoin(patients, eq(sessions.patientId, patients.id))
    .where(and(eq(videoRooms.id, room.id), eq(videoRooms.userId, userId)))
    .limit(1);

  if (!patientRow) {
    // Room exists but session/patient link is broken — should not happen
    // under normal operation but fail closed.
    return { ok: false, code: 'CONSENT_INVALID' };
  }

  // 5a. Legacy gate: recording_consent_signed_at IS NOT NULL
  //     AND recording_consent_revoked_at IS NULL.
  const legacyPass =
    patientRow.recordingConsentSignedAt !== null && patientRow.recordingConsentRevokedAt === null;

  // 5b. AI consent gate: assertAiConsentActive must return ok: true.
  const aiConsentResult = await assertAiConsentActive(
    { userId, patientId: patientRow.patientId },
    { db },
  );
  const aiPass = aiConsentResult.ok;

  // Log the transitional case where legacy is satisfied but the AI term
  // has not been generated yet — helps the psychologist understand why
  // recording is blocked after the dual-gate rollout.
  if (legacyPass && !aiPass) {
    logger.warn(
      {
        event: 'legacy_present_but_ai_term_missing',
        userId,
        patientId: patientRow.patientId,
        aiReason: aiConsentResult.ok ? undefined : aiConsentResult.reason,
      },
      'legacy consent present but AI consent term missing — recording blocked',
    );
  }

  if (!legacyPass || !aiPass) {
    return { ok: false, code: 'CONSENT_INVALID' };
  }

  // 6. Call Stream startRecording() — remote call stays outside the
  //    transaction because it cannot be rolled back.
  const streamClient = getStreamClient();
  const call = streamClient.video.call('default', room.streamCallId);
  await call.startRecording({ recording_type: 'audio' });

  // Persist recording state atomically
  await db.transaction(async (tx) => {
    // UPSERT video_recordings: check for existing row, then update or insert.
    // No unique constraint on session_id, so we use check-then-act inside
    // the transaction for atomicity.
    const [existingRecording] = await tx
      .select({ id: videoRecordings.id })
      .from(videoRecordings)
      .where(and(eq(videoRecordings.sessionId, room.sessionId), eq(videoRecordings.userId, userId)))
      .limit(1);

    if (existingRecording) {
      await tx
        .update(videoRecordings)
        .set({ status: 'recording', recordedAt: new Date() })
        .where(eq(videoRecordings.id, existingRecording.id));
    } else {
      await tx.insert(videoRecordings).values({
        sessionId: room.sessionId,
        userId,
        status: 'recording',
        recordedAt: new Date(),
      });
    }

    // UPDATE video_rooms SET recording_enabled=true
    await tx
      .update(videoRooms)
      .set({ recordingEnabled: true })
      .where(and(eq(videoRooms.id, room.id), eq(videoRooms.userId, userId)));

    // INSERT log event_type='recording_started'
    await tx.insert(videoSessionLogs).values({
      sessionId: room.sessionId,
      userId,
      eventType: 'recording_started',
    });
  });

  return { ok: true };
}

/**
 * Handles the 'stop' action: calls Stream, and persists the recording
 * state atomically.
 */
async function handleStopRecording(room: RoomRow, userId: string): Promise<ToggleRecordingResult> {
  // 6. Call Stream stopRecording() — remote call stays outside the
  //    transaction because it cannot be rolled back.
  const streamClient = getStreamClient();
  const call = streamClient.video.call('default', room.streamCallId);
  await call.stopRecording({ recording_type: 'audio' });

  // Persist recording state atomically
  await db.transaction(async (tx) => {
    // UPDATE video_recordings SET status='processing' for this session
    await tx
      .update(videoRecordings)
      .set({ status: 'processing' })
      .where(
        and(
          eq(videoRecordings.sessionId, room.sessionId),
          eq(videoRecordings.userId, userId),
          eq(videoRecordings.status, 'recording'),
        ),
      );

    // UPDATE video_rooms SET recording_enabled=false
    await tx
      .update(videoRooms)
      .set({ recordingEnabled: false })
      .where(and(eq(videoRooms.id, room.id), eq(videoRooms.userId, userId)));

    // INSERT log event_type='recording_ended'
    await tx.insert(videoSessionLogs).values({
      sessionId: room.sessionId,
      userId,
      eventType: 'recording_ended',
    });
  });

  return { ok: true };
}
