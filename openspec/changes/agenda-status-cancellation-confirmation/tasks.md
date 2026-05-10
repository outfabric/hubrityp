## 1. Database Schema — Sessions Extension & Status Constraint

- [x] 1.1 Extend `sessions` table in `src/shared/db/schema/agenda/tables.ts` with new columns: `cancellation_reason VARCHAR(50)`, `cancelled_by VARCHAR(20)`, `cancellation_notice VARCHAR(20)`, `cancelled_at TIMESTAMPTZ`, `charge_cancellation BOOLEAN DEFAULT FALSE`, `confirmation_token VARCHAR(64)`, `confirmed_at TIMESTAMPTZ`, `rescheduled_to_session_id UUID REFERENCES sessions(id)`, `rescheduled_from_session_id UUID REFERENCES sessions(id)`, `deleted_at TIMESTAMPTZ`
- [x] 1.2 Add CHECK constraint on `status` column: `CHECK (status IN ('scheduled', 'confirmed', 'done', 'cancelled', 'no_show'))` via Drizzle `check()` in table definition
- [x] 1.3 Add UNIQUE index on `confirmation_token` (partial — WHERE confirmation_token IS NOT NULL)
- [x] 1.4 Update RLS policies for `sessions` in `src/shared/db/schema/agenda/policies.ts` — ensure SELECT, INSERT, UPDATE only (NO DELETE policy). Add comment explaining RN-03.05 rationale
- [x] 1.5 Run `npm run db:generate`, edit migration to include RLS policy changes, CHECK constraint, and UNIQUE index
- [x] 1.6 Test migration with `npm run db:migrate` local
- [x] 1.7 **Test integration:** Create `src/__tests__/integration/agenda/session-schema-extension.int.test.ts` — verify new columns exist, CHECK constraint rejects invalid status values, UNIQUE constraint on confirmation_token works, DELETE is blocked by RLS, UPDATE is allowed for owner

## 2. Lib — Status State Machine & Helpers

- [x] 2.1 Create `src/modules/agenda/lib/session-status.ts` — export `SessionStatus` type (branded union: `'scheduled' | 'confirmed' | 'done' | 'cancelled' | 'no_show'`), `VALID_TRANSITIONS` map, pure function `isValidTransition(from: SessionStatus, to: SessionStatus): boolean`, pure function `getAvailableActions(status: SessionStatus, session: { updatedAt: Date; deletedAt: Date | null }): Action[]` that returns the list of UI actions for a given status (accounting for 7-day lock on done)
- [x] 2.2 Create `src/modules/agenda/lib/session-lock.ts` — export pure function `isSessionLocked(session: { status: string; updatedAt: Date }): boolean` returning `true` if status is `done` and more than 7 days have elapsed (UTC comparison)
- [x] 2.3 **Test unit:** Create `src/__tests__/unit/modules/agenda/lib/session-status.test.ts` — test all valid transitions (scheduled→confirmed, scheduled→cancelled, scheduled→done, scheduled→no_show, confirmed→cancelled, confirmed→done, confirmed→no_show, cancelled→scheduled), all invalid transitions (done→scheduled, no_show→confirmed, no_show→scheduled, done→cancelled, cancelled→confirmed), and getAvailableActions for each status
- [x] 2.4 **Test unit:** Create `src/__tests__/unit/modules/agenda/lib/session-lock.test.ts` — test: done session 3 days ago → not locked, done session 7 days ago → not locked (boundary), done session 8 days ago → locked, scheduled session 10 days ago → not locked (only done triggers lock), done session exactly 7*24*60*60*1000 ms ago → boundary test

## 3. Lib — Cancellation Notice Calculator

- [x] 3.1 Create `src/modules/agenda/lib/cancellation-notice.ts` — export type `CancellationNotice = '24h+' | 'less_24h' | 'less_1h' | 'on_time'`, pure function `calculateCancellationNotice(sessionStartAt: Date, cancelledAt: Date): CancellationNotice` with UTC comparison
- [x] 3.2 **Test unit:** Create `src/__tests__/unit/modules/agenda/lib/cancellation-notice.test.ts` — test: 30h before → '24h+', exactly 24h before → '24h+' (boundary inclusive), 23h59m before → 'less_24h', 5h before → 'less_24h', exactly 1h before → 'less_1h' (boundary), 59m before → 'less_1h', 30m before → 'less_1h', 1m before → 'less_1h', exactly at start → 'on_time', 10m after start → 'on_time', 2h after start → 'on_time'

## 4. Lib — Confirmation Token Generator

- [x] 4.1 Create `src/modules/agenda/lib/confirmation-token.ts` — export `generateConfirmationToken(): string` using `crypto.randomBytes(32).toString('base64url')`, and `isTokenExpired(sessionStartAt: Date): boolean`
- [x] 4.2 **Test unit:** Create `src/__tests__/unit/modules/agenda/lib/confirmation-token.test.ts` — test: generated token is 43 chars, contains only base64url chars, two generated tokens are different (uniqueness), isTokenExpired returns false for future date, returns true for past date, returns true for current time

## 5. Lib — Notification Event Schemas

- [x] 5.1 Create `src/modules/agenda/lib/session-events.ts` — export Zod schemas and TypeScript types for all Inngest event payloads: `SessionConfirmedEvent`, `SessionCancelledEvent`, `SessionDoneEvent`, `SessionNoShowEvent`, `SessionRescheduledEvent`, `SessionMissingNoteReminderEvent`. Each schema validates the fields listed in design.md decision #5
- [x] 5.2 **Test unit:** Create `src/__tests__/unit/modules/agenda/lib/session-events.test.ts` — test: each schema validates a correct payload, each schema rejects payloads with missing required fields, each schema rejects payloads with wrong types

## 6. Lib — Cancellation Input Schema (Zod)

- [x] 6.1 Create `src/modules/agenda/lib/cancellation-schema.ts` — export Zod schema `cancelSessionInputSchema` validating: `sessionId` (UUID), `reason` (enum: 'patient_cancelled' | 'therapist_cancelled' | 'unforeseen' | 'other'), `cancelledBy` (enum: 'patient' | 'therapist'), `chargeCancellation` (boolean), `isReschedule` (boolean optional). Derive TypeScript type via `z.infer`
- [x] 6.2 **Test unit:** Create `src/__tests__/unit/modules/agenda/lib/cancellation-schema.test.ts` — test: valid payload passes, missing sessionId fails, invalid reason fails, invalid cancelledBy fails

## 7. Server Actions — Status Transitions

- [x] 7.1 Create `src/modules/agenda/server/confirm-session.ts` — Server Action: validates auth, checks session ownership via RLS, validates transition (scheduled→confirmed), sets `confirmed_at=NOW()`, `status='confirmed'`, appends session_history entry, emits `agenda/session.confirmed` via Inngest
- [x] 7.2 Create `src/modules/agenda/server/cancel-session.ts` — Server Action: validates auth, validates Zod input, checks ownership, validates transition, calculates notice via `calculateCancellationNotice`, sets all cancellation fields, appends session_history with metadata, emits `agenda/session.cancelled` via Inngest. If `isReschedule`, returns session data for pre-filling the creation modal
- [x] 7.3 Create `src/modules/agenda/server/mark-session-done.ts` — Server Action: validates auth, checks ownership, validates transition (scheduled|confirmed→done), sets `status='done'`, `updated_at=NOW()`, appends session_history, emits `agenda/session.done`
- [x] 7.4 Create `src/modules/agenda/server/mark-session-no-show.ts` — Server Action: validates auth, checks ownership, validates transition (scheduled|confirmed→no_show), sets `status='no_show'`, appends session_history, emits `agenda/session.no_show`. Does NOT populate cancellation fields (no_show is distinct)
- [x] 7.5 Create `src/modules/agenda/server/reactivate-session.ts` — Server Action: validates auth, checks ownership, validates transition (cancelled→scheduled), clears all cancellation fields + reschedule links, appends session_history
- [x] 7.6 Create `src/modules/agenda/server/soft-delete-session.ts` — Server Action: validates auth, checks ownership, validates session is `cancelled`, validates no prior done/no_show status via session_history query, sets `deleted_at=NOW()`. Requires confirmation (verified by input flag)
- [x] 7.7 Create `src/modules/agenda/server/complete-reschedule.ts` — Server Action: receives old session ID + new session data. Creates new session with `rescheduled_from_session_id`, updates old session with `rescheduled_to_session_id`, appends history to both, emits `agenda/session.rescheduled`
- [x] 7.8 **Test integration:** Create `src/__tests__/integration/agenda/session-status-transitions.int.test.ts` — test: confirm session (status changes, confirmed_at set, history created), cancel session (all cancellation fields populated, history with metadata), mark done, mark no_show (cancellation fields remain null), reactivate (fields cleared, history created), invalid transitions are rejected with typed error, 7-day lock rejects edit on old done session, cross-user access blocked by RLS
- [x] 7.9 **Test integration:** Create `src/__tests__/integration/agenda/session-reschedule.int.test.ts` — test: reschedule creates new session with bidirectional links, both sessions have history entries, old session is cancelled with reschedule metadata, event is emitted
- [x] 7.10 **Test integration:** Create `src/__tests__/integration/agenda/session-soft-delete.int.test.ts` — test: soft-delete sets deleted_at, soft-deleted session not returned by standard queries, soft-delete rejected for session with done history, soft-delete rejected for non-cancelled session

## 8. Server Actions — Public Confirmation Flow

- [ ] 8.1 Create `src/modules/agenda/server/get-session-by-token.ts` — function using service-role Supabase client to fetch session by confirmation_token. Returns only public-safe fields (date, time, psychologist name, location). Returns typed states: `'valid'`, `'expired'`, `'already_responded'`, `'cancelled'`, `'invalid'`
- [ ] 8.2 Create `src/modules/agenda/server/public-confirm-session.ts` — Server Action (no auth): receives token, validates session is confirmable (valid token, not expired, status=scheduled), sets confirmed_at and status=confirmed, appends session_history with performed_by='patient', emits event
- [ ] 8.3 Create `src/modules/agenda/server/public-decline-session.ts` — Server Action (no auth): receives token + optional reason text, validates session is declinable, sets cancellation fields (cancelled_by='patient', reason='patient_cancelled', notice auto-calculated), appends session_history with performed_by='patient', emits event
- [ ] 8.4 **Test integration:** Create `src/__tests__/integration/agenda/public-confirmation.int.test.ts` — test: confirm via valid token (status changes, confirmed_at set, history with performed_by=patient), decline via valid token (cancellation fields populated, notice calculated correctly), expired token returns 'expired', already confirmed token returns 'already_responded', invalid token returns 'invalid', cancelled session token returns 'cancelled', cross-patient token works (token is authorization, not identity), service-role bypasses RLS

## 9. Inngest — Missing Note Reminder Cron (RN-03.06)

- [ ] 9.1 Create `src/modules/agenda/server/missing-note-reminder.ts` — Inngest scheduled function (daily cron) that queries sessions with `status='done'` AND `updated_at < NOW() - INTERVAL '7 days'` AND `deleted_at IS NULL`. Initially stubs the clinical note check (always considers note missing). For each matching session, emits `agenda/session.missing_note_reminder` event
- [ ] 9.2 **Test integration:** Create `src/__tests__/integration/agenda/missing-note-reminder.int.test.ts` — test: function finds done sessions older than 7 days, does not find done sessions within 7 days, does not find cancelled/scheduled sessions, emits correct event payload per matching session

## 10. Module Barrel Update

- [ ] 10.1 Update `src/modules/agenda/index.ts` to re-export: all server actions (confirmSession, cancelSession, markSessionDone, markSessionNoShow, reactivateSession, softDeleteSession, completeReschedule, getSessionByToken, publicConfirmSession, publicDeclineSession), lib exports (SessionStatus, isValidTransition, getAvailableActions, isSessionLocked, calculateCancellationNotice, generateConfirmationToken, isTokenExpired, event schemas and types, cancelSessionInputSchema)

## 11. Frontend — Status Badge Component

> **Design System Salvia** (`docs/design-system/rules.md`): Badge with semantic colors, Lucide icons from fixed map.

- [ ] 11.1 Create `src/modules/agenda/components/session-status-badge.tsx` (Server Component) — renders shadcn `Badge` with variant mapped to session status: scheduled→neutral (surface-muted/text-secondary, icon Clock), confirmed→success (success-50/success-700, icon CheckCircle2), done→brand (brand-100/brand-700, icon Check), cancelled→danger (danger-50/danger-700, icon XCircle), no_show→warning (warning-50/warning-700, icon AlertTriangle). Badge height 22px, padding 2px 10px, radius full, font 12px weight 500. Icon 16px inline with `aria-hidden="true"`

## 12. Frontend — Action Buttons Component

> **Design System Salvia**: Button variants (primary/secondary/danger/link), loading state, max 1 primary per context.

- [ ] 12.1 Create `src/modules/agenda/components/session-action-buttons.tsx` (Client Component) — renders status-dependent action buttons using `getAvailableActions`. Button variants per design.md: "Confirmar presenca" primary + CheckCircle2, "Marcar como realizada" primary + Check, "Remarcar" secondary + Calendar, "Cancelar sessao" danger + XCircle, "Marcar como falta" secondary + AlertTriangle, "Reativar" secondary + RotateCcw, "Excluir definitivamente" danger + Trash2, link buttons for prontuario/pagamento/cobranca. For done sessions past 7 days: shows shadcn `Alert` info variant (bg info-50, text info-700, icon Lock) with text "Sessao bloqueada para edicao apos 7 dias". Loading state on all async buttons. Size md (40px, 15px font)
- [ ] 12.2 **Test unit:** Create `src/__tests__/unit/modules/agenda/components/session-action-buttons.test.tsx` — test: renders correct buttons for each status, locked done session shows lock alert instead of action buttons, loading state shown during async action

## 13. Frontend — Cancellation Dialog

> **Design System Salvia**: Dialog (not Drawer), Select, RadioGroup, Switch, Alert with notice variant, Button danger + secondary.

- [ ] 13.1 Create `src/modules/agenda/components/cancel-session-dialog.tsx` (Client Component) — shadcn `Dialog` max-width 480px, radius 2xl, padding space-8 desktop / space-6 mobile. Title h3 "Cancelar sessao" (18px/600). shadcn `Select` for reason (4 options). shadcn `RadioGroup` for "Quem cancelou" (Paciente/Psicologo). Calculated notice in shadcn `Alert` (info for 24h+, warning for less_24h and less_1h, danger for on_time). shadcn `Switch` for "Aplicar cobranca?". Footer: "Cancelar sessao" Button danger + loading state, "Voltar" Button secondary. Form validated with React Hook Form + cancelSessionInputSchema. On success: toast "Sessao cancelada" (Sonner, border-left danger-500), closes dialog. If reschedule mode: on success opens session creation modal pre-filled
- [ ] 13.2 **Test unit:** Create `src/__tests__/unit/modules/agenda/components/cancel-session-dialog.test.tsx` — test: renders all form fields, notice alert updates based on session time, form submission disabled until required fields filled, loading state on submit

## 14. Frontend — Soft-Delete Confirmation

> **Design System Salvia**: AlertDialog with destructive confirmation (type "EXCLUIR" to confirm).

- [ ] 14.1 Create `src/modules/agenda/components/delete-session-dialog.tsx` (Client Component) — shadcn `AlertDialog` max-width 480px. Title h3 "Excluir sessao definitivamente". Body text warning in danger-700. Input requiring user to type "EXCLUIR" to enable the confirm button. "Excluir definitivamente" Button danger (disabled until input matches), "Cancelar" Button secondary. On success: toast "Sessao excluida" (Sonner)
- [ ] 14.2 **Test unit:** Create `src/__tests__/unit/modules/agenda/components/delete-session-dialog.test.tsx` — test: confirm button disabled until "EXCLUIR" typed, submission calls softDeleteSession

## 15. Frontend — Integration into Session Detail Modal

- [ ] 15.1 Update session detail modal component (from agenda-foundation-and-sessions) to render `SessionStatusBadge` in header, `SessionActionButtons` in footer, session history chronological list in body. History formatted as: "Criada em DD/MM/YYYY", "Confirmada pelo paciente em DD/MM/YYYY", "Cancelada pelo psicologo em DD/MM/YYYY — Motivo: Paciente cancelou"
- [ ] 15.2 Update calendar event rendering (from agenda-foundation-and-sessions) to include `SessionStatusBadge` on each event card. Cancelled events rendered with reduced opacity (e.g., `opacity-50`)

## 16. Frontend — Public Confirmation Page

> **Design System Salvia**: Public page layout (mirrors /termo/[token]), Card default, Button primary/secondary/danger, result messages with semantic icons, accessibility (contrast, focus, keyboard, aria-live, touch targets, reduced-motion).

- [ ] 16.1 Create layout `src/app/(public)/confirmar-sessao/layout.tsx` — logo centered at top, bg background, no sidebar/nav, footer caption text-tertiary. Mobile-first padding space-4 / desktop space-8. Mirror pattern from `src/app/termo/layout.tsx`
- [ ] 16.2 Create page `src/app/(public)/confirmar-sessao/[token]/page.tsx` (Server Component) — calls getSessionByToken(token). Based on returned state: renders valid form, expired message, already-responded message, cancelled message, or invalid message. Each state uses appropriate semantic icon (CheckCircle2/Clock/Info/XCircle/AlertCircle) and colors per design.md. Max-width 480px centered. Session info in Card default (radius xl, padding space-8 desktop / space-6 mobile). Accessibility: aria-live polite on result region, focus management after action, contrast WCAG AA, keyboard navigation, 44x44px touch targets, prefers-reduced-motion
- [ ] 16.3 Create `src/app/(public)/confirmar-sessao/[token]/actions.ts` with `'use server'` — delegates to publicConfirmSession and publicDeclineSession
- [ ] 16.4 Create `src/modules/agenda/components/public-confirmation-form.tsx` (Client Component) — two buttons: "Confirmar presenca" Button primary full-width + icon CheckCircle2 + loading state, "Nao posso comparecer" Button secondary full-width + icon XCircle. Clicking "Nao posso comparecer" expands shadcn Textarea (placeholder "Motivo (opcional)") + "Confirmar cancelamento" Button danger. After action: renders success/decline result message with aria-live. Form uses React Hook Form
- [ ] 16.5 **Test E2E:** Create `src/__tests__/e2e/seeded/agenda/public-confirmation-confirm.spec.ts` — flow: seed a session with confirmation_token, navigate to /confirmar-sessao/{token} (no auth context), verify session details displayed (date, time, psychologist name), click "Confirmar presenca", verify success message "Presenca confirmada" displayed, revisit same URL → "Voce ja respondeu" shown
- [ ] 16.6 **Test E2E:** Create `src/__tests__/e2e/seeded/agenda/public-confirmation-decline.spec.ts` — flow: seed a session with confirmation_token, navigate to /confirmar-sessao/{token}, click "Nao posso comparecer", enter optional reason, click "Confirmar cancelamento", verify "Cancelamento registrado" message, revisit same URL → "Voce ja respondeu" shown

## 17. Frontend — Psychologist Cancels Session (E2E)

- [ ] 17.1 **Test E2E:** Create `src/__tests__/e2e/seeded/agenda/session-cancel.spec.ts` — flow: seed a scheduled session, open session detail modal, click "Cancelar sessao", fill cancellation dialog (reason: Paciente cancelou, who: Paciente, cobranca: enabled), submit, verify session now shows "Cancelada" badge, verify cancellation details visible in history section
- [ ] 17.2 **Test E2E:** Create `src/__tests__/e2e/seeded/agenda/session-mark-done.spec.ts` — flow: seed a confirmed session, open session detail modal, click "Marcar como realizada", verify session shows "Realizada" badge, verify history shows "Marcada como realizada em [date]"

## 18. Frontend — No-Show & Edit Lock (E2E)

- [ ] 18.1 **Test E2E:** Create `src/__tests__/e2e/seeded/agenda/session-no-show.spec.ts` — flow: seed a scheduled session, open session detail modal, click "Marcar como falta", verify session shows "Falta" badge (warning), verify no cancellation fields are shown in detail
- [ ] 18.2 **Test E2E:** Create `src/__tests__/e2e/seeded/agenda/session-edit-lock.spec.ts` — flow: seed a done session with updated_at 8 days ago, open session detail modal, verify action buttons are replaced by lock alert "Sessao bloqueada para edicao apos 7 dias", verify no edit/status-change buttons visible
