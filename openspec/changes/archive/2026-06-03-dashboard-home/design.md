## Context

PRD 11 §5.3 + §6 (RNF) require an operational dashboard that loads in <1.5s with
the day's data prioritized. All data is MVP-only (agenda, patients, prontuário,
AI transcription) and must be strictly owner-scoped (RN-11.04). The existing
`/dashboard` page is a placeholder; the existing middleware already gates
`/dashboard*`.

## Goals / Non-Goals

**Goals**
- Four sections computed from existing modules, owner-scoped via RLS.
- First paint < 1.5s: parallel fetches, weekly summary streamed.
- Graceful empty state delegating to the first-steps checklist slot.

**Non-Goals**
- The checklist component itself (owned by `onboarding-checklist-and-tour`) — this
  change only exposes the slot + "has any data" detection.
- The notification bell (owned by `in-app-notifications-and-nps`).
- Any post-MVP section (financial, Receita Saúde) — explicitly excluded.

## Decisions

### Decision: New `dashboard` module owns aggregate read queries
A `src/modules/dashboard/server/` holds read-only aggregate queries
(`getTodaySessions`, `getPendencias`, `getWeeklySummary`, `hasAnyData`), each
taking the RLS-scoped Supabase/Drizzle client. They authenticate via `getUser()`
and never accept a caller-supplied user id — `auth.uid()` + RLS is the only
scope. This keeps the page a thin composition layer.

### Decision: Stream the weekly summary, render the day synchronously
Seção Hoje + Pendências are awaited in `Promise.all` and rendered first. Seção
Resumo da semana is wrapped in `<Suspense>` with a skeleton fallback so the
slower aggregate (no-show rate, monthly counts) never blocks the day's data.
This satisfies RNF-11.01 (<1.5s) without a client waterfall.

### Decision: Pendências are MVP-allowlisted, not blocklisted
The pendências section computes only the three MVP types. Post-MVP types are not
"hidden" — they are simply never queried, so a future module can't accidentally
leak a placeholder. A render test asserts the absence of post-MVP strings.

### Decision: `first_access_at` stamped idempotently on the dashboard
PRD 11 ties the day-7 NPS trigger to first access. The dashboard is the first
authenticated surface a completed user reliably hits. The page performs an
idempotent `UPDATE profiles SET first_access_at = now() WHERE id = auth.uid()
AND first_access_at IS NULL` (the `IS NULL` guard makes re-renders no-ops). The
NPS scheduling itself lives in the notifications/NPS change.

### Decision: "Abrir sessão" routing decided server-side by modality
The next-session CTA target is computed server-side from the session's modality
(`online` → video room, `in_person` → patient file). The href is built from the
owner's own session row, not from any client-supplied param, avoiding an
open-redirect/IDOR sink.

## Risks / Trade-offs

- **Risk:** the overdue-evolutions query (done sessions >7d without an evolution)
  is a join/anti-join that could be slow. *Mitigation:* it filters by
  `user_id = auth.uid()` (indexed) and a bounded date window; validated in the
  integration test against real Postgres.
- **Trade-off:** streaming the weekly summary adds a skeleton state. Accepted —
  it is the design-system loading pattern and protects the <1.5s budget.

## Migration Plan

No schema migration — reads only over existing tables plus the additive
`first_access_at` column shipped by `onboarding-data-model`.

## Open Questions

- "Enough data" threshold for the no-show rate: assume a small fixed minimum
  (e.g. >= 5 completed-or-no-show sessions) documented in the helper; tunable
  later without a spec change.
