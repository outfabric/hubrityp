import { getWeeklySummary } from '@/modules/dashboard';
import { createServerClient } from '@/shared/supabase/server';

import { SectionWeekly } from './section-weekly';

/**
 * `WeeklySummarySlot` — async Server Component that fetches the weekly summary
 * and renders `SectionWeekly`.
 *
 * It exists so the page can drop it inside `<Suspense fallback={<SectionWeeklySkeleton />}>`:
 * the day's data (Hoje + Pendências) paints immediately while this slower
 * aggregate streams in behind the skeleton, instead of the whole page blocking
 * on the slowest query.
 *
 * Security: it builds its own request-scoped Supabase client and delegates
 * authn/authz to `getWeeklySummary`, which authenticates via `getUser()` and
 * scopes every metric to `auth.uid()`. If the session is missing/invalid the
 * helper returns `UNAUTHORIZED` and we render nothing rather than a partial UI —
 * the middleware + page-level profile check are the authoritative gates that
 * make this branch unreachable in practice.
 */
export async function WeeklySummarySlot() {
  const supabase = await createServerClient();
  const result = await getWeeklySummary(supabase);

  if (!result.ok) {
    return null;
  }

  return <SectionWeekly result={result} />;
}
