import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, sql } from 'drizzle-orm';

import { extendSessionInputSchema } from '@/modules/telepsicologia/lib/schemas';
import { db } from '@/shared/db/client';
import { videoRooms, videoSessionLogs } from '@/shared/db/schema/telepsicologia/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ExtendSessionResult =
  | { ok: true }
  | { ok: false; code: 'UNAUTHENTICATED' }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]> }
  | { ok: false; code: 'ROOM_NOT_FOUND' }
  | { ok: false; code: 'ROOM_NOT_ACTIVE' }
  | { ok: false; code: 'UNKNOWN'; message: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Extends a telepsychology video session by 15 minutes.
 *
 * Flow:
 *   1. Authenticate via supabase.auth.getUser().
 *   2. Validate input (room_id).
 *   3. Verify room ownership (user_id = auth.uid()) and status='active'.
 *   4. UPDATE video_rooms SET expires_at = expires_at + INTERVAL '15 minutes'.
 *   5. INSERT video_session_logs event_type='session_extended'.
 *   6. Return { ok: true }.
 */
export async function extendSessionImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<ExtendSessionResult> {
  // 1. Authenticate — MUST be first, before any DB calls
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED' };
  }

  // 2. Validate input
  const parsed = extendSessionInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { room_id: roomId } = parsed.data;
  const userId = user.id;

  try {
    // 3. Verify room ownership and status — scoped by user_id to prevent IDOR
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
      return { ok: false, code: 'ROOM_NOT_FOUND' };
    }

    if (room.status !== 'active') {
      return { ok: false, code: 'ROOM_NOT_ACTIVE' };
    }

    // 4-5. UPDATE video_rooms + INSERT log atomically.
    await db.transaction(async (tx) => {
      // 4. Extend expiry by 15 minutes using Postgres interval arithmetic
      await tx
        .update(videoRooms)
        .set({ expiresAt: sql`${videoRooms.expiresAt} + interval '15 minutes'` })
        .where(and(eq(videoRooms.id, roomId), eq(videoRooms.userId, userId)));

      // 5. INSERT video_session_logs event_type='session_extended'
      await tx.insert(videoSessionLogs).values({
        sessionId: room.sessionId,
        userId,
        eventType: 'session_extended',
      });
    });

    // 6. Return success
    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'extend_session_failed', errorCode: pgError.code },
      'unexpected error extending session',
    );
    return {
      ok: false,
      code: 'UNKNOWN',
      message: 'Erro inesperado ao estender sessão. Tente novamente.',
    };
  }
}
