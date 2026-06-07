/**
 * Cascade room cancellation — Inngest function that cleans up an existing
 * video room when its session is cancelled.
 *
 * Triggered by `agenda/session.cancelled`. The deferred-creation design means a
 * room may not yet exist when a session is cancelled (most cancellations happen
 * before the `startAt - 1h` creation window); in that case there is nothing to
 * clean up and the function returns early. When a room DOES exist with status
 * IN ('pending', 'active'), the function:
 *
 *   1. Ends the Stream call (try/catch — may already be ended; failure is
 *      logged but does not block the DB cleanup).
 *   2. Updates the room status to 'expired'.
 *   3. Inserts a `room_expired` log entry in `video_session_logs`.
 *
 * The room lookup is scoped by BOTH `session_id` and `user_id` so a forged
 * event referencing someone else's session cannot touch another user's room.
 * The `userId` in the event payload comes from the Server Action that emitted
 * it, never from raw client input.
 *
 * Uses the Drizzle db client directly (not a Supabase client scoped to a user)
 * because this is a system job running in Inngest, not a user-initiated action.
 * The db client bypasses RLS — justified because there is no user session in
 * background jobs.
 *
 * Retries: 3 with backoff (Inngest default backoff strategy).
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { videoRooms, videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';

import { inngest } from './client';

// ---------------------------------------------------------------------------
// Event name constant
// ---------------------------------------------------------------------------

export const SESSION_CANCELLED_EVENT = 'agenda/session.cancelled' as const;

// ---------------------------------------------------------------------------
// Cleanable room statuses — only rooms not already ended/expired are touched
// ---------------------------------------------------------------------------

const CLEANABLE_STATUSES = ['pending', 'active'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal DB interface — `any` schema generic is intentional for testability. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

/** Minimal interface for the Stream video call `.end()` operation. */
interface StreamCallHandle {
  end: () => Promise<unknown>;
}

/** Minimal Stream client interface — only what we need for ending calls. */
interface StreamVideoClient {
  video: {
    call: (type: string, id: string) => StreamCallHandle;
  };
}

export interface CancelRoomOnSessionCancelDeps {
  db: DrizzleDb;
  getStreamClient: () => StreamVideoClient;
  /**
   * Optional sink for Stream `.end()` failures. The core logic stays pure (no
   * Inngest `logger` in scope), so the handler injects its structured logger
   * here. Defaults to a no-op (used by tests that do not assert on logging).
   */
  onStreamError?: (error: unknown, roomId: string) => void;
}

export type CancelRoomResult =
  | { action: 'expired_room'; roomId: string }
  | { action: 'skipped'; reason: 'no_room' };

// ---------------------------------------------------------------------------
// Core logic — exported for testability
// ---------------------------------------------------------------------------

/**
 * Cleans up the video room (if any) belonging to a cancelled session.
 *
 * Returns `{ action: 'skipped', reason: 'no_room' }` when no cleanable room
 * exists (cancelled before the creation window, or already ended/expired).
 */
export async function processSessionCancelled(
  data: { sessionId: string; userId: string },
  deps: CancelRoomOnSessionCancelDeps,
): Promise<CancelRoomResult> {
  const { db } = deps;

  // Room lookup scoped by (session, user) and limited to cleanable statuses.
  const [room] = await db
    .select({
      id: videoRooms.id,
      sessionId: videoRooms.sessionId,
      userId: videoRooms.userId,
      streamCallId: videoRooms.streamCallId,
    })
    .from(videoRooms)
    .where(
      and(
        eq(videoRooms.sessionId, data.sessionId),
        eq(videoRooms.userId, data.userId),
        inArray(videoRooms.status, [...CLEANABLE_STATUSES]),
      ),
    )
    .limit(1);

  if (!room) {
    return { action: 'skipped', reason: 'no_room' };
  }

  // 1. End the Stream call — wrapped in try/catch because the call may already
  //    be ended or Stream may be temporarily unavailable. A Stream failure must
  //    NOT prevent the DB cleanup below. A reserved-but-not-yet-activated room
  //    has `streamCallId=NULL` and no live Stream call, so there is nothing to
  //    end — skip straight to the DB cleanup.
  const streamClient = deps.getStreamClient();
  try {
    if (room.streamCallId !== null) {
      const call = streamClient.video.call('default', room.streamCallId);
      await call.end();
    }
  } catch (error) {
    // Log presence, not value — no PII or clinical content. The room UUID is an
    // internal identifier; the error message is not surfaced to any client.
    deps.onStreamError?.(error, room.id);
  }

  // 2. Update room status + insert log entry atomically. Stream `.end()` stays
  //    outside the transaction because it is a remote call that cannot be
  //    rolled back.
  await db.transaction(async (tx) => {
    await tx.update(videoRooms).set({ status: 'expired' }).where(eq(videoRooms.id, room.id));

    await tx.insert(videoSessionLogs).values({
      sessionId: room.sessionId,
      userId: room.userId,
      eventType: 'room_expired',
    });
  });

  return { action: 'expired_room', roomId: room.id };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const cancelRoomOnSessionCancel = inngest.createFunction(
  {
    id: 'telepsicologia-cancel-room-on-session-cancel',
    triggers: [{ event: SESSION_CANCELLED_EVENT }],
    retries: 3,
  },
  async ({ event, step, logger }) => {
    const eventData = event.data as { sessionId: string; userId: string };

    const result = await step.run('cancel-room', async () => {
      // Lazy imports — same pattern as other telepsicologia Inngest functions.
      const { db } = await import('@/shared/db/client');
      const { getStreamClient } = await import('@/modules/telepsicologia/server/stream-client');

      return processSessionCancelled(eventData, {
        db,
        getStreamClient,
        onStreamError: (error, roomId) => {
          logger.warn(
            {
              event: 'cancel_room_stream_end_failed',
              roomId,
              hasError: error != null,
            },
            'Stream call.end() failed during cascade cancellation; DB cleanup continues',
          );
        },
      });
    });

    logger.info(
      {
        event: 'cancel_room_on_session_cancel_complete',
        action: result.action,
        sessionId: eventData.sessionId,
      },
      `Cancel room on session cancel: ${result.action}`,
    );

    return result;
  },
);
