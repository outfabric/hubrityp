## 1. Allowlist parser + days-overdue helper

- [ ] 1.1 Create `src/modules/agenda/lib/agenda-list-filter.ts` exporting `AGENDA_LIST_FILTERS`, `AgendaListFilter`, and `resolveAgendaListFilter(raw: string | string[] | undefined): AgendaListFilter | null` (closed allowlist `['sem-evolucao']`; unknown/empty/array → null; never throws — design D1, RF-12.03/RNF-12.05).
- [ ] 1.2 Add a pure `overdueDays(startAt: Date, now: Date): number` helper (elapsed full days, duration-based, not SP-midnight) in `src/modules/agenda/lib/` (design D2). Barrel-export the parser + type.
- [ ] 1.3 Unit test `src/__tests__/unit/modules/agenda/lib/agenda-list-filter.test.ts` (`'sem-evolucao'→…`, `'xyz'/''/undefined/array→null`) and `overdue-days.test.ts` (16d, the 7d boundary, <7d, with injected `now`). Run `npm run test:unit`.

## 2. Overdue-evolutions query

- [ ] 2.1 Create `src/modules/agenda/server/list-overdue-evolutions.ts` (`listOverdueEvolutionsImpl`) reusing the count predicate: `getUser()`; `LEFT JOIN evolutions ON session_id` with `evolutions.id IS NULL`; `WHERE userId = uid AND status='done' AND deleted_at IS NULL AND start_at < now−7d`; `INNER JOIN patients` for name; `ORDER BY start_at ASC`. Return `{ ok, items: OverdueEvolutionItem[] }` with `{ sessionId, patientId, patientName, startAt, modality, daysOverdue }`; modality best-effort from the session/location data. Owner-scoped + RLS (design D2, RF-12.04/12.06/12.07).
- [ ] 2.2 Barrel-export `listOverdueEvolutionsImpl` + types from `src/modules/agenda/index.ts`.
- [ ] 2.3 Integration test `src/__tests__/integration/agenda/overdue-evolutions.int.test.ts`: parity with the count predicate; oldest-first ordering; includes weeks-old sessions (not week-bounded); excludes done-with-evolution, non-`done`, soft-deleted, and within-7-days; `patientName` resolved. Run the targeted integration spec.
- [ ] 2.4 Integration cross-tenant test: psychologists A and B each with overdue sessions; A's query never returns B's rows (RN-12.02). Same spec or `src/__tests__/integration/agenda/`.

## 3. Page branch: list vs. calendar

- [ ] 3.1 In `src/app/(app)/agenda/page.tsx`, make the page async, read `searchParams`, resolve `view = resolveAgendaListFilter(filtro)`; inside `<Suspense>` render the new `OverdueEvolutionsListServer` when `view === 'sem-evolucao'`, else the existing `AgendaDataServer` (calendar untouched). First-paint server branch, no calendar flash (design D3, RNF-12.01).
- [ ] 3.2 Add `OverdueEvolutionsListServer` inner async component that calls `listOverdueEvolutionsImpl` and renders the list/empty state; redirect to `/login` on `UNAUTHORIZED` (defense-in-depth mirror of middleware).

## 4. List UI: rows, CTA, chip, empty state

- [ ] 4.1 Read `docs/design-system/rules.md` (Sálvia) before building UI. Create `src/modules/agenda/components/overdue-evolutions-list.tsx` (Server Component): header with count; one row per item showing patient name, São Paulo date/time (reuse `formatSessionDate`/`formatSessionTime`), modality when available, "há N dias", and a `next/link` CTA "Registrar evolução" → `/pacientes/{patientId}/prontuario/evolucoes/nova?sessionId={sessionId}` (RF-12.08).
- [ ] 4.2 Create `overdue-filter-chip.tsx` (`'use client'`): "Sem evolução · N" (`Badge`) + keyboard-focusable remove control (`aria-label`, live region per RNF-12.03) that `router.replace`s `/agenda` without `filtro` → calendar (RF-12.09).
- [ ] 4.3 Empty state in the list component: when zero items, render "Nenhuma sessão sem evolução. Tudo em dia. 🎉" with a link to `/agenda` (RF-12.19) — not the calendar.
- [ ] 4.4 Unit/RTL test for the row + chip: CTA href is correct; "há N dias" renders from `daysOverdue`; chip remove control is keyboard-accessible and clears `filtro`. Run `npm run test:unit`.

## 5. Resolve-and-decrement on return

- [ ] 5.1 In the evolution-create route action `src/app/(app)/pacientes/[id]/prontuario/evolucoes/nova/actions.ts`, call `revalidatePath('/agenda')` after a successful `createEvolution` so the overdue list reflects the removed row + decremented count on return (design D5, RF-12.10). No change to the form or `createEvolutionImpl`.

## 6. E2E coverage (flows + negative-auth)

- [ ] 6.1 E2E (seeded) `src/__tests__/e2e/seeded/agenda/`: dashboard "Ver" (sessões sem evolução) → `/agenda?filtro=sem-evolucao` renders the **list** (not the calendar); items oldest-first; chip count matches the dashboard (PRD §9).
- [ ] 6.2 E2E: "Registrar evolução" href is `/pacientes/{patientId}/prontuario/evolucoes/nova?sessionId={sessionId}` and opens that session's evolution.
- [ ] 6.3 E2E resolve flow: register an evolution for a listed session → return to the list → row gone and count decremented (RF-12.10).
- [ ] 6.4 E2E: remove chip → URL drops `filtro`, calendar returns; unknown `?filtro=xyz` → calendar, no error (RF-12.16); empty set → "Tudo em dia. 🎉" positive state with link to the full agenda.
- [ ] 6.5 E2E negative-auth: anonymous `/agenda?filtro=sem-evolucao` redirects to `/login`.

