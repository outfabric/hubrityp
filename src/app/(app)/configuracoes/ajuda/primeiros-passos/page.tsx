import { Suspense } from 'react';

import { ChecklistSlot } from '@/modules/onboarding';

/**
 * Configurações → Ajuda → Primeiros passos.
 *
 * The permanent home of the onboarding checklist: unlike the dashboard mount
 * (which disappears once setup is complete), this page always shows the
 * checklist. When every mandatory item is done, `ChecklistSlot` renders the card
 * read-only (no CTAs) so the user can review their progress without re-doing
 * steps.
 *
 * Gating: the `/configuracoes` prefix is already in the `'app'` (authenticated)
 * class in `middleware.ts:classifyPath()`, so this route inherits the gate — an
 * anonymous request is redirected to /login before the page renders. The slot
 * recomputes via an RLS-scoped client (`getUser()` + `auth.uid()` scoping), so
 * even past the gate it only ever reads the caller's own data.
 */
export default function PrimeirosPassosPage() {
  return (
    <div className="flex flex-col gap-6" data-testid="settings-primeiros-passos-page">
      <header className="flex flex-col gap-1">
        <h1 className="text-text-primary text-[28px] leading-[1.25] font-semibold">
          Primeiros passos
        </h1>
        <p className="text-text-secondary text-sm">
          Acompanhe a configuração inicial do seu consultório.
        </p>
      </header>

      <Suspense fallback={null}>
        <ChecklistSlot />
      </Suspense>
    </div>
  );
}
