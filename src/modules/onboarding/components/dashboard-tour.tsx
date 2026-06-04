'use client';

import dynamic from 'next/dynamic';

export interface DashboardTourProps {
  /**
   * Server-read `profiles.tour_completed_at` (ISO string or `null`). The tour
   * auto-runs ONCE only when this is `null` — the gate is server-truth, never
   * localStorage. Passing a non-null value suppresses the auto-run; "Refazer
   * tour" can still replay it explicitly.
   */
  readonly tourCompletedAt: string | null;
  /**
   * Server Action that stamps `profiles.tour_completed_at = now()` for the
   * authenticated owner (idempotent). Invoked on finish/skip so the tour never
   * auto-runs again. Takes no payload — authorization is `auth.uid()` only.
   */
  readonly completeTour: () => Promise<void>;
}

/**
 * Client-boundary loader for the Driver.js guided tour.
 *
 * Driver.js touches `window`/`document` at module-evaluation time, so the real
 * implementation (`DashboardTourImpl`) is dynamic-imported with `ssr: false`.
 * This keeps the library and its CSS out of the server/SSR bundle and out of any
 * Server Component or the Edge middleware — Driver.js is loaded only in the
 * browser, at a leaf. `loading` is `null`: the tour is a side-effect controller
 * with no visible markup, so there is nothing to show while it loads.
 */
const DashboardTourImpl = dynamic(
  () => import('./dashboard-tour-impl').then((mod) => mod.DashboardTourImpl),
  { ssr: false, loading: () => null },
);

export function DashboardTour(props: DashboardTourProps) {
  return <DashboardTourImpl {...props} />;
}
