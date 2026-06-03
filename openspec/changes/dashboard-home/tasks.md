# Tasks — dashboard-home

> Ordering rule: each automated test follows immediately after the code change
> that motivates it (code → its test → next code). Depends on
> `onboarding-data-model` (for `first_access_at`).

## 1. Aggregate read queries (server, RLS-scoped)

- [x] 1.1 Create `src/modules/dashboard/server/get-today-sessions.ts` — `getTodaySessions(supabase)`: getUser() auth; query owner's sessions where `start_at` is within today (America/Sao_Paulo); return next upcoming + ordered list with patient name, time, modality, status. RLS-scoped, no service-role
- [x] 1.2 **Integration test:** `src/__tests__/integration/dashboard/today-sessions.int.test.ts` — seed sessions for user A and user B today; assert A sees only A's sessions; next-upcoming selection correct; cross-user RLS returns zero of B's rows
- [x] 1.3 Create `src/modules/dashboard/server/get-pendencias.ts` — `getPendencias(supabase)`: getUser() auth; compute (a) count of `done` sessions older than 7 days with no evolution, (b) count of patients with `consent_signed_at IS NULL`, (c) count of AI notes awaiting review. Owner-scoped. Return counts + deep-link targets only (no clinical content)
- [x] 1.4 **Integration test:** `src/__tests__/integration/dashboard/pendencias.int.test.ts` — seed overdue done-without-evolution sessions, patients missing consent, AI notes pending; assert correct counts; assert cross-user isolation; assert result carries no clinical text fields
- [x] 1.5 Create `src/modules/dashboard/server/get-weekly-summary.ts` — `getWeeklySummary(supabase)`: getUser() auth; owner-only counts: sessions done this week, scheduled this week, no-show rate (only if >= threshold sessions, else null), new patients this month, evolutions this week
- [x] 1.6 **Integration test:** `src/__tests__/integration/dashboard/weekly-summary.int.test.ts` — seed mixed-status sessions across two users; assert owner-only counts; no-show rate null below threshold and correct above; cross-user isolation
- [x] 1.7 Create `src/modules/dashboard/server/has-any-data.ts` — `hasAnyData(supabase)`: getUser() auth; returns true if owner has >=1 patient OR >=1 session
- [x] 1.8 Create `src/modules/dashboard/index.ts` barrel — export the four read helpers + result types

## 2. first_access_at stamp

- [ ] 2.1 Create `src/modules/dashboard/server/stamp-first-access.ts` — `stampFirstAccess(supabase)`: getUser() auth; idempotent `UPDATE profiles SET first_access_at = now() WHERE id = auth.uid() AND first_access_at IS NULL`. Export via barrel
- [ ] 2.2 **Integration test:** `src/__tests__/integration/dashboard/first-access.int.test.ts` — first call sets `first_access_at`; second call does not overwrite; cross-user write impossible (only `auth.uid()` row touched)

## 3. Section components (UI, design-system)

- [ ] 3.1 Create `src/modules/dashboard/components/section-today.tsx` — Card; next session w/ "Abrir sessão" (server-decided href by modality), compact list with status badges (design-system Badge variants), empty-state CTA "agendar uma". Lucide `Calendar`
- [ ] 3.2 **Unit test:** `src/__tests__/unit/modules/dashboard/components/section-today.test.tsx` — renders next session + list; empty state renders schedule CTA; status maps to correct Badge variant; "Abrir sessão" href differs for online vs in_person
- [ ] 3.3 Create `src/modules/dashboard/components/section-pendencias.tsx` — Card; three MVP pendência rows with counts + deep links; "Tudo em dia." when all zero. MUST NOT render post-MVP strings
- [ ] 3.4 **Unit test:** `src/__tests__/unit/modules/dashboard/components/section-pendencias.test.tsx` — renders counts + links; positive state when all zero; asserts absence of "Receita Saúde"/"cobrança"/"WhatsApp"
- [ ] 3.5 Create `src/modules/dashboard/components/section-weekly.tsx` — Card; metrics with graceful empty states; no benchmark/norm copy. Skeleton fallback for Suspense
- [ ] 3.6 **Unit test:** `src/__tests__/unit/modules/dashboard/components/section-weekly.test.tsx` — each metric empty state when null; no-show rate hidden when null; no market-benchmark wording
- [ ] 3.7 Create `src/modules/dashboard/components/section-actions.tsx` — Card; "+ Novo paciente" / "+ Nova sessão" open existing modals; agenda/pacientes links. Lucide `Plus`, `Users`, `Calendar`
- [ ] 3.8 **Unit test:** `src/__tests__/unit/modules/dashboard/components/section-actions.test.tsx` — buttons wired to existing modal triggers and correct routes

## 4. Dashboard page composition + responsiveness + empty state

- [ ] 4.1 Rewrite `src/app/(app)/dashboard/page.tsx` (Server Component) — defense-in-depth profile check; `stampFirstAccess`; `Promise.all` for today + pendências; weekly summary inside `<Suspense>`; if `hasAnyData` is false, render the first-steps checklist slot instead of the four sections; mobile-first responsive layout (collapse Resumo + Ações behind chevron at mobile widths)
- [ ] 4.2 Expose a `<FirstStepsSlot>` placeholder boundary that the checklist/tour change fills (keep this change shippable independently — slot renders a minimal empty-state with schedule/add CTAs until the checklist lands)
- [ ] 4.3 **Unit test:** `src/__tests__/unit/app/dashboard/page-composition.test.tsx` — with data renders four sections in order; with zero data renders the first-steps slot; non-active profile redirects
- [ ] 4.4 **E2E test:** `src/__tests__/e2e/seeded/dashboard/dashboard-home.spec.ts` — seeded user with sessions sees Hoje next session + "Abrir sessão"; seeded user with overdue evolution sees Pendências count; zero-data user sees the first-steps slot; anonymous visit redirects to `/login`; assert no post-MVP pendência strings on the page
