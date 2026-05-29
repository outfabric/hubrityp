'use server';

// Thin route shell for the AI-transcription review Server Actions.
//
// The actual implementations live in `src/modules/ai-transcription/server/`
// (re-exported from `@/modules/ai-transcription`). This file MUST stay thin and
// carry the `'use server'` directive — that is what marks each export as a
// Server Action entry point for the Next.js compiler. Every export of a
// `'use server'` file MUST be an async function; types cannot be re-exported
// from here.
//
// Security: each wrapper builds a fresh RLS-scoped Supabase client carrying the
// caller's session cookies (`createServerClient`) — never the service role. The
// underlying impls authenticate via `supabase.auth.getUser()` and authorize
// ownership server-side, so a client-supplied `transcriptionId` for another
// tenant resolves to NOT_FOUND.

import type {
  DiscardTranscriptionResult,
  SaveTranscriptionToProntuarioResult,
  UpdateTranscriptionDraftResult,
} from '@/modules/ai-transcription';
import {
  discardTranscriptionImpl,
  saveTranscriptionToProntuarioImpl,
  updateTranscriptionDraftImpl,
} from '@/modules/ai-transcription';
import { createServerClient } from '@/shared/supabase/server';

export async function updateTranscriptionDraft(
  input: unknown,
): Promise<UpdateTranscriptionDraftResult> {
  const supabase = await createServerClient();
  return updateTranscriptionDraftImpl(supabase, input);
}

export async function saveTranscriptionToProntuario(
  input: unknown,
): Promise<SaveTranscriptionToProntuarioResult> {
  const supabase = await createServerClient();
  return saveTranscriptionToProntuarioImpl(supabase, input);
}

export async function discardTranscription(input: unknown): Promise<DiscardTranscriptionResult> {
  const supabase = await createServerClient();
  return discardTranscriptionImpl(supabase, input);
}
