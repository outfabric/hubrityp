'use server';

// Thin route shell for the Configurações > Feedback NPS submit action.
//
// The implementation lives in `src/modules/nps/server/` (re-exported from
// `@/modules/nps`). This file MUST stay thin and carry the `'use server'`
// directive — that is what marks it as a Server Action entry point. Every
// export of a `'use server'` file MUST be an async function; types cannot be
// re-exported from here.

import { submitNpsImpl, type SubmitNpsResult } from '@/modules/nps';
import { createServerClient } from '@/shared/supabase/server';

// Cookie-bound (RLS-scoped) client; the impl authenticates via getUser() and
// writes only on the caller's own row. The client-supplied `input` is
// Zod-validated inside the impl and can never widen access.
//
// NOTE: a user who already responded (via the day-7 modal or here) gets
// `ALREADY_RESPONDED` — the write is a no-op (guarded by `nps_responded_at IS
// NULL`), so re-submitting from Configurações cannot overwrite the first answer.
export async function submitNpsFeedbackAction(input: unknown): Promise<SubmitNpsResult> {
  const supabase = await createServerClient();
  return submitNpsImpl(supabase, input);
}
