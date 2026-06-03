import 'server-only';

import { createServerClient } from '@/shared/supabase/server';

import { mandatoryCompletePct } from '../lib/checklist-items';
import { recomputeChecklistImpl } from '../server/recompute-checklist';

import { ChecklistCard } from './checklist-card';

/**
 * `ChecklistSlot` — server boundary that feeds the onboarding checklist card.
 *
 * This is the only place that reads checklist data: it builds an RLS-scoped
 * Supabase client (carrying the caller's session cookies), recomputes the
 * authenticated owner's checklist via `recomputeChecklistImpl` (which
 * authenticates with `getUser()` and scopes every probe to `auth.uid()`), and
 * hands the derived per-item state to the `ChecklistCard` client leaf as a prop.
 * No client-supplied input reaches this path, and no PII crosses the boundary —
 * only the seven booleans the card needs.
 *
 * Render policy:
 *   - `hideWhenComplete` (the dashboard mount): if every mandatory item is done,
 *     the card has served its first-run purpose and we render nothing, so the
 *     dashboard does not carry a permanent banner. The checklist stays reachable
 *     under Configurações → Ajuda → Primeiros passos.
 *   - Otherwise (Configurações → Ajuda): always render, read-only once complete.
 *
 * On an unauthenticated recompute we render nothing rather than leaking a shell.
 * The middleware (gated `/dashboard*` and `/configuracoes*`) is the real gate;
 * this null-render is defense in depth.
 */

export interface ChecklistSlotProps {
  /**
   * When `true`, render nothing once the mandatory checklist is 100% complete
   * (used at the top of `/dashboard`, where the card should disappear after the
   * user finishes setup). Defaults to `false` (Configurações → Ajuda mount,
   * which keeps the checklist visible and read-only when complete).
   */
  readonly hideWhenComplete?: boolean;
}

export async function ChecklistSlot({ hideWhenComplete = false }: ChecklistSlotProps) {
  const supabase = await createServerClient();
  const result = await recomputeChecklistImpl(supabase);

  if (!result.ok) {
    return null;
  }

  const complete = mandatoryCompletePct(result.state) === 100;

  if (hideWhenComplete && complete) {
    return null;
  }

  return <ChecklistCard state={result.state} readOnly={complete} />;
}
