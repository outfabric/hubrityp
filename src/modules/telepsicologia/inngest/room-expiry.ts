/**
 * Room expiry cron — Inngest function that periodically cleans up
 * video rooms that have exceeded their time window or been empty too long.
 *
 * Runs every 15 minutes in America/Sao_Paulo timezone. For each qualifying room:
 *
 *   1. Queries `video_rooms` WHERE status IN ('pending', 'active')
 *      AND `expires_at < NOW()`.
 *   2. For each: ends Stream call (try/catch — may already be ended),
 *      updates status to 'expired', inserts a `room_expired` log entry.
 *   3. Also checks for "5 min empty" rooms (RF-09.23): queries active rooms,
 *      then checks `video_session_logs` for rooms where the last participant
 *      event is a `*_left` with no subsequent `*_joined` and the `*_left`
 *      event happened > 5 minutes ago — expires these too.
 *
 * Uses the Drizzle db client directly (not a Supabase client scoped to a user)
 * because this is a system job running in Inngest, not a user-initiated action.
 * The db client bypasses RLS — justified because there is no user session in
 * background jobs.
 *
 * Retries: 3 with backoff (Inngest default backoff strategy).
 */

import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { videoRooms, videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';

import { inngest } from './client';

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

export interface RoomExpiryDeps {
  db: DrizzleDb;
  getStreamClient: () => StreamVideoClient;
}

export interface RoomExpiryResult {
  /** Rooms expired because `expires_at < NOW()`. */
  timeExpiredCount: number;
  /** Active rooms expired because they were empty for > 5 minutes. */
  emptyExpiredCount: number;
  /** Rooms where Stream `.end()` threw (non-fatal — DB still updated). */
  streamErrors: number;
}

// ---------------------------------------------------------------------------
// Participant event types used for the "5 min empty" check
// ---------------------------------------------------------------------------

const JOINED_EVENTS = ['therapist_joined', 'patient_joined', 'partner_joined'] as const;
const LEFT_EVENTS = ['therapist_left', 'patient_left', 'partner_left'] as const;
const PARTICIPANT_EVENTS = [...JOINED_EVENTS, ...LEFT_EVENTS] as const;

// ---------------------------------------------------------------------------
// Core logic — exported for testability
// ---------------------------------------------------------------------------

/**
 * Expires a single room: ends the Stream call (non-fatal on error),
 * updates `video_rooms.status` to 'expired', and inserts a
 * `room_expired` log entry.
 *
 * Returns true if Stream `.end()` threw (caller tracks for reporting).
 */
async function expireSingleRoom(
  db: DrizzleDb,
  streamClient: StreamVideoClient,
  room: { id: string; sessionId: string; userId: string; streamCallId: string | null },
): Promise<{ streamError: boolean }> {
  let streamError = false;

  // 1. End Stream call — wrapped in try/catch because the call may
  //    already be ended or Stream may be temporarily unavailable.
  //    A reserved-but-not-yet-activated room has `streamCallId=NULL` and
  //    no live Stream call, so there is nothing to end.
  if (room.streamCallId !== null) {
    try {
      const call = streamClient.video.call('default', room.streamCallId);
      await call.end();
    } catch {
      streamError = true;
    }
  }

  // 2. Update room status + insert log entry atomically.
  // Stream `.end()` stays outside the transaction because it is a
  // remote call that cannot be rolled back.
  await db.transaction(async (tx) => {
    await tx.update(videoRooms).set({ status: 'expired' }).where(eq(videoRooms.id, room.id));

    await tx.insert(videoSessionLogs).values({
      sessionId: room.sessionId,
      userId: room.userId,
      eventType: 'room_expired',
    });
  });

  return { streamError };
}

/**
 * Step 1: Expire rooms past their `expires_at` window.
 */
async function expireTimedOutRooms(
  deps: RoomExpiryDeps,
): Promise<{ count: number; streamErrors: number }> {
  const { db } = deps;
  const streamClient = deps.getStreamClient();

  // Query rooms that are pending/active and past their expiry window.
  const expiredRooms = await db
    .select({
      id: videoRooms.id,
      sessionId: videoRooms.sessionId,
      userId: videoRooms.userId,
      streamCallId: videoRooms.streamCallId,
    })
    .from(videoRooms)
    .where(
      and(inArray(videoRooms.status, ['pending', 'active']), lt(videoRooms.expiresAt, sql`now()`)),
    );

  let streamErrors = 0;

  for (const room of expiredRooms) {
    const result = await expireSingleRoom(db, streamClient, room);
    if (result.streamError) streamErrors++;
  }

  return { count: expiredRooms.length, streamErrors };
}

/**
 * Step 2: Expire active rooms that have been empty for > 5 minutes.
 *
 * "Empty" = the most recent participant event is a `*_left` event,
 * with no subsequent `*_joined` event, and that `*_left` event
 * happened more than 5 minutes ago.
 */
async function expireEmptyRooms(
  deps: RoomExpiryDeps,
): Promise<{ count: number; streamErrors: number }> {
  const { db } = deps;
  const streamClient = deps.getStreamClient();

  // Only check rooms that are currently active (pending rooms have no
  // participants so the "empty for 5 min" rule does not apply to them —
  // they are covered by the time-based expiry in step 1).
  const activeRooms = await db
    .select({
      id: videoRooms.id,
      sessionId: videoRooms.sessionId,
      userId: videoRooms.userId,
      streamCallId: videoRooms.streamCallId,
    })
    .from(videoRooms)
    .where(eq(videoRooms.status, 'active'));

  let count = 0;
  let streamErrors = 0;

  for (const room of activeRooms) {
    // Get the most recent participant event for this room's session.
    const [lastEvent] = await db
      .select({
        eventType: videoSessionLogs.eventType,
        createdAt: videoSessionLogs.createdAt,
      })
      .from(videoSessionLogs)
      .where(
        and(
          eq(videoSessionLogs.sessionId, room.sessionId),
          inArray(videoSessionLogs.eventType, [...PARTICIPANT_EVENTS]),
        ),
      )
      .orderBy(desc(videoSessionLogs.createdAt))
      .limit(1);

    if (!lastEvent) continue;

    // Check: is the last event a *_left event?
    const isLeft = (LEFT_EVENTS as readonly string[]).includes(lastEvent.eventType);
    if (!isLeft) continue;

    // Check: did it happen more than 5 minutes ago?
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (lastEvent.createdAt > fiveMinutesAgo) continue;

    // Room qualifies for empty-room expiry
    const result = await expireSingleRoom(db, streamClient, room);
    if (result.streamError) streamErrors++;
    count++;
  }

  return { count, streamErrors };
}

/**
 * Main entry point — processes both time-expired and empty-room expiry.
 * Extracted from the Inngest handler for testability.
 */
export async function processRoomExpiry(deps: RoomExpiryDeps): Promise<RoomExpiryResult> {
  const timeResult = await expireTimedOutRooms(deps);
  const emptyResult = await expireEmptyRooms(deps);

  return {
    timeExpiredCount: timeResult.count,
    emptyExpiredCount: emptyResult.count,
    streamErrors: timeResult.streamErrors + emptyResult.streamErrors,
  };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const roomExpiryCron = inngest.createFunction(
  {
    id: 'telepsicologia-room-expiry',
    triggers: [{ cron: 'TZ=America/Sao_Paulo */15 * * * *' }],
    retries: 3,
  },
  async ({ step, logger }) => {
    const result = await step.run('expire-rooms', async () => {
      // Lazy imports — same pattern as other Inngest functions.
      const { db } = await import('@/shared/db/client');
      const { getStreamClient } = await import('@/modules/telepsicologia/server/stream-client');

      return processRoomExpiry({
        db,
        getStreamClient,
      });
    });

    logger.info(
      {
        event: 'room_expiry_cron_complete',
        timeExpiredCount: result.timeExpiredCount,
        emptyExpiredCount: result.emptyExpiredCount,
        streamErrors: result.streamErrors,
      },
      `Room expiry: ${result.timeExpiredCount} time-expired, ${result.emptyExpiredCount} empty-expired, ${result.streamErrors} Stream error(s)`,
    );

    return result;
  },
);
