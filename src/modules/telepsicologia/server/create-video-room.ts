import 'server-only';

import { randomBytes } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { videoRoomInputSchema } from '@/modules/telepsicologia/lib/schemas';
import { getStreamClient } from '@/modules/telepsicologia/server/stream-client';
import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms, type VideoRoom } from '@/shared/db/schema/telepsicologia/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CreateVideoRoomResult =
  | { ok: true; room: VideoRoom }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'session_not_found' }
  | { ok: false; error: 'session_not_online' }
  | { ok: false; error: 'session_not_schedulable' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minutes before session start when the room becomes available. */
const ROOM_AVAILABLE_BEFORE_MINUTES = 10;

/** Hours after session end when the room expires. */
const ROOM_EXPIRES_AFTER_HOURS = 1;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a video room for an online clinical session.
 *
 * Idempotent: if a room already exists for the session, returns the existing
 * room without creating a duplicate Stream call or DB row.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input with videoRoomInputSchema.
 *   3. Verify session ownership (user_id = auth.uid()).
 *   4. Verify session modality is 'online' and status is 'scheduled' or 'confirmed'.
 *   5. If a room already exists for this session, return it (idempotent).
 *   6. Generate 64-char hex patient_token via crypto.randomBytes(32).
 *   7. Compute available_from and expires_at from session timestamps.
 *   8. Create Stream call with settings (limits, screensharing, recording).
 *   9. Mint patient JWT scoped to the call.
 *  10. INSERT video_rooms row.
 *  11. Return { ok: true, room }.
 */
export async function createVideoRoomImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<CreateVideoRoomResult> {
  // 1. Authenticate — MUST be first, before any DB/Stream calls
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
  const parsed = videoRoomInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { session_id: sessionId } = parsed.data;
  const userId = user.id;

  try {
    // 3. Verify session ownership — scoped by user_id to prevent IDOR
    const [session] = await db
      .select({
        id: sessions.id,
        startAt: sessions.startAt,
        endAt: sessions.endAt,
        modality: sessions.modality,
        status: sessions.status,
        patientId: sessions.patientId,
      })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .limit(1);

    if (!session) {
      return { ok: false, error: 'session_not_found' };
    }

    // 4. Verify modality and status
    if (session.modality !== 'online') {
      return { ok: false, error: 'session_not_online' };
    }

    if (session.status !== 'scheduled' && session.status !== 'confirmed') {
      return { ok: false, error: 'session_not_schedulable' };
    }

    // 5. Idempotent: if a room already exists, return it
    const [existingRoom] = await db
      .select()
      .from(videoRooms)
      .where(and(eq(videoRooms.sessionId, sessionId), eq(videoRooms.userId, userId)))
      .limit(1);

    if (existingRoom) {
      return { ok: true, room: existingRoom };
    }

    // 6. Generate 64-char hex patient lookup token
    const patientToken = randomBytes(32).toString('hex');

    // 7. Compute time window
    const availableFrom = new Date(
      session.startAt.getTime() - ROOM_AVAILABLE_BEFORE_MINUTES * 60 * 1000,
    );
    const expiresAt = new Date(
      session.endAt.getTime() + ROOM_EXPIRES_AFTER_HOURS * 60 * 60 * 1000,
    );

    // Determine max participants based on patient type (couple = 3, else 2)
    let maxParticipants = 2;
    if (session.patientId) {
      const [patient] = await db
        .select({ patientType: patients.patientType })
        .from(patients)
        .where(and(eq(patients.id, session.patientId), eq(patients.userId, userId)))
        .limit(1);

      if (patient?.patientType === 'couple') {
        maxParticipants = 3;
      }
    }

    // 8. Create Stream call
    const roomId = `session-${sessionId}`;
    const streamClient = getStreamClient();
    const call = streamClient.video.call('default', roomId);

    await call.getOrCreate({
      data: {
        created_by_id: userId,
        settings_override: {
          limits: {
            max_participants: maxParticipants,
          },
          screensharing: {
            enabled: true,
          },
          recording: {
            mode: 'available',
          },
        },
      },
    });

    // 9. Mint patient JWT scoped to this call only
    // Validity bounded so it does not exceed the room's expires_at
    const patientJwtValiditySeconds = Math.max(
      0,
      Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    );
    const patientJwt = streamClient.generateCallToken({
      user_id: `patient-${session.patientId ?? sessionId}`,
      call_cids: [`default:${roomId}`],
      validity_in_seconds: patientJwtValiditySeconds,
    });

    // 10. INSERT video_rooms row
    const [inserted] = await db
      .insert(videoRooms)
      .values({
        userId,
        sessionId,
        streamCallId: roomId,
        patientToken,
        patientJwt,
        availableFrom,
        expiresAt,
        status: 'pending',
      })
      .returning();

    // 11. Return the created room
    return { ok: true, room: inserted! };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'create_video_room_failed', errorCode: pgError.code },
      'unexpected error creating video room',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao criar sala de video. Tente novamente.',
    };
  }
}
