import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';

import { videoRoomInputSchema } from '@/modules/telepsicologia/lib/schemas';
import {
  createVideoRoomHelper,
  type CreateVideoRoomHelperResult,
} from '@/modules/telepsicologia/server/create-video-room-helper';
import { getStreamClient } from '@/modules/telepsicologia/server/stream-client';
import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import type { VideoRoom } from '@/shared/db/schema/telepsicologia/tables';

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
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a video room for an online clinical session.
 *
 * This Server Action handles authentication and authorization, then
 * delegates room creation to `createVideoRoomHelper` (shared with the
 * Inngest auto-create function).
 *
 * Flow:
 *   1. Authenticate via Supabase session.
 *   2. Validate input with videoRoomInputSchema.
 *   3. Verify session ownership (user_id = auth.uid()).
 *   4. Verify session modality is 'online' and status is 'scheduled' or 'confirmed'.
 *   5. Delegate to createVideoRoomHelper (idempotent room creation).
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

  // 5. Delegate to shared helper (idempotent room creation)
  const streamClient = getStreamClient();
  const helperResult: CreateVideoRoomHelperResult = await createVideoRoomHelper(
    streamClient,
    {
      id: session.id,
      userId,
      patientId: session.patientId,
      startAt: session.startAt,
      endAt: session.endAt,
    },
    db,
  );

  return helperResult;
}
