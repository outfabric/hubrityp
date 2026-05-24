import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

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
  | { ok: false; code: 'CONSENT_REQUIRED' }
  | { ok: false; code: 'UNKNOWN'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Starts or stops recording for a telepsychology video session.
 *
 * Flow:
 *   1. Authenticate via supabase.auth.getUser().
 *   2. Validate input (room_id, action: 'start' | 'stop').
 *   3. Verify room ownership (user_id = auth.uid()).
 *   4. If start: check patient recording consent — signed_at IS NOT NULL
 *      AND revoked_at IS NULL. Return CONSENT_REQUIRED if invalid.
 *   5. If start: call Stream startRecording(), UPSERT video_recordings
 *      with status='recording', UPDATE video_rooms SET recording_enabled=true,
 *      INSERT log event_type='recording_started'.
 *   6. If stop: call Stream stopRecording(), UPDATE video_recordings
 *      status='processing', UPDATE video_rooms SET recording_enabled=false,
 *      INSERT log event_type='recording_ended'.
 *   7. Return { ok: true }.
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
 * Handles the 'start' action: validates patient consent, calls Stream,
 * and persists the recording state atomically.
 */
async function handleStartRecording(room: RoomRow, userId: string): Promise<ToggleRecordingResult> {
  // 4. Check patient recording consent — join through sessions to patients.
  //    Consent is valid when recording_consent_signed_at IS NOT NULL
  //    AND recording_consent_revoked_at IS NULL.
  const [consentRow] = await db
    .select({
      recordingConsentSignedAt: patients.recordingConsentSignedAt,
    })
    .from(videoRooms)
    .innerJoin(sessions, eq(videoRooms.sessionId, sessions.id))
    .innerJoin(patients, eq(sessions.patientId, patients.id))
    .where(
      and(
        eq(videoRooms.id, room.id),
        eq(videoRooms.userId, userId),
        isNotNull(patients.recordingConsentSignedAt),
        isNull(patients.recordingConsentRevokedAt),
      ),
    )
    .limit(1);

  if (!consentRow) {
    return { ok: false, code: 'CONSENT_REQUIRED' };
  }

  // 5. Call Stream startRecording() — remote call stays outside the
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
