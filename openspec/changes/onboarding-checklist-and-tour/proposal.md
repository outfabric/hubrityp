## Why

PRD 11 §5.4–5.5 require two engagement features on the dashboard: a persistent
first-steps checklist that nudges the psychologist toward the first value cycle
(cadastrar paciente → agendar → registrar evolução), and a one-time guided tour
that orients them on first dashboard open. The data foundation (the
`onboarding_checklist` table + `tour_completed_at`) ships in
`onboarding-data-model`; the dashboard exposes a first-steps slot in
`dashboard-home`. This change fills both: the checklist card with live
completion logic, and the Driver.js tour.

## What Changes

- Checklist card (RF-11.09): persistent on the dashboard until 100% of the
  mandatory items are done; expandable card at the top when items are pending.
  Renders the seven items (six mandatory + AI-transcription bonus) with live
  completion derived from real data, and the per-item action targets.
- Live completion recompute: a `recomputeChecklist` Server Action / read helper
  that derives each item's done-state from authoritative sources (locations,
  patients, sessions, evolutions, consent, AI settings) rather than trusting a
  cached flag, and persists the result to `onboarding_checklist`.
- Bonus item (RF-11.10): AI-transcription item carries a "Bônus" badge and does
  NOT block 100%.
- Completion celebration (RF-11.11): on all mandatory items done, a discreet
  (design-system-compliant, <300ms, reduced-motion-aware) celebration + message,
  then the card collapses and remains available under Configurações > Ajuda.
- Guided tour (RF-11.12–11.14): Driver.js 5-tooltip tour over the sidebar nav,
  Seção Hoje, Seção Pendências, "+ Novo paciente", "+ Nova sessão". Runs
  automatically ONCE for users with `onboarding_completed_at`/`tour_completed_at`
  semantics (RN-11.05). "Pular tour" always visible; clicking outside skips the
  step (non-blocking, RNF-11.05). Tour NEVER mentions post-MVP features.
- Tour replay entry under Configurações > Ajuda > Refazer tour (RF-11.13), and
  pause/resume when the user navigates away from the dashboard mid-tour.

## Capabilities

### New Capabilities
- `onboarding-checklist`: the checklist card, live completion recompute,
  bonus-item handling, and completion celebration.
- `onboarding-tour`: the Driver.js guided tour, one-time auto-run gating, replay
  entry, and non-blocking/pause behavior.

### Modified Capabilities
<!-- dashboard-home already exposes the FirstStepsSlot boundary; filling it is
     additive composition, not a requirement change to dashboard-home. -->

## Impact

- **Dependency**: add `driver.js` to `package.json` (client-only; imported in a
  `'use client'` leaf, never in a Server Component or the Edge middleware).
- **Module**: `src/modules/onboarding/` gains `components/checklist-*` and
  `components/tour-*`, plus `server/recompute-checklist.ts` and a
  `complete-tour` action.
- **Routes**: fills the `<FirstStepsSlot>` in `/dashboard`; adds a "Refazer
  tour" + "Primeiros passos" entry under `/configuracoes` (Ajuda).
- **Reuse**: reads via `@/modules/dashboard` / existing module helpers; writes
  the checklist row via the RLS-scoped client.
- **Security/LGPD**: recompute + complete-tour authenticate via `getUser()` and
  write only the session owner's rows; no client-supplied id is trusted. The
  tour is presentation-only (no data writes beyond `tour_completed_at`). No PII
  in logs; checklist counts carry no clinical content.
