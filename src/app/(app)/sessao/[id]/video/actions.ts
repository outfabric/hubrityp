'use server';

// Thin route shell for video call Server Actions.
//
// The actual implementations live in `src/modules/telepsicologia/server/`
// (re-exported from `@/modules/telepsicologia`). This file carries the
// `'use server'` directive so the Next.js compiler treats every export as a
// Server Action RPC stub.

import type {
  CreateEvolutionInput,
  CreateEvolutionResult,
  UpdateEvolutionResult,
} from '@/modules/medical-records';
import { createEvolutionImpl, updateEvolutionImpl } from '@/modules/medical-records';
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

// ---------------------------------------------------------------------------
// Medical records — evolution CRUD (used by prontuario drawer during call)
// ---------------------------------------------------------------------------

export async function createEvolution(input: CreateEvolutionInput): Promise<CreateEvolutionResult> {
  const supabase = await createServerClient();
  return createEvolutionImpl(supabase, input);
}

export async function updateEvolution(input: {
  evolutionId: string;
  content: Record<string, unknown>;
}): Promise<UpdateEvolutionResult> {
  const supabase = await createServerClient();
  return updateEvolutionImpl(supabase, input);
}
