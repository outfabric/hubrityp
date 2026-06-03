'use client';

import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

import { SectionActions } from './section-actions';

/**
 * `DashboardSecondary` — the lower, "below the fold" half of the dashboard:
 * the weekly summary (Resumo) and the quick actions (Ações).
 *
 * Why a client component: two responsibilities force the client boundary here,
 * and isolating them keeps the rest of the dashboard a Server Component.
 *
 *   1. Mobile-first collapse. "Hoje" and "Pendências" stay visible at every
 *      width; Resumo + Ações are the secondary content, so on narrow viewports
 *      they collapse behind a single chevron control to keep the operational
 *      sections above the fold. At `md` and up the chevron disappears and both
 *      sections are always shown (the toggle only governs mobile).
 *
 *   2. The Ações triggers. `SectionActions` is a client component whose two
 *      creation buttons need `onClick` handlers (it deliberately does not
 *      hard-code navigation). Until the dedicated quick-create modals land,
 *      we route to the existing creation surfaces with a `?novo=1` hint —
 *      server-owned, static paths, so there is no open-redirect surface.
 *
 * The weekly summary is passed in as `weekly` (a server-rendered, Suspense-
 * wrapped slot) rather than fetched here, so this client component never
 * touches the database or any session-scoped data.
 */

export interface DashboardSecondaryProps {
  /** Server-rendered Resumo section (already wrapped in <Suspense> by the page). */
  weekly: ReactNode;
}

export function DashboardSecondary({ weekly }: DashboardSecondaryProps) {
  // Collapsed by default on mobile so the operational sections lead; the
  // chevron is the only control and it is hidden from `md` up, where the
  // content is always rendered regardless of this state.
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();

  return (
    <section data-testid="dashboard-secondary" aria-label="Resumo e ações">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls="dashboard-secondary-content"
        className="border-border-subtle text-text-secondary flex min-h-11 w-full items-center justify-between rounded-lg border px-4 text-sm font-medium md:hidden"
        data-testid="dashboard-secondary-toggle"
      >
        Resumo e ações
        <ChevronDown
          aria-hidden="true"
          className={cn('size-5 transition-transform', expanded && 'rotate-180')}
        />
      </button>

      <div
        id="dashboard-secondary-content"
        className={cn('mt-4 flex-col gap-4 md:flex', expanded ? 'flex' : 'hidden')}
        data-testid="dashboard-secondary-content"
      >
        {weekly}
        <SectionActions
          onNewPatient={() => router.push('/pacientes?novo=1')}
          onNewSession={() => router.push('/agenda?novo=1')}
        />
      </div>
    </section>
  );
}
