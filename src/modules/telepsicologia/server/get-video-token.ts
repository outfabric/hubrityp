import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { videoTokenInputSchema } from '@/modules/telepsicologia/lib/schemas';
import { getStreamClient } from '@/modules/telepsicologia/server/stream-client';
import { db } from '@/shared/db/client';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type GetVideoTokenResult =
  | { ok: true; token: string }
  | { ok: false; error: 'unauthenticated' }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'room_not_found' }
  | { ok: false; error: 'room_not_available' }
  | { ok: false; error: 'unknown'; message: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Psychologist JWT validity in seconds (2 hours). */
const PSYCHOLOGIST_JWT_VALIDITY_SECONDS = 7200;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Generates a Stream JWT for the authenticated psychologist to join
 * their own video room.
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input with videoTokenInputSchema.
 *   3. Verify room ownership (user_id = auth.uid()).
 *   4. Verify room status is 'pending' or 'active'.
 *   5. Mint psychologist JWT with admin role, scoped to the call.
 *   6. Return { ok: true, token }.
 */
export async function getVideoTokenImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<GetVideoTokenResult> {
  // 1. Authenticate — MUST be first, before any DB/Stream calls
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Validate input
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
        streamCallId: videoRooms.streamCallId,
        status: videoRooms.status,
      })
      .from(videoRooms)
      .where(and(eq(videoRooms.id, roomId), eq(videoRooms.userId, userId)))
      .limit(1);

    if (!room) {
      return { ok: false, error: 'room_not_found' };
    }

    // 4. Verify room status — only pending or active rooms can be joined
    if (room.status !== 'pending' && room.status !== 'active') {
      return { ok: false, error: 'room_not_available' };
    }

    // 5. Mint psychologist JWT — admin role, scoped to this call only
    const streamClient = getStreamClient();
    const token = streamClient.generateCallToken({
      user_id: userId,
      call_cids: [`default:${room.streamCallId}`],
      role: 'admin',
      validity_in_seconds: PSYCHOLOGIST_JWT_VALIDITY_SECONDS,
    });

    // 6. Return token
    return { ok: true, token };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'get_video_token_failed', errorCode: pgError.code },
      'unexpected error generating video token',
    );
    return {
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao gerar token de video. Tente novamente.',
    };
  }
}
