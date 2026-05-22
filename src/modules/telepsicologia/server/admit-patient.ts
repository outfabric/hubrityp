import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { videoTokenInputSchema } from '@/modules/telepsicologia/lib/schemas';
import { db } from '@/shared/db/client';
import { videoRooms, videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type AdmitPatientResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'room_not_found' }
  | { ok: false; error: 'room_not_pending' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Records the psychologist's intent to admit a patient into the video room.
 *
 * Stream handles actual WebRTC admission — this action updates our DB state
 * to reflect that the room is now active and logs the admission event.
 *
 * Idempotent: if the room is already active, returns { ok: true } without
 * re-inserting the log entry.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input with videoTokenInputSchema (room_id: UUID).
 *   3. Verify room ownership (user_id = auth.uid()).
 *   4. Verify room status is 'pending' (idempotent on 'active').
 *   5. UPDATE video_rooms SET status='active'.
 *   6. INSERT video_session_logs event_type='patient_joined'.
 *   7. Return { ok: true }.
 */
export async function admitPatientImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<AdmitPatientResult> {
  // 1. Authenticate — MUST be first, before any DB calls
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
        status: videoRooms.status,
      })
      .from(videoRooms)
      .where(and(eq(videoRooms.id, roomId), eq(videoRooms.userId, userId)))
      .limit(1);

    if (!room) {
      return { ok: false, error: 'room_not_found' };
    }

    // 4. Idempotent: if the room is already active, return success
    if (room.status === 'active') {
      return { ok: true };
    }

    // Only pending rooms can be activated
    if (room.status !== 'pending') {
      return { ok: false, error: 'room_not_pending' };
    }

    // 5-6. UPDATE video_rooms + INSERT video_session_logs atomically.
    // Wrapped in a transaction to prevent partial state (e.g., room marked
    // active but audit log entry missing) on transient PG errors.
    await db.transaction(async (tx) => {
      await tx
        .update(videoRooms)
        .set({ status: 'active' })
        .where(and(eq(videoRooms.id, roomId), eq(videoRooms.userId, userId)));

      await tx.insert(videoSessionLogs).values({
        sessionId: room.sessionId,
        userId,
        eventType: 'patient_joined',
        participantRole: 'patient',
      });
    });

    // 7. Return success
    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'admit_patient_failed', errorCode: pgError.code },
      'unexpected error admitting patient',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao admitir paciente. Tente novamente.',
    };
  }
}
