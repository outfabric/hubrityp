import 'server-only';

import { randomBytes } from 'node:crypto';

import type { StreamClient } from '@stream-io/node-sdk';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms, type VideoRoom } from '@/shared/db/schema/telepsicologia/tables';
import { logger } from '@/shared/lib/logger';

import { ROOM_AVAILABLE_BEFORE_MINUTES, ROOM_EXPIRES_AFTER_HOURS } from '../lib/room-constants';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CreateVideoRoomHelperResult =
  | { ok: true; room: VideoRoom }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Input types — callers provide these from their own data-fetching layer
// ---------------------------------------------------------------------------

export interface SessionData {
  id: string;
  userId: string;
  patientId: string | null;
  startAt: Date;
  endAt: Date;
  /** Psychologist display name (from `profiles.fullName`) — used to register the user in Stream. */
  psychologistName: string;
  /** Patient display name (from `patients.fullName`), or `null` when no patient is linked. */
  patientFullName: string | null;
}

// ---------------------------------------------------------------------------
// Minimal DB type (any Drizzle Postgres client or transaction)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

// ---------------------------------------------------------------------------
// Stream provisioning — shared by the activation and full-creation paths
// ---------------------------------------------------------------------------

interface ProvisionedCall {
  streamCallId: string;
  patientJwt: string;
}

/**
 * Performs the Stream.io side effects shared by both the activation path
 * (reserved row → UPDATE) and the full-creation path (no row → INSERT):
 * registers the participants, creates/gets the call, and mints the patient JWT.
 *
 * It does NOT touch the database — the caller persists the returned values via
 * the appropriate write (UPDATE for activation, INSERT for full creation).
 */
async function provisionStreamCall(
  streamClient: StreamClient,
  session: SessionData,
  expiresAt: Date,
  db: DrizzleDb,
): Promise<ProvisionedCall> {
  // Determine max participants based on patient type (couple = 3, else 2).
  let maxParticipants = 2;
  if (session.patientId) {
    const [patient] = await db
      .select({ patientType: patients.patientType })
      .from(patients)
      .where(and(eq(patients.id, session.patientId), eq(patients.userId, session.userId)))
      .limit(1);

    if (patient?.patientType === 'couple') {
      maxParticipants = 3;
    }
  }

  // Register Stream users BEFORE creating the call.
  // Client-side `call.join()` fails if the joining user is not present in
  // Stream's user database. Server-side admin operations (getOrCreate, token
  // minting) succeed without this, which is why the bug went unnoticed. We
  // upsert the psychologist (always) and the patient (when one is linked).
  const streamUsers = [{ id: session.userId, name: session.psychologistName }];
  if (session.patientId) {
    streamUsers.push({
      id: `patient-${session.patientId}`,
      name: session.patientFullName ?? `patient-${session.patientId}`,
    });
  }
  await streamClient.upsertUsers(streamUsers);

  // Create Stream call.
  const roomId = `session-${session.id}`;
  const call = streamClient.video.call('default', roomId);

  await call.getOrCreate({
    data: {
      created_by_id: session.userId,
      settings_override: {
        limits: {
          max_participants: maxParticipants,
        },
        screensharing: {
          enabled: true,
        },
        recording: {
          mode: 'available',
          quality: '1080p',
          audio_only: false,
        },
      },
    },
  });

  // Mint patient JWT scoped to this call only.
  // Validity bounded so it does not exceed the room's expires_at.
  const patientJwtValiditySeconds = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  );
  const patientJwt = streamClient.generateCallToken({
    user_id: `patient-${session.patientId ?? session.id}`,
    call_cids: [`default:${roomId}`],
    validity_in_seconds: patientJwtValiditySeconds,
  });

  return { streamCallId: roomId, patientJwt };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Core room-creation logic shared by the Server Action (user-initiated) and
 * the Inngest auto-create function (system job).
 *
 * This helper is pure business logic: it does NOT authenticate or authorize.
 * The caller is responsible for verifying the user's identity and ownership
 * of the session before calling this function.
 *
 * Two modes, decided by the state of any existing `video_rooms` row:
 *
 *   - **Activation** (reserved row exists with `stream_call_id=NULL`): the row
 *     was pre-created by `reserveVideoRoom` at schedule time. This helper
 *     provisions the Stream call, mints the patient JWT, and UPDATEs the row.
 *     The existing `patient_token`, `available_from` and `expires_at` are
 *     preserved (a fresh token is NOT generated).
 *   - **Full creation** (no row exists — backward compatibility): generates a
 *     new `patient_token`, provisions the Stream call, mints the JWT, and
 *     INSERTs a new row.
 *
 * Idempotent: if a room already exists with `stream_call_id IS NOT NULL`
 * (already activated), it is returned untouched — no duplicate Stream call,
 * no `upsertUsers`, no DB write.
 */
export async function createVideoRoomHelper(
  streamClient: StreamClient,
  session: SessionData,
  db: DrizzleDb,
): Promise<CreateVideoRoomHelperResult> {
  try {
    // 1. Look up any existing room for this owner+session pair.
    const [existingRoom] = await db
      .select()
      .from(videoRooms)
      .where(and(eq(videoRooms.sessionId, session.id), eq(videoRooms.userId, session.userId)))
      .limit(1);

    if (existingRoom) {
      // 1a. Already activated → fully idempotent: return untouched.
      if (existingRoom.streamCallId !== null) {
        return { ok: true, room: existingRoom };
      }

      // 1b. Reserved (stream_call_id IS NULL) → activate via UPDATE.
      // Reuse the existing patient_token and time window; only the Stream call
      // and JWT are newly provisioned.
      const { streamCallId, patientJwt } = await provisionStreamCall(
        streamClient,
        session,
        existingRoom.expiresAt,
        db,
      );

      const [updated] = await db
        .update(videoRooms)
        .set({ streamCallId, patientJwt })
        .where(eq(videoRooms.id, existingRoom.id))
        .returning();

      return { ok: true, room: updated! };
    }

    // 2. Full creation — no row exists (backward compatibility).
    const patientToken = randomBytes(32).toString('hex');

    const availableFrom = new Date(
      session.startAt.getTime() - ROOM_AVAILABLE_BEFORE_MINUTES * 60 * 1000,
    );
    const expiresAt = new Date(session.endAt.getTime() + ROOM_EXPIRES_AFTER_HOURS * 60 * 60 * 1000);

    const { streamCallId, patientJwt } = await provisionStreamCall(
      streamClient,
      session,
      expiresAt,
      db,
    );

    const [inserted] = await db
      .insert(videoRooms)
      .values({
        userId: session.userId,
        sessionId: session.id,
        streamCallId,
        patientToken,
        patientJwt,
        availableFrom,
        expiresAt,
        status: 'pending',
      })
      .returning();

    return { ok: true, room: inserted! };
  } catch (err: unknown) {
    // Unique violation (23505): a concurrent request already inserted the room.
    // Re-fetch and return it to make the helper fully idempotent under race.
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      const [existing] = await db
        .select()
        .from(videoRooms)
        .where(and(eq(videoRooms.sessionId, session.id), eq(videoRooms.userId, session.userId)))
        .limit(1);

      if (existing) {
        return { ok: true, room: existing };
      }
    }

    logger.error(
      {
        event: 'create_video_room_helper_failed',
        errorCode: (err as { code?: string }).code,
        errorMessage: err instanceof Error ? err.message : 'unknown',
      },
      'unexpected error creating video room in helper',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao criar sala de video. Tente novamente.',
    };
  }
}
