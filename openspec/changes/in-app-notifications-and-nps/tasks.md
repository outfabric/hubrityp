# Tasks — in-app-notifications-and-nps

> Ordering rule: each automated test follows immediately after the code change
> that motivates it (code → its test → next code). Depends on
> `onboarding-data-model` (preferences table + NPS columns) and `dashboard-home`
> (`first_access_at` stamp).

## 1. Notification read Server Actions + Zod (logic + server)

- [x] 1.1 Create `src/modules/notifications/lib/schemas.ts` — Zod: `markReadInputSchema` (`{ id: z.string().uuid() }`); MVP type allowlist + per-type icon/route map (pure). Derive types via z.infer
- [x] 1.2 **Unit test:** `src/__tests__/unit/modules/notifications/lib/schemas.test.ts` — markRead rejects non-UUID; type map covers exactly the 7 MVP types and excludes post-MVP types
- [x] 1.3 Create `src/modules/notifications/server/list-notifications.ts`, `get-unread-count.ts`, `mark-read.ts`, `mark-all-read.ts` — each getUser() auth, Zod-validate, owner-scoped via RLS; `markRead` updates `WHERE id = :id AND user_id = auth.uid()`. Sanitized errors. Export via barrel
- [x] 1.4 **Integration test:** `src/__tests__/integration/notifications/read-actions.int.test.ts` — list/unread owner-scoped; IDOR proof (B marking A's notification affects zero rows); mark-all scopes to `auth.uid()`; invalid UUID rejected at boundary; cross-user RLS holds

## 2. Bell + dropdown UI + relative time

- [x] 2.1 Create `src/modules/notifications/lib/relative-time.ts` — pure helper formatting a timestamp to pt-BR relative text via date-fns (`America/Sao_Paulo`)
- [x] 2.2 **Unit test:** `src/__tests__/unit/modules/notifications/lib/relative-time.test.ts` — "há 5 min", "ontem", boundary cases; deterministic with injected `now`
- [x] 2.3 Create `src/modules/notifications/components/notification-bell.tsx` (client leaf) — Lucide `Bell`, unread badge, `aria-label`; opens dropdown
- [x] 2.4 Create `src/modules/notifications/components/notification-dropdown.tsx` — chronological list, per-type icon, relative time, "Marcar todas como lidas"; click marks read + routes; renders only MVP types
- [x] 2.5 **Unit test:** `src/__tests__/unit/modules/notifications/components/notification-dropdown.test.tsx` — renders type icon + relative time; click triggers markRead + route; mark-all wired; post-MVP type yields no payment/Receita/WhatsApp affordance

## 3. Realtime unread updates

- [ ] 3.1 Create `src/modules/notifications/hooks/use-notifications-realtime.ts` — subscribe to `postgres_changes` on `notifications` filtered by `user_id=eq.<owner>`, reusing the ai-transcription realtime pattern; cleanup on unmount; bump unread count on INSERT
- [ ] 3.2 Wire bell + realtime hook into `src/app/(app)/layout.tsx` header (server reads initial unread count, passes to client leaf)
- [ ] 3.3 **Integration test:** `src/__tests__/integration/notifications/realtime-subscriber.int.test.ts` — insert for owner delivers an event; insert for another user is NOT delivered (owner-filter proof). Follow existing realtime-subscriber test style

## 4. 30-day auto-read Inngest job

- [ ] 4.1 Create `src/modules/notifications/inngest/auto-read-old.ts` — scheduled function: service-role client (justified comment), set `read_at = now()` where `read_at IS NULL AND created_at < now() - 30 days`; never deletes. Reuse an existing inngest client
- [ ] 4.2 Register the function in `src/app/api/inngest/route.ts`
- [ ] 4.3 **Integration test:** `src/__tests__/integration/notifications/auto-read-old.int.test.ts` — 31-day-old unread becomes read; recent unread untouched; no rows deleted

## 5. Notification preferences UI + action

- [ ] 5.1 Create `src/modules/notifications/server/update-preferences.ts` — getUser() auth; Zod-validate; upsert owner's `notification_preferences`; REJECT/coerce `email_critical = false` (server-enforced). Export via barrel
- [ ] 5.2 **Integration test:** `src/__tests__/integration/notifications/update-preferences.int.test.ts` — happy update; `email_critical=false` coerced/rejected to true; cross-user update affects zero rows; client userId ignored
- [ ] 5.3 Create `src/app/(app)/configuracoes/notificacoes/page.tsx` + thin `actions.ts` + a `notification-preferences-form.tsx` client leaf (RHF+Zod, switches; `email_critical` shown locked-on)
- [ ] 5.4 **Integration test:** `src/__tests__/integration/middleware/notificacoes-gating.int.test.ts` — NEGATIVE-AUTH: anonymous GET `/configuracoes/notificacoes` redirects to `/login?redirectTo=...` (proves the existing `/configuracoes` classification covers the new route)

## 6. End-to-end notifications flow

- [ ] 6.1 **E2E test:** `src/__tests__/e2e/seeded/notifications/bell.spec.ts` — seeded owner with notifications sees unread badge; opens dropdown with relative times; clicking marks read + routes; "Marcar todas como lidas" clears the badge; anonymous cannot reach `/configuracoes/notificacoes`

## 7. NPS — schema-free feature (uses onboarding-data-model columns)

- [ ] 7.1 Create `src/modules/nps/lib/schemas.ts` — reuse/extend `npsAnswerSchema` from `@/modules/onboarding`; add `isDetractor(score)` pure helper (score <= 6) and `isEligibleForNps({ firstAccessAt, npsRespondedAt, now })` (>= 7 days, not yet responded)
- [ ] 7.2 **Unit test:** `src/__tests__/unit/modules/nps/lib/schemas.test.ts` — `isDetractor` boundaries (6 true, 7 false); `isEligibleForNps` day-6 false, day-7 true, already-responded false
- [ ] 7.3 Create `src/modules/nps/server/submit-nps.ts` — `submitNpsImpl(supabase, input)`: getUser() auth; Zod-validate; write `nps_score`/`nps_feedback`/`nps_responded_at` on `auth.uid()` row only; dismissal path sets `nps_responded_at` without score; if detractor, enqueue the follow-up email Inngest event. Sanitized errors; no PII logs. Export via barrel
- [ ] 7.4 **Integration test:** `src/__tests__/integration/nps/submit-nps.int.test.ts` — valid answer persisted owner-only; score 12 rejected at boundary; dismissal sets `nps_responded_at` with null score; detractor (4) enqueues email event, promoter (9) does not; cross-user write impossible; assert logged payload carries user id but no email/name/feedback

## 8. NPS modal + deferred entry

- [ ] 8.1 Create `src/modules/nps/components/nps-modal.tsx` (client leaf) — 0–10 selector, optional feedback field, "Não responder agora"; shown once based on server-provided eligibility prop; design-system Modal
- [ ] 8.2 Mount the modal in `src/app/(app)/layout.tsx` driven by server-computed `isEligibleForNps`; add Configurações > Feedback entry that renders the same submit form later
- [ ] 8.3 **Unit test:** `src/__tests__/unit/modules/nps/components/nps-modal.test.tsx` — renders when eligible, hidden when not; "Não responder agora" calls submit-dismiss; score selection submits; respects design-system Modal a11y (focus, Escape)

## 9. NPS scheduling + detractor email (Inngest + Resend)

- [ ] 9.1 Create `src/modules/nps/inngest/detractor-followup.ts` — Inngest function (service-role, justified comment) that, on the detractor event, sends a follow-up email via the existing Resend helper; no clinical content; log only the user id
- [ ] 9.2 Create `src/modules/nps/inngest/nps-eligibility-sweep.ts` (optional sweep) OR rely on server-derived eligibility per design; if a sweep is used, service-role + registered in serve route
- [ ] 9.3 Register NPS Inngest function(s) in `src/app/api/inngest/route.ts`
- [ ] 9.4 **Integration test:** `src/__tests__/integration/nps/detractor-followup.int.test.ts` — detractor event triggers Resend send (mock Resend); log assertion: user id present, email/name/feedback absent; promoter does not trigger

## 10. End-to-end NPS flow

- [ ] 10.1 **E2E test:** `src/__tests__/e2e/seeded/nps/day7-modal.spec.ts` — seed a user with `first_access_at` 7 days ago and `nps_responded_at` null: modal appears once; submitting persists; reload does not re-show; "Não responder agora" suppresses and answer still possible via Configurações > Feedback
