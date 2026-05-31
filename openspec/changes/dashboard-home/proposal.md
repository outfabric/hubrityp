## Why

PRD 11 §5.3 defines the dashboard as the screen the psychologist opens every
day — it must be operational from day one, not a welcome placeholder. The
current `/dashboard` page renders only a greeting. This change turns it into the
four-section operational dashboard (Hoje, Pendências, Resumo da semana, Ações
rápidas) computed strictly from MVP data (agenda, patients, prontuário, AI
transcription), with a graceful empty state that surfaces the first-steps
checklist when there is no data yet (RF-11.08).

## What Changes

- Replace the placeholder `/dashboard` page with the four-section operational
  layout (RF-11.06), responsive per RF-11.07 (mobile prioritizes Hoje +
  Pendências; Resumo + Ações collapsed).
- **Seção 1 — Hoje**: next session of the day + compact list of the day's
  sessions; "Abrir sessão" routes to the video room (online) or patient file
  (in-person). Empty state CTA to schedule.
- **Seção 2 — Pendências**: MVP-only pendências — evoluções em atraso (done
  sessions >7 days without evolution), patients without `consent_signed_at`, AI
  notes awaiting review. Explicitly excludes post-MVP pendências.
- **Seção 3 — Resumo da semana**: sessions done/scheduled this week, no-show
  rate (when enough data), new patients this month, evolutions this week —
  computed ONLY over the logged-in psychologist's data (RN-11.04), with graceful
  empty states. Loaded in a non-blocking `<Suspense>` boundary so the day's data
  paints first (RNF-11.01).
- **Seção 4 — Ações rápidas**: quick-create patient/session modals (reuse PRD 02
  / PRD 03 modals) + links to agenda/pacientes.
- **Empty state**: zero patients + zero sessions shows the first-steps checklist
  in place of the normal sections (the checklist component itself ships in
  `onboarding-checklist-and-tour`; this change exposes the empty-state slot and
  the "has any data" detection).
- New `dashboard` module surface with read-only, RLS-scoped aggregate queries.
- Sets `profiles.first_access_at` on the first authenticated dashboard render
  (consumed later by the NPS day-7 trigger).

## Capabilities

### New Capabilities
- `dashboard-home`: the operational dashboard page, its four sections, the
  MVP-only pendências/metrics aggregate queries, responsive + empty-state
  behavior, and the `first_access_at` stamp.

### Modified Capabilities
- `dashboard-shell`: the `/dashboard` page requirement evolves from "greeting +
  logout" to the full operational dashboard; the greeting/logout remain part of
  the authenticated shell.

## Impact

- **Routes**: `src/app/(app)/dashboard/page.tsx` (rewritten),
  plus section components.
- **Module**: new `src/modules/dashboard/` with `server/` (aggregate read
  queries) and `components/` (section UIs), `index.ts` barrel.
- **Reuse**: `@/modules/agenda` (sessions), `@/modules/patients`,
  `@/modules/medical-records` (evolutions), `@/modules/ai-transcription`
  (notes-ready count), `@/modules/registration` (profile + first_access stamp).
- **Security/LGPD**: every aggregate query authenticates via `getUser()` and is
  RLS-scoped to the owner — no cross-tenant aggregation (RN-11.04). No benchmark/
  market-norm numbers. Pendências counts carry no clinical content. Patient names
  shown in "Hoje" come only from the owner's own rows. No PII in logs.
- **Perf**: day data and week summary fetched in parallel; week summary behind
  `<Suspense>` to keep first paint under 1.5s.
