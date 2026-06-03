# Tasks — onboarding-checklist-and-tour

> Ordering rule: each automated test follows immediately after the code change
> that motivates it (code → its test → next code). Depends on
> `onboarding-data-model` and `dashboard-home` (FirstStepsSlot + tour anchors).

## 1. Checklist completion logic (pure + server)

- [x] 1.1 Create `src/modules/onboarding/lib/checklist-items.ts` — pure model: ordered list of the 7 items with `key`, `label`, `actionTarget`, `mandatory` flag; `isComplete(state)` and `mandatoryCompletePct(state)` helpers (bonus excluded from 100%)
- [x] 1.2 **Unit test:** `src/__tests__/unit/modules/onboarding/lib/checklist-items.test.ts` — 100% reached with all mandatory done + bonus pending; bonus pending never blocks; item ordering + mandatory flags correct
- [x] 1.3 Create `src/modules/onboarding/server/recompute-checklist.ts` — `recomputeChecklistImpl(supabase)`: getUser() auth; derive each item from owner's data (locations, active patients, non-cancelled sessions, evolutions, consent_signed_at, AI settings+transcriptions); upsert owner's `onboarding_checklist` row; ignore any client userId. Use React `cache()` to dedupe with dashboard aggregates. Export via barrel
- [x] 1.4 **Integration test:** `src/__tests__/integration/onboarding/recompute-checklist.int.test.ts` — creating a session flips `first_session_scheduled`; consent flips `first_consent_sent`; owner-scoping proven (user B's data never satisfies user A's items); client userId ignored; cross-user RLS holds

## 2. Checklist card UI + celebration

- [ ] 2.1 Create `src/modules/onboarding/components/checklist-card.tsx` (client leaf) — expandable Card/Accordion; items with `CheckCircle2` for done, action buttons for pending; "Bônus" Badge on the AI item; collapses at 100%. Design-system tokens only
- [ ] 2.2 Create `src/modules/onboarding/components/checklist-celebration.tsx` — discreet <=300ms CSS flourish + "Você completou a configuração inicial..." message; `prefers-reduced-motion` guard
- [ ] 2.3 **Unit test:** `src/__tests__/unit/modules/onboarding/components/checklist-card.test.tsx` — done vs pending rendering; bonus badge present; card collapses at 100%; pending items expose their action target
- [ ] 2.4 **Unit test:** `src/__tests__/unit/modules/onboarding/components/checklist-celebration.test.tsx` — renders message on complete; reduced-motion path uses near-instant transition; no bouncing/dramatic animation classes
- [ ] 2.5 Fill the dashboard `<FirstStepsSlot>` with the checklist card (server reads checklist via recompute, passes to client leaf). Mount the card at the top of `/dashboard` whenever a mandatory item is pending
- [ ] 2.6 Add Configurações > Ajuda > "Primeiros passos" entry rendering the checklist (read-only when complete)

## 3. Guided tour (Driver.js)

- [ ] 3.1 `npm install driver.js`. Confirm it is imported only in client leaves (no Server Component / Edge import)
- [ ] 3.2 Ensure `dashboard-home` surfaces carry stable `data-tour-*` anchors (sidebar nav, Seção Hoje, Seção Pendências, "+ Novo paciente", "+ Nova sessão"); add anchors here if missing
- [ ] 3.3 Create `src/modules/onboarding/lib/tour-steps.ts` — pure array of the 5 steps with PRD copy + anchor selectors; assert no post-MVP strings in the copy
- [ ] 3.4 **Unit test:** `src/__tests__/unit/modules/onboarding/lib/tour-steps.test.ts` — exactly 5 steps in order; copy matches PRD intent; contains none of "WhatsApp"/"Receita Saúde"/"PIX"/"cobrança"/"recibo"
- [ ] 3.5 Create `src/modules/onboarding/components/dashboard-tour.tsx` (client leaf) — `dynamic(ssr:false)` Driver.js init with `allowClose:true`, default `overlayClickBehavior`, `disableActiveInteraction:false`, always-visible "Pular tour"; auto-run only when `tourCompletedAt` prop is null; `destroy()` on route-change/unmount; calls `completeTour` on finish/skip
- [ ] 3.6 Create `src/modules/onboarding/server/complete-tour.ts` — `completeTourImpl(supabase)`: getUser() auth; set `profiles.tour_completed_at = now()` on the `auth.uid()` row; export via barrel
- [ ] 3.7 **Integration test:** `src/__tests__/integration/onboarding/complete-tour.int.test.ts` — sets `tour_completed_at` for owner only; client userId ignored; cross-user RLS holds
- [ ] 3.8 Mount `<DashboardTour>` on `/dashboard` passing server-read `tourCompletedAt`; add "Refazer tour" entry under Configurações > Ajuda that starts the tour bypassing the gate

## 4. End-to-end flows

- [ ] 4.1 **E2E test:** `src/__tests__/e2e/seeded/onboarding/checklist.spec.ts` — seeded user sees checklist card with correct done/pending states; creating a patient/session updates items; reaching all mandatory shows the celebration and collapses the card; checklist reachable under Configurações > Ajuda
- [ ] 4.2 **E2E test:** `src/__tests__/e2e/seeded/onboarding/tour.spec.ts` — first dashboard open auto-runs the 5-step tour; "Pular tour" dismisses it; after completion `tour_completed_at` set and tour does not auto-run again; "Refazer tour" restarts it; assert no post-MVP strings in any tooltip
