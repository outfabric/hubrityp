'use server';

// Thin route shell for analytics / message-history Server Actions.
//
// The actual implementations live in `src/modules/whatsapp/server/inbox/`
// (re-exported from `@/modules/whatsapp`). This file carries `'use server'`
// so Next.js treats every export as a Server Action entry point.

import type {
  AnalyticsSummaryInput,
  GetAnalyticsSummaryResult,
  SearchMessageHistoryResult,
} from '@/modules/whatsapp';
import { getAnalyticsSummaryImpl, searchMessageHistoryImpl } from '@/modules/whatsapp';
import { createServerClient } from '@/shared/supabase/server';

export async function getAnalyticsSummary(
  input: AnalyticsSummaryInput = {},
): Promise<GetAnalyticsSummaryResult> {
  const supabase = await createServerClient();
  return getAnalyticsSummaryImpl(supabase, input);
}

export async function searchMessageHistory(rawInput: unknown): Promise<SearchMessageHistoryResult> {
  const supabase = await createServerClient();
  return searchMessageHistoryImpl(supabase, rawInput);
}
