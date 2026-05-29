'use server';

// Thin route shell for AI-transcription settings Server Actions.
//
// The actual implementations live in `src/modules/ai-transcription/server/`
// (re-exported from `@/modules/ai-transcription`). This file MUST stay thin and
// carry the `'use server'` directive -- that is what marks it as a Server Action
// entry point for the Next.js compiler. Every export of a `'use server'` file
// MUST be an async function; types cannot be re-exported from here.
//
// Security: each action resolves the caller via the cookie-bound Supabase
// client (`createServerClient`); the impl authenticates with
// `supabase.auth.getUser()` and scopes every read/write to the session user.
// No client-supplied id is trusted.

import type {
  GetTranscriptionSettingsResult,
  UpdateTranscriptionSettingsResult,
} from '@/modules/ai-transcription';
import {
  getTranscriptionSettingsImpl,
  updateTranscriptionSettingsImpl,
} from '@/modules/ai-transcription';
import { createServerClient } from '@/shared/supabase/server';

export async function getTranscriptionSettings(): Promise<GetTranscriptionSettingsResult> {
  const supabase = await createServerClient();
  return getTranscriptionSettingsImpl(supabase);
}

export async function updateTranscriptionSettings(
  input: unknown,
): Promise<UpdateTranscriptionSettingsResult> {
  const supabase = await createServerClient();
  return updateTranscriptionSettingsImpl(supabase, input);
}
