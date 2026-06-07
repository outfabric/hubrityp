## Why

The dashboard counts "sessões sem evolução" correctly and links to `/agenda?filtro=sem-evolucao`, but the agenda page **ignores the parameter**: it always hardcodes the current week and renders the calendar. The overdue sessions are, by definition, older than 7 days — so they fall outside the current-week viewport and **don't even appear**. Clicking "Ver" drops the psychologist on this week's empty-looking calendar with no way to find or resolve the pendência (PRD 12, §1.1). This is the most broken of the three destinations and the one with direct CFP exposure (Resolução CFP 001/2009 obliges an evolution per session).

This change closes the loop for Destination A by rendering, when the filter is active, a **list view** (a product decision — RN-12.01) of exactly the sessions in the count, oldest-first, each with a one-click path to register the evolution.

## What Changes

- **Owner-scoped overdue query (RF-12.04/RN-12.03):** add `listOverdueEvolutionsImpl` to the agenda module, reusing the **same predicate as the dashboard count** — `sessions.status = 'done' AND start_at < (now − 7 days) AND deleted_at IS NULL` anti-joined against `evolutions` by `session_id`, scoped `user_id = auth.uid()`. Not reimplemented in the page.
- **List view, not calendar (RF-12.05/RN-12.01):** when `/agenda` is loaded with `filtro=sem-evolucao`, the route renders a server-rendered **list** instead of the week calendar. Without the param (or with an unknown one), the calendar renders unchanged.
- **Not week-bounded, oldest-first (RF-12.06/12.07):** the list covers all eligible sessions regardless of date; ordered oldest→newest so the highest-risk (longest-overdue) item is first.
- **Row contents + CTA (RF-12.08):** each row shows patient name, session date/time (São Paulo tz), modality when available, elapsed time without evolution ("há N dias"), and a primary **"Registrar evolução"** CTA linking to `/pacientes/{patientId}/prontuario/evolucoes/nova?sessionId={sessionId}` (the existing evolution route).
- **Removable filter chip (RF-12.09/RNF-12.03):** an a11y-announceable chip ("Sem evolução · N") with a remove control that drops `filtro` from the URL and returns to the **calendar** default.
- **Resolve-and-decrement without manual reload (RF-12.10):** after an evolution is registered for a listed session, returning to the list reflects the removed row and decremented count via a fresh server render (the list is a dynamic, uncached RSC; the evolution-create success path revalidates `/agenda`).
- **Closed allowlist + graceful degradation (RF-12.03/RN-12.05):** the only accepted `filtro` value is `sem-evolucao`; unknown/empty/array values render the default calendar with no error. Validated server-side (RNF-12.05).
- **Count parity + positive empty state (RF-12.18/12.19):** the list header count equals the dashboard count at the same instant; reaching the destination with zero items shows "Nenhuma sessão sem evolução. Tudo em dia. 🎉" with a link to the full agenda — never the calendar unexplained.
- **First-paint + mobile (RNF-12.01/12.04):** filtering is applied server-side via `searchParams`; the list (vs. calendar) is mobile-friendly.

This change does **not** alter the overdue business rule (the 7-day window stays — RN-12.04), the calendar's existing day/week/month behavior, the evolutions data model, or the evolution-create flow (reused as-is).

## Capabilities

### New Capabilities

- `agenda-overdue-evolutions-list`: the `/agenda?filtro=sem-evolucao` list-mode destination — the owner-scoped overdue-without-evolution query (reusing the count predicate), the list view that replaces the calendar when the filter is active, oldest-first ordering, per-row fields + "Registrar evolução" CTA, the removable active-filter chip (→ back to calendar), the closed-allowlist degradation, resolve-and-decrement-on-return, count parity with the dashboard, the positive empty state, and owner-scope/cross-tenant guarantees.

### Modified Capabilities

_None._ The calendar's `agenda-views` requirements are unchanged (they describe the default, no-param view, which still holds). The evolution route/data model is reused unchanged.

## Impact

- **Code:**
  - `src/app/(app)/agenda/page.tsx` — read/validate `searchParams.filtro`; branch to the list view when `sem-evolucao`, else the existing calendar. Keep the `<Suspense>` boundary.
  - `src/modules/agenda/server/list-overdue-evolutions.ts` (new, barrel-exported) — the overdue query reusing the count predicate; returns per-row `{ sessionId, patientId, patientName, startAt, modality?, daysOverdue }`, ordered `start_at ASC`. Owner-scoped + RLS.
  - `src/modules/agenda/components/` — a new list view + row + the active-filter chip (Sálvia primitives).
  - `src/modules/agenda/lib/` — small `filtro` allowlist parser (mirrors changes 1–2) + a "days overdue in São Paulo tz" helper (reuse existing date helpers).
  - Evolution-create success path — `revalidatePath('/agenda')` so the resolved row disappears on return (RF-12.10), behind the existing create flow (no behavior change to the form itself).
- **Routes/auth:** no new routes. `/agenda` is already middleware-gated; a **negative-auth E2E** for the deep-link and a **cross-tenant scope** test (RN-12.02) are owed.
- **Data model / migrations:** none. (The count predicate is already served; note an optional composite/partial index on `sessions(user_id, status, start_at)` as a future perf tweak — not in this change.)
- **Security/LGPD:** the list is owner-scoped server-side + RLS; no `filtro`/URL value exposes another professional's sessions (RN-12.02). Rows carry patient name only at the destination (already authenticated), consistent with the dashboard carrying counts-only. No PII in logs.
- **Tests:** unit (allowlist parser; days-overdue tz helper), integration (`listOverdueEvolutionsImpl` parity with the count predicate; not week-bounded; oldest-first; excludes done-with-evolution and soft-deleted; cross-tenant scope), E2E (dashboard "Ver" → list not calendar; oldest-first; "Registrar evolução" opens the right session's evolution; resolve → row gone + count decremented on return; remove chip → calendar; unknown filtro → calendar; empty → positive state; anonymous → `/login`).
- **Dependencies:** reuses the allowlist pattern from `fix-pendencia-ai-notes-deeplink`; reuses the evolution route (PRD 05). Independent of the other two PRD-12 changes.
