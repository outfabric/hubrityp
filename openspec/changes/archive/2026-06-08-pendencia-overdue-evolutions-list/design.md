# Design — pendencia-overdue-evolutions-list

## Context

Verified current state:

- `src/app/(app)/agenda/page.tsx` — Server Component. `AgendaDataServer` hardcodes the current week (`startOfWeek`/`endOfWeek`), fetches via `listSessionsImpl(supabase, weekStart, weekEnd)` + settings + locations, and renders `<AgendaCalendarLoader>` inside `<Suspense>`. **Reads no `searchParams`.**
- `src/modules/agenda/server/list-sessions.ts` — week-bounded; not reusable for the unbounded overdue set. Pattern to follow: `getUser()`, owner-scoped, joins `patients` for names, batches couple names.
- Dashboard count predicate (`get-pendencias.ts`): `sessions.status = 'done' AND start_at < now−7d AND deleted_at IS NULL`, `LEFT JOIN evolutions ON evolutions.session_id = sessions.id` with `evolutions.id IS NULL`, owner-scoped — the single source of truth to reuse (RN-12.03/12.04).
- Evolution CTA route exists: `/pacientes/[id]/prontuario/evolucoes/nova` accepts `?sessionId=`. Its route action `createEvolution` (`.../nova/actions.ts`) wraps `createEvolutionImpl` from `@/modules/medical-records` and currently does **no** `revalidatePath`.
- São Paulo helpers exist in `src/modules/agenda/lib/date-helpers.ts`: `toSaoPauloTime`, `formatSessionDate`, `formatSessionTime`.

## Goals / Non-goals

**Goals**
- `/agenda?filtro=sem-evolucao` renders an unbounded, oldest-first **list** of overdue-evolution sessions with a register CTA, removable chip, count parity, positive empty state, and resolve-and-decrement on return.

**Non-goals**
- No change to the 7-day rule (RN-12.04), the calendar's day/week/month behavior, the evolutions data model, or the evolution form.
- No batch resolution, no calendar redesign.

## Decisions

### D1 — `filtro` allowlist parser (server-side)

Add `src/modules/agenda/lib/agenda-list-filter.ts`:

```ts
export const AGENDA_LIST_FILTERS = ['sem-evolucao'] as const;
export type AgendaListFilter = (typeof AGENDA_LIST_FILTERS)[number];

/** Closed allowlist. Unknown/empty/array → null (default calendar). Never throws. */
export function resolveAgendaListFilter(
  raw: string | string[] | undefined,
): AgendaListFilter | null {
  return typeof raw === 'string' && (AGENDA_LIST_FILTERS as readonly string[]).includes(raw)
    ? (raw as AgendaListFilter)
    : null;
}
```

Mirrors changes 1–2 (RF-12.03 / RNF-12.05). Barrel-exported.

### D2 — `listOverdueEvolutionsImpl` (new owner-scoped query)

Add `src/modules/agenda/server/list-overdue-evolutions.ts`, barrel-exported, modeled on `list-sessions.ts`:

```ts
export interface OverdueEvolutionItem {
  sessionId: string;
  patientId: string;
  patientName: string;
  startAt: Date;
  modality: 'presencial' | 'online' | null; // best-effort, from the session's location/type
  daysOverdue: number;                        // elapsed full days since startAt
}
export type ListOverdueEvolutionsResult =
  | { ok: true; items: OverdueEvolutionItem[] }
  | { ok: false; code: 'UNAUTHORIZED' };
```

- `getUser()` → `userId`; `LEFT JOIN evolutions ON evolutions.session_id = sessions.id`; `WHERE userId = uid AND status='done' AND deleted_at IS NULL AND start_at < (now − 7d) AND evolutions.id IS NULL`; `INNER JOIN patients` for `patientName`; `ORDER BY start_at ASC`. **Identical predicate to the count** → header parity is structural (RF-12.18).
- `daysOverdue` computed via a pure helper `overdueDays(startAt, now)` = `Math.floor((now − startAt) / MS_PER_DAY)` (elapsed duration — independent of SP-midnight, so no timezone-boundary flakiness). The display **date/time** uses the existing SP helpers (RF row scenario / RNF-12.04).
- `modality` resolved from the same session/location data the calendar uses, rendered only when available (RF-12.08 "se disponível").
- Owner-scoped server-side **and** RLS; no caller id accepted (RN-12.02).

### D3 — Page branches list vs. calendar on `filtro`

`AgendaPage` becomes `async`, reads `searchParams`, and resolves the filter:

```ts
const { filtro } = await searchParams;
const view = resolveAgendaListFilter(filtro); // 'sem-evolucao' | null
// inside <Suspense>: view === 'sem-evolucao'
//   ? <OverdueEvolutionsListServer />
//   : <AgendaDataServer />   (unchanged calendar path)
```

- First-paint correctness (RNF-12.01): the branch is decided server-side from `searchParams` — no calendar flash before the list.
- Unknown/absent `filtro` → `null` → calendar unchanged (RF-12.03 / RN-12.05).
- The list inner component (`OverdueEvolutionsListServer`) calls `listOverdueEvolutionsImpl` and renders the list/empty state.

### D4 — List UI (server list + client chip)

- `src/modules/agenda/components/overdue-evolutions-list.tsx` — **Server Component**: renders the header with count, the rows, and the empty state. Each row shows patient name, SP date/time, modality (when present), "há N dias", and a `next/link` CTA "Registrar evolução" → `/pacientes/{patientId}/prontuario/evolucoes/nova?sessionId={sessionId}`. Patient names stay server-rendered.
- The **active-filter chip** is a small `'use client'` leaf (`overdue-filter-chip.tsx`): renders "Sem evolução · N" (Sálvia `Badge`) + a keyboard-focusable remove control (`aria-label`) that `router.replace`s `/agenda` without `filtro` → calendar (RF-12.09/RNF-12.03).
- Empty state: when `items.length === 0`, render "Nenhuma sessão sem evolução. Tudo em dia. 🎉" + link to `/agenda` (RF-12.19) — not the calendar.
- Read `docs/design-system/rules.md` before building; reuse existing list/card/badge primitives for visual parity (RN with the patients destination's chip).

### D5 — Resolve-and-decrement without manual reload (RF-12.10)

- The CTA navigates to the evolution form (separate route); on successful save the form already returns the user toward the prontuário. The overdue list reflects the resolution because:
  1. `OverdueEvolutionsListServer` is a **dynamic, uncached** RSC (depends on cookies + `searchParams`), so a fresh navigation re-queries; **and**
  2. the `createEvolution` route action (`.../nova/actions.ts`) calls `revalidatePath('/agenda')` on success, invalidating any client router-cache entry so the next visit to the list is fresh — row gone, count `N−1`.
- **Coupling note:** adding `revalidatePath('/agenda')` to the generic `createEvolution` action is a single line at the **app/route layer** (not inside `medical-records`), and is semantically correct — creating an evolution resolves an agenda pendência. It is cheap (marks a path stale) and harmless for evolutions created outside this flow. Chosen over deeper coupling (module→module) or a flakier client `router.refresh()` on focus.

## Security / LGPD

- Owner-scoped server-side + RLS; no `filtro`/URL value renders another professional's sessions (RN-12.02) — **cross-tenant integration test mandatory**.
- `/agenda` already middleware-gated; **negative-auth E2E** for the deep-link owed.
- The list carries patient names only at the authenticated destination (the dashboard carries counts only) — consistent with PRD §11. No PII in logs (reuse the module's structured logger with ids only).
- Allowlist validation blocks URL-injected view switching (RNF-12.05).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Overdue list not refreshing after resolution | Dynamic uncached RSC + `revalidatePath('/agenda')` on evolution-create success (D5). |
| SP-midnight boundary flakiness in "há N dias" | Use elapsed-duration floor, not SP-calendar-day boundaries (D2); unit-test with injected `now`. |
| New unbounded query seq-scans at scale | Owner-scope index already serves it; note an optional composite index `sessions(user_id, status, start_at)` as a future tweak (no migration here). |
| Modality not present on all sessions | Render only when available (RF-12.08 "se disponível"); never block a row on it. |
| Branching the agenda page regresses the calendar path | The calendar branch (`AgendaDataServer`) is untouched; only an `if (view === 'sem-evolucao')` is added around it. |

## Test strategy

- **Unit** (`src/__tests__/unit/modules/agenda/lib/`): `resolveAgendaListFilter` allowlist; `overdueDays(startAt, now)` with injected `now` (e.g. 16d, 7d boundary, <7d).
- **Integration** (`src/__tests__/integration/agenda/`): `listOverdueEvolutionsImpl` — parity with the count predicate; oldest-first; **not** week-bounded (includes weeks-old sessions); excludes done-with-evolution, non-`done`, soft-deleted, and within-7-days; `patientName` resolved; **cross-tenant scope** (A never sees B).
- **E2E (seeded)** (`src/__tests__/e2e/seeded/agenda/`):
  - Dashboard "Ver" (sessões sem evolução) → `/agenda?filtro=sem-evolucao` renders the **list** (not the calendar); items oldest-first; chip count matches.
  - "Registrar evolução" href is `/pacientes/{patientId}/prontuario/evolucoes/nova?sessionId={sessionId}` and opens that session's evolution.
  - Resolve flow: register an evolution for a listed session → return to the list → that row is gone and the count decremented (RF-12.10).
  - Remove chip → URL drops `filtro`, calendar returns; unknown `?filtro=xyz` → calendar, no error (RF-12.16).
  - Empty → "Tudo em dia. 🎉" positive state with link to the full agenda.
  - **Negative-auth:** anonymous `/agenda?filtro=sem-evolucao` → `/login`.

## Rollout

Forward-only, no migration, reversible by reverting the page branch, the new query/components/helpers, and the one-line `revalidatePath`. Reuses the allowlist pattern from `fix-pendencia-ai-notes-deeplink`; independent of the other two PRD-12 changes.
