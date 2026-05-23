import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import type { AppDb } from '@/shared/db/client';
import { videoRooms, videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMetadata {
  realStart: Date | null;
  realEnd: Date | null;
  effectiveDurationMs: number | null;
  hadRecording: boolean;
  hadScreenShare: boolean;
}

export type CaptureSessionMetadataResult =
  | { ok: true; metadata: SessionMetadata }
  | { ok: false; reason: 'no_room' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Captures post-call metadata by analyzing `video_session_logs` for the
 * session's video room. Called after a session transitions to 'done' (from
 * `endVideoSession` or a webhook).
 *
 * Computes:
 *   - realStart: timestamp of the first `therapist_joined` event
 *   - realEnd: timestamp of the last `room_ended` or `room_expired` event
 *   - effectiveDurationMs: realEnd - realStart in milliseconds (null if either is missing)
 *   - hadRecording: true if any `recording_started` event exists
 *   - hadScreenShare: true if any `screen_share_started` event exists
 *
 * Inserts a `session_summary` log entry with the computed metadata.
 *
 * This function operates on a provided Drizzle client (or transaction) so
 * it can be composed into the caller's transaction when needed. The `userId`
 * is passed explicitly — it comes from the authenticated session, never from
 * client input.
 */
export async function captureSessionMetadata(
  tx: AppDb,
  sessionId: string,
  userId: string,
): Promise<CaptureSessionMetadataResult> {
  // Look up the video room for this session to ensure it exists. The room
  // ownership check (userId) prevents IDOR — only the owner's metadata is captured.
  const [room] = await tx
    .select({ id: videoRooms.id })
    .from(videoRooms)
    .where(and(eq(videoRooms.sessionId, sessionId), eq(videoRooms.userId, userId)))
    .limit(1);

  if (!room) {
    logger.warn(
      { event: 'capture_metadata_no_room', sessionId: sessionId.slice(0, 8) },
      'No video room found for session — skipping metadata capture',
    );
    return { ok: false, reason: 'no_room' };
  }

  // Fetch all relevant log entries for this session, ordered by created_at.
  // We only need event_type and created_at for the computation — no PII.
  const logs = await tx
    .select({
      eventType: videoSessionLogs.eventType,
      createdAt: videoSessionLogs.createdAt,
    })
    .from(videoSessionLogs)
    .where(
      and(
        eq(videoSessionLogs.sessionId, sessionId),
        eq(videoSessionLogs.userId, userId),
        inArray(videoSessionLogs.eventType, [
          'therapist_joined',
          'room_ended',
          'room_expired',
          'recording_started',
          'screen_share_started',
        ]),
      ),
    )
    .orderBy(asc(videoSessionLogs.createdAt));

  // Compute real start: first therapist_joined event
  const firstJoin = logs.find((l) => l.eventType === 'therapist_joined');
  const realStart = firstJoin?.createdAt ?? null;

  // Compute real end: last room_ended or room_expired event
  const endEvents = logs.filter(
    (l) => l.eventType === 'room_ended' || l.eventType === 'room_expired',
  );
  // Sort descending to get the last one (logs are already sorted asc, so take last)
  const lastEnd = endEvents.length > 0 ? endEvents[endEvents.length - 1]! : null;
  const realEnd = lastEnd?.createdAt ?? null;

  // Compute effective duration
  const effectiveDurationMs = realStart && realEnd ? realEnd.getTime() - realStart.getTime() : null;

  // Check for recording and screen share events
  const hadRecording = logs.some((l) => l.eventType === 'recording_started');
  const hadScreenShare = logs.some((l) => l.eventType === 'screen_share_started');

  const metadata: SessionMetadata = {
    realStart,
    realEnd,
    effectiveDurationMs,
    hadRecording,
    hadScreenShare,
  };

  // Insert session_summary log entry with computed metadata
  await tx.insert(videoSessionLogs).values({
    sessionId,
    userId,
    eventType: 'session_summary',
    metadata: {
      real_start: realStart?.toISOString() ?? null,
      real_end: realEnd?.toISOString() ?? null,
      effective_duration_ms: effectiveDurationMs,
      had_recording: hadRecording,
      had_screen_share: hadScreenShare,
    },
  });

  logger.info(
    {
      event: 'session_metadata_captured',
      sessionId: sessionId.slice(0, 8),
      hasDuration: effectiveDurationMs !== null,
    },
    'Post-call session metadata captured',
  );

  return { ok: true, metadata };
}
