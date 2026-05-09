'use server';

// Thin route shell for agenda page Server Actions.
//
// The actual implementations live in `src/modules/agenda/server/` (re-exported
// from `@/modules/agenda`). This file MUST stay thin and carry the
// `'use server'` directive — that is what marks it as a Server Action entry
// point for the Next.js compiler. Every export of a `'use server'` file MUST
// be an async function; types cannot be re-exported from here.

import type { GetAgendaSettingsResult, ListSessionsResult } from '@/modules/agenda';
import { getAgendaSettingsImpl, listSessionsImpl } from '@/modules/agenda';
import { createServerClient } from '@/shared/supabase/server';

export async function listSessions(startDate: Date, endDate: Date): Promise<ListSessionsResult> {
  const supabase = await createServerClient();
  return listSessionsImpl(supabase, startDate, endDate);
}

export async function getAgendaSettings(): Promise<GetAgendaSettingsResult> {
  const supabase = await createServerClient();
  return getAgendaSettingsImpl(supabase);
}
