import 'server-only';

import { randomBytes } from 'node:crypto';

import type { StreamClient } from '@stream-io/node-sdk';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms, type VideoRoom } from '@/shared/db/schema/telepsicologia/tables';
import { logger } from '@/shared/lib/logger';

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
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minutes before session start when the room becomes available. */
const ROOM_AVAILABLE_BEFORE_MINUTES = 10;

/** Hours after session end when the room expires. */
const ROOM_EXPIRES_AFTER_HOURS = 1;

// ---------------------------------------------------------------------------
// Minimal DB type (any Drizzle Postgres client or transaction)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

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
 * Idempotent: if a room already exists for the session, returns the existing
 * room without creating a duplicate Stream call or DB row.
 *
 * Flow:
 *   1. Check if a room already exists for this session (idempotent).
 *   2. Generate 64-char hex patient_token via crypto.randomBytes(32).
 *   3. Compute available_from and expires_at from session timestamps.
 *   4. Look up patient type to determine max participants (couple = 3).
 *   5. Create Stream call with settings (limits, screensharing, recording).
 *   6. Mint patient JWT scoped to the call.
 *   7. INSERT video_rooms row.
 *   8. Return { ok: true, room }.
 */
export async function createVideoRoomHelper(
  streamClient: StreamClient,
  session: SessionData,
  db: DrizzleDb,
): Promise<CreateVideoRoomHelperResult> {
  try {
    // 1. Idempotent: if a room already exists, return it
    const [existingRoom] = await db
      .select()
      .from(videoRooms)
      .where(and(eq(videoRooms.sessionId, session.id), eq(videoRooms.userId, session.userId)))
      .limit(1);

    if (existingRoom) {
      return { ok: true, room: existingRoom };
    }

    // 2. Generate 64-char hex patient lookup token
    const patientToken = randomBytes(32).toString('hex');

    // 3. Compute time window
    const availableFrom = new Date(
      session.startAt.getTime() - ROOM_AVAILABLE_BEFORE_MINUTES * 60 * 1000,
    );
    const expiresAt = new Date(session.endAt.getTime() + ROOM_EXPIRES_AFTER_HOURS * 60 * 60 * 1000);

    // 4. Determine max participants based on patient type (couple = 3, else 2)
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

    // 5. Create Stream call
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

    // 6. Mint patient JWT scoped to this call only
    // Validity bounded so it does not exceed the room's expires_at
    const patientJwtValiditySeconds = Math.max(
      0,
      Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    );
    const patientJwt = streamClient.generateCallToken({
      user_id: `patient-${session.patientId ?? session.id}`,
      call_cids: [`default:${roomId}`],
      validity_in_seconds: patientJwtValiditySeconds,
    });

    // 7. INSERT video_rooms row
    const [inserted] = await db
      .insert(videoRooms)
      .values({
        userId: session.userId,
        sessionId: session.id,
        streamCallId: roomId,
        patientToken,
        patientJwt,
        availableFrom,
        expiresAt,
        status: 'pending',
      })
      .returning();

    // 8. Return the created room
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
