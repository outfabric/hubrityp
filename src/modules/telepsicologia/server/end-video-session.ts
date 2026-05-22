import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { videoTokenInputSchema } from '@/modules/telepsicologia/lib/schemas';
import { getStreamClient } from '@/modules/telepsicologia/server/stream-client';
import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { videoRooms, videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type EndVideoSessionResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'room_not_found' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Ends a video session: terminates the Stream call, updates room + session
 * status, and logs the event.
 *
 * Idempotent: if the room is already ended, returns { ok: true } without
 * making further changes.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input with videoTokenInputSchema (room_id: UUID).
 *   3. Verify room ownership (user_id = auth.uid()).
 *   4. Idempotent: if room is already ended, return success.
 *   5. End Stream call (try/catch — call may already be ended).
 *   6. UPDATE video_rooms SET status='ended'.
 *   7. UPDATE sessions SET status='done', updated_at=now() WHERE id=room.session_id AND user_id=auth.uid().
 *   8. INSERT video_session_logs event_type='room_ended'.
 *   9. Return { ok: true }.
 */
export async function endVideoSessionImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<EndVideoSessionResult> {
  // 1. Authenticate — MUST be first, before any DB/Stream calls
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input — reuses the same schema as getVideoToken (room_id UUID)
  const parsed = videoTokenInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { room_id: roomId } = parsed.data;
  const userId = user.id;

  try {
    // 3. Verify room ownership — scoped by user_id to prevent IDOR
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
      return { ok: false, error: 'room_not_found' };
    }

    // 4. Idempotent: if the room is already ended, return success
    if (room.status === 'ended') {
      return { ok: true };
    }

    // 5. End Stream call — wrapped in try/catch because the call may
    //    already be ended on Stream's side (e.g., timeout, manual end).
    try {
      const streamClient = getStreamClient();
      const call = streamClient.video.call('default', room.streamCallId);
      await call.end();
    } catch {
      // Log but do not fail — Stream call may already be ended or the
      // service may be temporarily unavailable. Our DB is the source of
      // truth for room status.
      logger.warn(
        { event: 'stream_end_call_failed', roomId: room.id },
        'Stream call end failed (may already be ended)',
      );
    }

    // 6-8. UPDATE video_rooms + UPDATE sessions + INSERT video_session_logs
    // atomically. The Stream `.end()` call (step 5) stays outside the
    // transaction because it is a remote call that cannot be rolled back.
    // Wrapping the DB writes prevents partial state (e.g., room marked
    // ended but clinical session still 'scheduled', or audit log missing).
    await db.transaction(async (tx) => {
      // 6. UPDATE video_rooms SET status='ended'
      await tx
        .update(videoRooms)
        .set({ status: 'ended' })
        .where(and(eq(videoRooms.id, roomId), eq(videoRooms.userId, userId)));

      // 7. UPDATE sessions SET status='done', updated_at=now()
      //    Scoped by user_id to prevent IDOR.
      await tx
        .update(sessions)
        .set({ status: 'done', updatedAt: sql`now()` })
        .where(and(eq(sessions.id, room.sessionId), eq(sessions.userId, userId)));

      // 8. INSERT video_session_logs event_type='room_ended'
      await tx.insert(videoSessionLogs).values({
        sessionId: room.sessionId,
        userId,
        eventType: 'room_ended',
      });
    });

    // 9. Return success
    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'end_video_session_failed', errorCode: pgError.code },
      'unexpected error ending video session',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao encerrar sessão. Tente novamente.',
    };
  }
}
