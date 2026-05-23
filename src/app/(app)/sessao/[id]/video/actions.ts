'use server';

// Thin route shell for video call Server Actions.
//
// The actual implementations live in `src/modules/telepsicologia/server/`
// (re-exported from `@/modules/telepsicologia`). This file carries the
// `'use server'` directive so the Next.js compiler treats every export as a
// Server Action RPC stub.

import type {
  AdmitPatientResult,
  CreateVideoRoomResult,
  EndVideoSessionResult,
  GetVideoTokenResult,
} from '@/modules/telepsicologia';
import {
  admitPatientImpl,
  createVideoRoomImpl,
  endVideoSessionImpl,
  getVideoTokenImpl,
} from '@/modules/telepsicologia';
import { createServerClient } from '@/shared/supabase/server';

export async function createVideoRoom(sessionId: string): Promise<CreateVideoRoomResult> {
  const supabase = await createServerClient();
  return createVideoRoomImpl(supabase, { session_id: sessionId });
}

export async function getVideoToken(roomId: string): Promise<GetVideoTokenResult> {
  const supabase = await createServerClient();
  return getVideoTokenImpl(supabase, { room_id: roomId });
}

export async function endVideoSession(roomId: string): Promise<EndVideoSessionResult> {
  const supabase = await createServerClient();
  return endVideoSessionImpl(supabase, { room_id: roomId });
}

export async function admitPatient(roomId: string): Promise<AdmitPatientResult> {
  const supabase = await createServerClient();
  return admitPatientImpl(supabase, { room_id: roomId });
}
