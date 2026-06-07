/**
 * Auto-create video room — Inngest function that automatically provisions
 * a Stream.io video room when an online session is created or updated.
 *
 * Triggered by `agenda/session.created` and `agenda/session.updated`.
 *
 * Guard conditions:
 *   1. modality must be 'online'
 *   2. status must be 'scheduled' or 'confirmed'
 *   3. no *fully activated* video_room for this session. A room is "fully
 *      activated" when `stream_call_id IS NOT NULL`; such a room short-circuits
 *      creation (idempotent). A *reserved* room (`stream_call_id IS NULL`,
 *      created at schedule time) is NOT a short-circuit — it proceeds through
 *      the deferred activation path, where `createVideoRoomHelper` UPDATEs the
 *      reserved row in place.
 *
 * Deferred creation: the room is NOT created at event time. Instead the
 * function sleeps until ~1 hour before the session's `startAt`, then creates
 * the room. This keeps Stream.io rooms short-lived and avoids provisioning
 * rooms for sessions that are cancelled or rescheduled before they happen.
 *   - If `startAt - 1h` is already in the past, the room is created immediately
 *     (no sleep).
 *   - `cancelOn` cancels the sleeping function if the session is cancelled.
 *   - After the sleep wakes up, the session is re-queried from the DB to
 *     confirm it is still eligible (online + schedulable); if not, creation is
 *     skipped (defends against a race where the session changed during sleep
 *     and `cancelOn` did not fire).
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
import { sessions } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';

import { inngest } from './client';

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------

export const SESSION_CREATED_EVENT = 'agenda/session.created' as const;
export const SESSION_UPDATED_EVENT = 'agenda/session.updated' as const;
export const SESSION_CANCELLED_EVENT = 'agenda/session.cancelled' as const;

// ---------------------------------------------------------------------------
// Schedulable statuses — only these trigger room creation
// ---------------------------------------------------------------------------

const SCHEDULABLE_STATUSES = new Set(['scheduled', 'confirmed']);

// ---------------------------------------------------------------------------
// Deferred-creation window
// ---------------------------------------------------------------------------

/** How long before the session start the room is provisioned. */
const ROOM_CREATE_LEAD_MS = 60 * 60 * 1000; // 1 hour

/**
 * Computes the instant at which the room should be created: `startAt - 1h`.
 * The caller decides whether to sleep (future) or create immediately (past).
 */
export function computeWakeUpAt(startAt: Date): Date {
  return new Date(startAt.getTime() - ROOM_CREATE_LEAD_MS);
}

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
  | { action: 'expired_room'; sessionId: string };

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/**
 * Returns the existing video room for the (session, user) pair, or `null`.
 * Scoped by `userId` so a forged event for someone else's session cannot
 * reference another user's room.
 *
 * Selects `streamCallId` so callers can distinguish a *reserved* room
 * (`streamCallId IS NULL` — reserved at schedule time, not yet activated) from
 * a *fully activated* room (`streamCallId IS NOT NULL`). Only the latter short-
 * circuits room creation; a reserved room must still proceed through the
 * deferred activation path.
 */
async function findExistingRoom(
  db: AutoCreateRoomDeps['db'],
  sessionId: string,
  userId: string,
): Promise<{ id: string; streamCallId: string | null } | null> {
  const [room] = await db
    .select({ id: videoRooms.id, streamCallId: videoRooms.streamCallId })
    .from(videoRooms)
    .where(and(eq(videoRooms.sessionId, sessionId), eq(videoRooms.userId, userId)))
    .limit(1);

  return room ?? null;
}

/**
 * Re-queries the session from the database and confirms it is still eligible
 * for room creation: modality 'online' and status in ('scheduled','confirmed').
 *
 * This runs AFTER the sleep wakes up, to defend against a race where the
 * session was switched to in_person / cancelled while the function slept and
 * `cancelOn` did not catch it (e.g. an in_person switch, which does not emit
 * `session.cancelled`).
 */
async function isSessionStillEligible(
  db: AutoCreateRoomDeps['db'],
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const [session] = await db
    .select({ modality: sessions.modality, status: sessions.status })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);

  if (!session) {
    return false;
  }

  return session.modality === 'online' && SCHEDULABLE_STATUSES.has(session.status);
}

// ---------------------------------------------------------------------------
// Room creation (post-wake) — shared by created/updated paths
// ---------------------------------------------------------------------------

/**
 * Creates the video room for an eligible session. Idempotent: delegates the
 * existing-room short-circuit to `createVideoRoomHelper`.
 *
 * Throws (instead of returning an error result) on helper failure so Inngest's
 * `retries: 3` kicks in and the failure surfaces in the dashboard instead of
 * silently succeeding the step.
 */
async function createRoom(
  data: SessionCreatedEvent | SessionUpdatedEvent,
  deps: AutoCreateRoomDeps,
): Promise<AutoCreateRoomResult> {
  const streamClient = deps.getStreamClient();

  // Resolve display names for Stream user registration. Owner-scoped to the
  // event's userId (which originates from the emitting Server Action, not from
  // client input) so a forged event cannot read another tenant's data.
  const [profile] = await deps.db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.userId, data.userId))
    .limit(1);

  let patientFullName: string | null = null;
  if (data.patientId) {
    const [patient] = await deps.db
      .select({ fullName: patients.fullName })
      .from(patients)
      .where(and(eq(patients.id, data.patientId), eq(patients.userId, data.userId)))
      .limit(1);
    patientFullName = patient?.fullName ?? null;
  }

  const result = await deps.createVideoRoomHelper(
    streamClient,
    {
      id: data.sessionId,
      userId: data.userId,
      patientId: data.patientId,
      startAt: new Date(data.startAt),
      endAt: new Date(data.endAt),
      psychologistName: profile?.fullName ?? '',
      patientFullName,
    },
    deps.db,
  );

  if (!result.ok) {
    throw new Error(`Video room creation failed: ${result.message}`);
  }

  return { action: 'created', roomId: result.room.id };
}

// ---------------------------------------------------------------------------
// Decision logic (no sleep) — used directly in tests and after the sleep
// ---------------------------------------------------------------------------

/**
 * Processes a session.created event — creates a video room if the session
 * is online and in a schedulable status.
 *
 * This contains only the synchronous guard + create decision; the deferred
 * sleep is orchestrated by the Inngest handler (which owns `step`).
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
  return createRoom(data, deps);
}

/**
 * Processes a session.updated event — creates a room if the session is
 * (still or newly) online, expires an existing room if the session was
 * changed from online to in_person, or returns the existing room untouched
 * if one already exists for an online session.
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

  // If a room already exists AND is fully activated (`streamCallId IS NOT
  // NULL`), leave it untouched. A *reserved* room (`streamCallId IS NULL`)
  // still needs to be activated, so fall through to createRoom, which now
  // handles both the INSERT (no row) and UPDATE (reserved row) paths.
  const existing = await findExistingRoom(db, data.sessionId, data.userId);
  if (existing && existing.streamCallId !== null) {
    return { action: 'existing', roomId: existing.id };
  }

  return createRoom(data, deps);
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const autoCreateVideoRoom = inngest.createFunction(
  {
    id: 'telepsicologia-auto-create-video-room',
    triggers: [{ event: SESSION_CREATED_EVENT }, { event: SESSION_UPDATED_EVENT }],
    retries: 3,
    // Cancel the sleeping function if the session is cancelled before its
    // `startAt - 1h` wake-up, so no room is provisioned for a cancelled session.
    cancelOn: [
      {
        event: SESSION_CANCELLED_EVENT,
        if: 'async.data.sessionId == event.data.sessionId',
      },
    ],
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

    const isUpdate = eventName === SESSION_UPDATED_EVENT;

    // -- Fast-path guards + non-deferred branches ---------------------------
    // These do not require waiting until the session's start window:
    //   - non-online / non-schedulable sessions are skipped immediately
    //   - online->in_person updates expire the room immediately
    //   - updates where a room already exists return it untouched
    const guard = await step.run(
      'guard-and-handle-immediate',
      async (): Promise<AutoCreateRoomResult> => {
        if (isUpdate) {
          const data = eventData as SessionUpdatedEvent;

          // online -> in_person transition: expire existing room now.
          if (data.previousModality === 'online' && data.modality !== 'online') {
            return processSessionUpdated(data, deps);
          }

          if (data.modality !== 'online') {
            return { action: 'skipped', reason: 'not_online' };
          }
          if (!SCHEDULABLE_STATUSES.has(data.status)) {
            return { action: 'skipped', reason: 'not_schedulable' };
          }

          // If a fully activated room already exists (`streamCallId IS NOT
          // NULL`), do not defer/recreate — return it. A reserved room
          // (`streamCallId IS NULL`) must still flow through the deferred
          // activation path, so we fall through to 'eligible_pending_create'.
          const existing = await findExistingRoom(deps.db, data.sessionId, data.userId);
          if (existing && existing.streamCallId !== null) {
            return { action: 'existing', roomId: existing.id };
          }

          return { action: 'skipped', reason: 'eligible_pending_create' };
        }

        if (eventData.modality !== 'online') {
          return { action: 'skipped', reason: 'not_online' };
        }
        if (!SCHEDULABLE_STATUSES.has(eventData.status)) {
          return { action: 'skipped', reason: 'not_schedulable' };
        }

        return { action: 'skipped', reason: 'eligible_pending_create' };
      },
    );

    // If the guard already produced a terminal result (skip / expire /
    // existing), return it without deferring.
    if (!(guard.action === 'skipped' && guard.reason === 'eligible_pending_create')) {
      logger.info(
        {
          event: 'auto_create_room_complete',
          action: guard.action,
          sessionId: eventData.sessionId,
        },
        `Auto-create room: ${guard.action}`,
      );
      return guard;
    }

    // -- Deferred creation --------------------------------------------------
    // Sleep until ~1h before the session start. If that instant is already
    // past, skip the sleep and create immediately.
    const wakeUpAt = computeWakeUpAt(new Date(eventData.startAt));
    if (wakeUpAt.getTime() > Date.now()) {
      await step.sleepUntil('wait-until-1h-before', wakeUpAt);
    }

    // -- Re-check eligibility after waking up -------------------------------
    // The session may have been switched to in_person / cancelled while we
    // slept (and `cancelOn` may not have fired for a non-cancellation change).
    const stillEligible = await step.run('recheck-session-eligible', async () => {
      return isSessionStillEligible(deps.db, eventData.sessionId, eventData.userId);
    });

    if (!stillEligible) {
      const skipped: AutoCreateRoomResult = {
        action: 'skipped',
        reason: 'session_no_longer_eligible',
      };
      logger.info(
        {
          event: 'auto_create_room_complete',
          action: skipped.action,
          reason: skipped.reason,
          sessionId: eventData.sessionId,
        },
        `Auto-create room: ${skipped.action}`,
      );
      return skipped;
    }

    const result = await step.run('auto-create-room', async () => {
      return createRoom(eventData, deps);
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
