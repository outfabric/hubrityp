## Context

PRD 11 §5.4–5.5 define the checklist and the guided tour. The data model
(`onboarding_checklist` table, `profiles.tour_completed_at`) ships in
`onboarding-data-model`; `dashboard-home` exposes a `<FirstStepsSlot>` boundary
and a sidebar/sections DOM that the tour targets. This change fills the slot and
adds the Driver.js tour.

## Goals / Non-Goals

**Goals**
- Live, recomputed checklist (no stale flags) persisted owner-scoped.
- One-time auto-run tour, non-blocking, MVP-only, replayable.
- Design-system-compliant celebration honoring reduced-motion.

**Non-Goals**
- Gamification (badges/levels) — explicitly out of scope (PRD §3).
- Changing the dashboard sections themselves (owned by `dashboard-home`).

## Decisions

### Decision: Recompute the checklist from authoritative sources
Checklist booleans are a denormalized cache. To avoid drift (e.g., a patient
deleted after the flag flipped), `recomputeChecklist` re-derives each item from
the source tables (locations, patients, sessions, evolutions, consent, AI
settings), all filtered by `auth.uid()`, and writes the result. It runs on
dashboard render and after relevant mutations. Authorization is session-only;
any client `userId` is ignored. RLS is the backstop.

### Decision: Driver.js, client-only leaf, dynamic import
Driver.js is a vanilla-JS DOM library. It lives in a `'use client'` component
that `dynamic(() => import(...), { ssr: false })`-loads it, so it never enters a
Server Component or the Edge bundle. CSS is imported in that leaf. Steps target
stable `data-testid`/`data-tour` anchors placed on the sidebar nav and the four
dashboard surfaces by `dashboard-home`.

### Decision: Non-blocking tour configuration
Per RNF-11.05 the tour must not trap the user: `allowClose: true`, leave
`overlayClickBehavior` at its default ('close'), and render a custom always-on
"Pular tour" control. `disableActiveInteraction` stays false so the highlighted
element remains usable. On route change away from `/dashboard`, the tour is
`destroy()`-ed in an effect cleanup; it only auto-runs from the dashboard.

### Decision: Auto-run gate is server-truth (`tour_completed_at`)
The one-time auto-run is decided from `profiles.tour_completed_at` read on the
server and passed to the client leaf as a prop, not from `localStorage` (which a
user could clear to re-trigger, or which would re-trigger across devices). The
manual "Refazer tour" entry bypasses the gate intentionally.

### Decision: Celebration is CSS-only and reduced-motion aware
The completion celebration is a short (<=300ms) CSS transition/confetti-free
flourish wrapped in a `prefers-reduced-motion` guard, per design-system
prohibitions (no bouncing, no dramatic animation).

## Risks / Trade-offs

- **Risk:** tour anchors break if `dashboard-home` renames a section. *Mitigation:*
  the anchors are stable `data-tour-*` attributes owned by `dashboard-home`;
  the E2E test fails loudly if an anchor disappears.
- **Trade-off:** recompute-on-render adds a few owner-scoped count queries per
  dashboard load. Accepted — they are indexed and bounded; the dashboard already
  runs similar aggregates and they can share a request via React `cache()`.

## Migration Plan

No schema migration — uses tables/columns shipped by `onboarding-data-model`.
Only a new client dependency (`driver.js`) is added.

## Open Questions

- Whether to gate auto-run additionally on `onboarding_completed_at` (so a
  user who skipped the wizard entirely still gets the tour). Assumption: auto-run
  on first dashboard open for any user with `tour_completed_at IS NULL`,
  matching RN-11.05's wording; documented here, not a spec blocker.
