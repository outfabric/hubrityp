/**
 * Auto-create video room — Inngest function that automatically provisions
 * a Stream.io video room when an online session is created or updated.
 *
 * Triggered by `agenda/session.created` and `agenda/session.updated`.
 *
 * Guard conditions:
 *   1. modality must be 'online'
 *   2. status must be 'scheduled' or 'confirmed'
 *   3. no existing video_rooms for this session (idempotent — delegated to helper)
 *
 * If the session is updated from online to in_person, the existing room is
 * soft-invalidated (status set to 'expired') but not deleted.
 *
 * Uses the Drizzle db client directly (not a Supabase client scoped to a user)
 * because this is a system job running in Inngest, not a user-initiated action.
 * The db client bypasses RLS — justified because there is no user session in
 * background jobs. Ownership is enforced by the event payload (userId comes
 * from the Server Action that emitted the event, not from client input).
 *
 * Retries: 3 with backoff (Inngest default backoff strategy).
 */

import type { StreamClient } from '@stream-io/node-sdk';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { SessionCreatedEvent, SessionUpdatedEvent } from '@/modules/agenda/lib/session-events';
import type { createVideoRoomHelper as CreateVideoRoomHelperFn } from '@/modules/telepsicologia/server/create-video-room-helper';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';

import { inngest } from './client';

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------

export const SESSION_CREATED_EVENT = 'agenda/session.created' as const;
export const SESSION_UPDATED_EVENT = 'agenda/session.updated' as const;

// ---------------------------------------------------------------------------
// Schedulable statuses — only these trigger room creation
// ---------------------------------------------------------------------------

const SCHEDULABLE_STATUSES = new Set(['scheduled', 'confirmed']);

// ---------------------------------------------------------------------------
// Core logic — extracted for testability
// ---------------------------------------------------------------------------

export interface AutoCreateRoomDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>;
  getStreamClient: () => StreamClient;
  createVideoRoomHelper: typeof CreateVideoRoomHelperFn;
}

export type AutoCreateRoomResult =
  | { action: 'created'; roomId: string }
  | { action: 'existing'; roomId: string }
  | { action: 'skipped'; reason: string }
  | { action: 'expired_room'; sessionId: string }
  | { action: 'error'; message: string };

/**
 * Processes a session.created event — creates a video room if the session
 * is online and in a schedulable status.
 */
export async function processSessionCreated(
  data: SessionCreatedEvent,
  deps: AutoCreateRoomDeps,
): Promise<AutoCreateRoomResult> {
  // Guard 1: modality must be 'online'
  if (data.modality !== 'online') {
    return { action: 'skipped', reason: 'not_online' };
  }

  // Guard 2: status must be schedulable
  if (!SCHEDULABLE_STATUSES.has(data.status)) {
    return { action: 'skipped', reason: 'not_schedulable' };
  }

  // Guard 3 + room creation: delegated to the idempotent helper
  const streamClient = deps.getStreamClient();
  const result = await deps.createVideoRoomHelper(
    streamClient,
    {
      id: data.sessionId,
      userId: data.userId,
      patientId: data.patientId,
      startAt: new Date(data.startAt),
      endAt: new Date(data.endAt),
    },
    deps.db,
  );

  if (!result.ok) {
    return { action: 'error', message: result.message };
  }

  return { action: 'created', roomId: result.room.id };
}

/**
 * Processes a session.updated event — creates a room if the session is
 * (still or newly) online, or expires an existing room if the session
 * was changed from online to in_person.
 */
export async function processSessionUpdated(
  data: SessionUpdatedEvent,
  deps: AutoCreateRoomDeps,
): Promise<AutoCreateRoomResult> {
  const { db } = deps;

  // Case 1: session was updated from online to in_person — expire room
  if (data.previousModality === 'online' && data.modality !== 'online') {
    const updated = await db
      .update(videoRooms)
      .set({ status: 'expired' })
      .where(and(eq(videoRooms.sessionId, data.sessionId), eq(videoRooms.userId, data.userId)))
      .returning({ id: videoRooms.id });

    if (updated.length > 0) {
      return { action: 'expired_room', sessionId: data.sessionId };
    }

    // No room existed to expire — that is fine, nothing to do
    return { action: 'skipped', reason: 'no_room_to_expire' };
  }

  // Case 2: session is online — create room (idempotent)
  if (data.modality !== 'online') {
    return { action: 'skipped', reason: 'not_online' };
  }

  if (!SCHEDULABLE_STATUSES.has(data.status)) {
    return { action: 'skipped', reason: 'not_schedulable' };
  }

  const streamClient = deps.getStreamClient();
  const result = await deps.createVideoRoomHelper(
    streamClient,
    {
      id: data.sessionId,
      userId: data.userId,
      patientId: data.patientId,
      startAt: new Date(data.startAt),
      endAt: new Date(data.endAt),
    },
    deps.db,
  );

  if (!result.ok) {
    return { action: 'error', message: result.message };
  }

  return { action: 'created', roomId: result.room.id };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const autoCreateVideoRoom = inngest.createFunction(
  {
    id: 'telepsicologia-auto-create-video-room',
    triggers: [{ event: SESSION_CREATED_EVENT }, { event: SESSION_UPDATED_EVENT }],
    retries: 3,
  },
  async ({ event, step, logger }) => {
    // Multi-trigger variant types event.data as `any`. Cast at the boundary
    // so all downstream logic is fully typed.
    const eventName = event.name as string;
    const eventData = event.data as SessionCreatedEvent | SessionUpdatedEvent;

    // Dynamic imports inside the handler — same pattern as whatsapp inngest
    // functions. This avoids module-level evaluation of heavy deps and keeps
    // cold starts fast.
    const { db } = await import('@/shared/db/client');
    const { getStreamClient } = await import('@/modules/telepsicologia/server/stream-client');
    const { createVideoRoomHelper } =
      await import('@/modules/telepsicologia/server/create-video-room-helper');

    const deps: AutoCreateRoomDeps = {
      db,
      getStreamClient,
      createVideoRoomHelper,
    };

    const result = await step.run('auto-create-room', async () => {
      if (eventName === SESSION_CREATED_EVENT) {
        return processSessionCreated(eventData, deps);
      }

      // SESSION_UPDATED_EVENT
      return processSessionUpdated(eventData, deps);
    });

    logger.info(
      {
        event: 'auto_create_room_complete',
        action: result.action,
        sessionId: eventData.sessionId,
      },
      `Auto-create room: ${result.action}`,
    );

    return result;
  },
);
