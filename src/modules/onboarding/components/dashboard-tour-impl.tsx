'use client';

import { type Driver, driver } from 'driver.js';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

import 'driver.js/dist/driver.css';

import { TOUR_STEPS } from '../lib/tour-steps';

import type { DashboardTourProps } from './dashboard-tour';

/**
 * Custom DOM event that replays the tour past the `tour_completed_at` gate,
 * dispatched when the user is already on `/dashboard`. Using a window event
 * keeps the replay trigger decoupled — any control on the dashboard can request
 * a replay without prop-drilling a handler through the page.
 */
export const REPLAY_TOUR_EVENT = 'hubrityp:start-tour';

/**
 * Query-string flag that requests a tour replay. The "Refazer tour" control
 * under Configurações → Ajuda (a different route, where this leaf is NOT
 * mounted) cannot dispatch the window event, so it navigates to
 * `/dashboard?tour=replay`; the freshly-mounted leaf reads this flag and starts
 * the tour regardless of `tour_completed_at`, then strips the flag from the URL
 * so a refresh does not loop.
 */
export const REPLAY_TOUR_PARAM = 'tour';
const REPLAY_TOUR_VALUE = 'replay';

/**
 * `DashboardTourImpl` — the Driver.js-backed guided tour (client leaf).
 *
 * This component owns the only Driver.js import in the app. It is always loaded
 * through `dynamic(ssr:false)` (see `dashboard-tour.tsx`) so neither Driver.js
 * nor its CSS ever reaches a Server Component or the Edge middleware: the
 * library touches `window`/`document` at module scope and would crash SSR.
 *
 * Behavior (PRD 11 §5.5 + onboarding-tour spec):
 *   - Renders nothing — it is a pure side-effect controller over the existing
 *     `data-tour-*` anchors on the dashboard.
 *   - Auto-runs ONCE, only when `tourCompletedAt` is `null`. The gate is
 *     server-truth (a `profiles.tour_completed_at` prop), never localStorage.
 *   - Non-blocking: `allowClose: true`, default `overlayClickBehavior` ('close'),
 *     `disableActiveInteraction: false`. A "Pular tour" close button shows on
 *     every step (`showButtons` includes 'close').
 *   - On finish OR skip, Driver fires `onDestroyed` exactly once → we call
 *     `completeTour()` (idempotent server stamp) so the tour never auto-runs
 *     again, on any device.
 *   - `destroy()` runs on unmount AND on route change (the `pathname` effect
 *     dependency), so navigating away never leaves a dangling overlay.
 *   - "Refazer tour" dispatches `REPLAY_TOUR_EVENT`; we start the tour
 *     regardless of `tourCompletedAt` (the gate only governs the auto-run).
 */
export function DashboardTourImpl({ tourCompletedAt, completeTour }: DashboardTourProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const driverRef = useRef<Driver | null>(null);

  // Keep the latest `completeTour` in a ref so the Driver instance's
  // `onDestroyed` closure always calls the current action without forcing the
  // tour to be torn down and rebuilt when the prop identity changes. Updating
  // the ref in an effect (not during render) keeps React's render phase pure.
  const completeTourRef = useRef(completeTour);
  useEffect(() => {
    completeTourRef.current = completeTour;
  }, [completeTour]);

  // Build (or rebuild) the Driver instance and start the tour. `bypassGate` is
  // true for the explicit "Refazer tour" replay, which must run even after the
  // user has completed the tour once.
  const startTour = useCallback(() => {
    // Tear down any in-flight instance before starting a fresh one (e.g. a
    // replay requested while a previous run is still active).
    driverRef.current?.destroy();

    const instance = driver({
      allowClose: true,
      // Default close-on-overlay-click behavior — the tour is non-blocking; the
      // user can dismiss it at any moment.
      overlayClickBehavior: 'close',
      disableActiveInteraction: false,
      // The close ("Pular tour") control is present on every step.
      showButtons: ['next', 'previous', 'close'],
      nextBtnText: 'Próximo',
      prevBtnText: 'Anterior',
      doneBtnText: 'Concluir',
      // The close button doubles as the always-visible "Pular tour" control.
      progressText: '{{current}} de {{total}}',
      showProgress: true,
      steps: TOUR_STEPS.map((step) => ({
        element: step.anchor,
        popover: {
          title: step.title,
          description: step.description,
          closeBtnText: 'Pular tour',
        },
      })),
      // Fired once when the tour ends — whether the user reached the last step
      // or skipped/closed early. We stamp completion so the auto-run never
      // fires again. The stamp is idempotent and a no-op on replay.
      onDestroyed: () => {
        void completeTourRef.current().catch(() => {
          // Stamping is best-effort: a failed write only means the tour may
          // auto-run again next time, which is acceptable and self-healing.
        });
      },
    });

    driverRef.current = instance;
    instance.drive();
  }, []);

  // Auto-run gate: start exactly once on mount when the server says the tour was
  // never completed. The empty-ish dependency list (only the boolean derived
  // from the server prop) ensures a single auto-run per mount; client storage is
  // never consulted.
  const shouldAutoRun = tourCompletedAt === null;
  useEffect(() => {
    if (!shouldAutoRun) return;
    startTour();
  }, [shouldAutoRun, startTour]);

  // Replay trigger (same-page): a control already on the dashboard dispatches
  // REPLAY_TOUR_EVENT on window. We start regardless of the completion gate (the
  // gate governs auto-run only).
  useEffect(() => {
    const handleReplay = () => startTour();
    window.addEventListener(REPLAY_TOUR_EVENT, handleReplay);
    return () => window.removeEventListener(REPLAY_TOUR_EVENT, handleReplay);
  }, [startTour]);

  // Replay trigger (cross-page): "Refazer tour" under Configurações → Ajuda
  // navigates here with `?tour=replay`. Start the tour past the gate, then strip
  // the flag from the URL (replace, not push) so a refresh does not re-trigger.
  const replayRequested = searchParams.get(REPLAY_TOUR_PARAM) === REPLAY_TOUR_VALUE;
  useEffect(() => {
    if (!replayRequested) return;
    startTour();
    router.replace(pathname);
  }, [replayRequested, startTour, router, pathname]);

  // Destroy the active tour on route change and on unmount, so navigating away
  // never leaves a dangling overlay/popover. Re-running on `pathname` change is
  // the route-change cleanup; the returned cleanup is the unmount cleanup.
  useEffect(() => {
    return () => {
      driverRef.current?.destroy();
      driverRef.current = null;
    };
  }, [pathname]);

  return null;
}
