## Context

This change builds the session lifecycle on top of the foundation created by `agenda-foundation-and-sessions` (sessions table, CRUD, calendar views, session detail modal, session_history audit table). The foundation leaves sessions with only `scheduled` and `done` status; this change completes the state machine with `confirmed`, `cancelled`, and `no_show`, adds structured cancellation, and introduces a public confirmation page mirroring the `patient-consent-term` pattern (token-based public page, no auth, single-use action).

**Dependency:** `agenda-foundation-and-sessions` must be implemented first. `agenda-recurring-sessions` is developed in parallel but is independent — reschedule here handles single sessions only.

## Goals / Non-Goals

**Goals:**
- Complete session status state machine with server-enforced transitions
- Structured cancellation with reason, who, notice period, charge flag
- Reschedule = cancel + new session with bidirectional link
- No-show as distinct status from cancelled (RN-03.07)
- 7-day edit lock on `done` sessions (RN-03.04)
- Public confirmation page `/confirmar-sessao/[token]` (no auth)
- Session history entries for every status transition
- Notification event emit via Inngest for downstream consumers
- Infrastructure for RN-03.06 trigger (done session without clinical note after 7 days)

**Non-Goals:**
- WhatsApp delivery of notifications (PRD 04 — separate change)
- Billing / charge collection for cancellations and no-shows (PRD 06)
- Clinical note / evolution integration (PRD 05)
- Video link for online sessions (PRD 09)
- Recurring session reschedule with edit-3-options (agenda-recurring-sessions change)
- Calendar views base implementation, drag-and-drop, session CRUD (agenda-foundation-and-sessions)
- Session `cancelled` hard delete — RN-03.05 says "never delete"; `cancelled` status is the terminal state. The "Excluir definitivamente" action in RF-03.13 is reinterpreted as a soft-delete (`deleted_at` timestamp) available ONLY for sessions that have never transitioned beyond `scheduled` (no history of confirmation, no clinical note, no payment). This preserves audit integrity while allowing cleanup of accidental entries

## Decisions

### 1. Session status state machine

Status is a `varchar(20)` column with a Postgres CHECK constraint enforcing valid values. Transitions are enforced server-side in Server Actions via a pure `isValidTransition(from, to)` function.

**Valid transitions:**

| From | To | Action | Notes |
|---|---|---|---|
| `scheduled` | `confirmed` | Confirmar presenca | Via psychologist or public link |
| `scheduled` | `cancelled` | Cancelar sessao | Requires cancellation fields |
| `scheduled` | `done` | Marcar como realizada | Direct (skips confirmation) |
| `scheduled` | `no_show` | Marcar como falta | After session time has passed |
| `confirmed` | `cancelled` | Cancelar sessao | Requires cancellation fields |
| `confirmed` | `done` | Marcar como realizada | Normal flow |
| `confirmed` | `no_show` | Marcar como falta | Patient confirmed but did not show |
| `cancelled` | `scheduled` | Reativar | Clears cancellation fields, new history entry |
| `done` | — | (immutable after 7 days) | Only view links available |
| `no_show` | — | (terminal) | Only "Cobrar falta" link (PRD 06) |

The CHECK constraint at DB level ensures the column only accepts valid enum values: `CHECK (status IN ('scheduled', 'confirmed', 'done', 'cancelled', 'no_show'))`. Transition validation happens in application code (Server Actions), not as DB triggers, to keep logic testable and portable.

**Available actions per status (UI):**

| Status | Actions |
|---|---|
| `scheduled` | Confirmar presenca, Remarcar, Cancelar sessao, Marcar como realizada, Marcar como falta |
| `confirmed` | Remarcar, Cancelar sessao, Marcar como realizada, Marcar como falta |
| `done` (within 7 days) | Ver prontuario desta sessao (link), Adicionar pagamento (link) |
| `done` (after 7 days) | Same as above, all edit actions locked |
| `cancelled` | Reativar, Excluir definitivamente (soft-delete, only if never used) |
| `no_show` | Cobrar falta (link to PRD 06) |

### 2. Cancellation notice calculation

Pure function `calculateCancellationNotice(sessionStartAt: Date, cancelledAt: Date): CancellationNotice`.

```
type CancellationNotice = '24h+' | 'less_24h' | 'less_1h' | 'on_time'
```

Logic (all comparisons in UTC to avoid timezone issues):
- `diffHours = (sessionStartAt - cancelledAt) / 3600000`
- If `diffHours >= 24` → `'24h+'`
- If `diffHours >= 1 && diffHours < 24` → `'less_24h'`
- If `diffHours > 0 && diffHours < 1` → `'less_1h'`
- If `diffHours <= 0` → `'on_time'` (cancelled at or after session time — worst case)

Edge case: cancellation AFTER session start time (e.g., patient cancels 10 minutes into the slot) is treated as `'on_time'`, the same bucket as "no notice given". This is distinct from `no_show` which is used when the patient gives no notice at all and does not attend.

### 3. Confirmation token

Mirrors the consent term pattern (`patient-consent-term` change):
- Generated via `crypto.randomBytes(32).toString('base64url')` — 43 characters, 256 bits of entropy, URL-safe
- Stored in `sessions.confirmation_token` (VARCHAR(64), UNIQUE)
- Token is generated at session creation or on-demand when psychologist requests the confirmation link
- **Expiration:** token becomes invalid after `sessions.start_at` has passed (checked server-side at confirmation time, not via DB TTL). Unlike the consent term token (which has no expiration), session confirmation is time-bound
- **Single-use:** after the patient takes an action (confirm or decline), the token is consumed — `confirmed_at` is set (for confirm) or status becomes `cancelled` (for decline). Subsequent visits to the page show a "already responded" message
- **Revocation:** not explicit — the token naturally expires after session time. If the psychologist cancels the session before the patient acts, the public page shows "Esta sessao foi cancelada"

### 4. 7-day edit lock (RN-03.04)

Pure function `isSessionLocked(session: { status: string; updated_at: Date }): boolean`:
- Returns `true` if `status === 'done'` AND `Date.now() - updated_at > 7 * 24 * 60 * 60 * 1000`
- All timestamp comparisons use UTC (stored as `TIMESTAMPTZ`)
- Server Actions reject edits with a typed error: `{ code: 'SESSION_LOCKED', message: 'Sessao realizada ha mais de 7 dias nao pode ser editada' }`
- UI disables action buttons and shows a lock indicator with tooltip text "Bloqueada para edicao apos 7 dias"

Edge case: timezone change does not affect the lock since `TIMESTAMPTZ` stores absolute moments in UTC. The 7-day window is calculated against `updated_at` (when status was set to `done`), not `start_at`.

### 5. Notification events (Inngest)

Events emitted from Server Actions via `inngest.send()`. Each event is a typed Zod schema for payload validation.

| Event name | Trigger | Payload |
|---|---|---|
| `agenda/session.confirmed` | Patient confirms via public link or psychologist confirms manually | `{ sessionId, patientId, userId, confirmedAt, confirmedBy: 'patient' \| 'therapist' }` |
| `agenda/session.cancelled` | Psychologist or patient cancels | `{ sessionId, patientId, userId, cancelledAt, cancelledBy, reason, notice, chargeApplied }` |
| `agenda/session.done` | Psychologist marks as done | `{ sessionId, patientId, userId, doneAt }` |
| `agenda/session.no_show` | Psychologist marks no-show | `{ sessionId, patientId, userId, noShowAt }` |
| `agenda/session.rescheduled` | Reschedule creates new session | `{ oldSessionId, newSessionId, patientId, userId, rescheduledAt }` |
| `agenda/session.missing_note_reminder` | Cron: done session >7 days without clinical note | `{ sessionId, patientId, userId, doneAt, daysSinceDone }` |

**Mechanism: Inngest events.** Justification:
- Inngest is already in the stack for background jobs and cron
- Events are durable (retried on failure) unlike Postgres NOTIFY (fire-and-forget)
- Consumer functions (WhatsApp sending, in-app notification) will be Inngest functions in PRD 04
- A `pending_notifications` table would duplicate what Inngest already provides
- The `missing_note_reminder` is triggered by an Inngest scheduled function (cron) that queries sessions with `status='done'`, `updated_at < NOW() - INTERVAL '7 days'`, and no linked clinical note (JOIN against future `evolutions` table — initially a stub that always triggers since evolutions don't exist yet)

### 6. Session history entries

The `session_history` table (created by `agenda-foundation-and-sessions`) stores audit entries. Each status transition appends a row:

```
session_history {
  id: UUID PK
  session_id: UUID FK -> sessions
  user_id: UUID FK -> auth.users  -- who performed the action (null if patient via public link)
  action: VARCHAR(30)             -- 'status_changed', 'rescheduled', 'created', 'edited'
  from_status: VARCHAR(20) | NULL
  to_status: VARCHAR(20) | NULL
  metadata: JSONB                 -- cancellation details, reschedule link, etc.
  performed_by: VARCHAR(20)       -- 'therapist' | 'patient' | 'system'
  created_at: TIMESTAMPTZ
}
```

This is a dedicated table (not JSONB array) because:
- Queryable: "show all cancellations this month" is a simple WHERE
- No race conditions on concurrent updates to an array
- Clean foreign keys and indexing
- RLS can scope by session ownership (via JOIN to sessions.user_id)

RN-03.05 (never delete cancelled sessions) is enforced by:
1. No DELETE Server Action for sessions with `status != 'scheduled'` or that have any history entries beyond creation
2. RLS policy on `sessions` does NOT grant DELETE (only SELECT, INSERT, UPDATE) — hard DB-level prevention
3. The "Excluir definitivamente" action is a soft-delete (`deleted_at` timestamp) restricted to sessions that were never confirmed/done/cancelled/no_show (i.e., only ever `scheduled` with no meaningful history)

### 7. Reschedule = cancel + new session

UX flow:
1. Psychologist clicks "Remarcar" on session detail modal
2. System opens cancellation form pre-filled with reason "Remarcacao" and "Quem cancelou" based on context
3. After cancellation submits, system immediately opens the session creation modal pre-filled with same patient, location, duration, and amount
4. On new session save, system sets `old_session.rescheduled_to_session_id = new_session.id` and `new_session.rescheduled_from_session_id = old_session.id`
5. Both sessions appear in history with the link visible

Database columns on `sessions`:
- `rescheduled_to_session_id UUID REFERENCES sessions(id) NULL` — points to the replacement session
- `rescheduled_from_session_id UUID REFERENCES sessions(id) NULL` — points to the original cancelled session

This is bidirectional for easy traversal in both directions. Only one level of linking (no chains — if the replacement is also rescheduled, it gets its own pair of links).

### 8. Soft-delete for "Excluir definitivamente"

Since RN-03.05 prohibits hard deletion of sessions, the "Excluir definitivamente" option in RF-03.13 (available for `cancelled` sessions) is implemented as:
- A `deleted_at TIMESTAMPTZ NULL` column on `sessions`
- Server Action validates: session must have `status = 'cancelled'` AND no linked clinical note AND no payment record AND the session was never in `done` or `no_show` status (checked via `session_history`)
- All queries filter `WHERE deleted_at IS NULL` by default
- This preserves the row for audit while removing it from the psychologist's view

## Frontend — Design System Salvia (`docs/design-system/rules.md`)

### Status badges on calendar and detail modal

Each session status maps to a Badge variant with semantic color:

| Status | Badge variant | Colors (bg / text) | Label | Lucide icon |
|---|---|---|---|---|
| `scheduled` | `neutral` | `surface-muted` / `text-secondary` | Agendada | `Clock` |
| `confirmed` | `success` | `success-50` / `success-700` | Confirmada | `CheckCircle2` |
| `done` | `brand` | `brand-100` / `brand-700` | Realizada | `Check` |
| `cancelled` | `danger` | `danger-50` / `danger-700` | Cancelada | `XCircle` |
| `no_show` | `warning` | `warning-50` / `warning-700` | Falta | `AlertTriangle` |

Badge specs: height 22px, padding 2px 10px, radius `full`, font 12px weight 500. Icon 16px inline before label.

### Action buttons in session detail modal

Buttons are rendered conditionally based on current status. Layout: horizontal button group at the bottom of the modal, with primary action left-aligned and destructive action right-aligned.

| Action | Button variant | Icon | Condition |
|---|---|---|---|
| Confirmar presenca | `primary` | `CheckCircle2` | status = scheduled |
| Marcar como realizada | `primary` | `Check` | status = scheduled \| confirmed |
| Remarcar | `secondary` | `Calendar` | status = scheduled \| confirmed |
| Cancelar sessao | `danger` | `XCircle` | status = scheduled \| confirmed |
| Marcar como falta | `secondary` | `AlertTriangle` | status = scheduled \| confirmed |
| Reativar | `secondary` | `RotateCcw` | status = cancelled |
| Excluir definitivamente | `danger` | `Trash2` | status = cancelled (with restrictions) |
| Ver prontuario desta sessao | `link` | `FileText` | status = done |
| Adicionar pagamento | `link` | `Wallet` | status = done |
| Cobrar falta | `link` | `Wallet` | status = no_show |

For `done` sessions past 7 days, all buttons except links are replaced with a muted info bar: `Alert` info variant (bg `info-50`, text `info-700`, icon `Lock`) with text "Sessao bloqueada para edicao apos 7 dias".

Button size: `md` (40px height, 15px font). Loading state mandatory on async actions (>300ms). Max 1 `primary` button per context. `danger` buttons always require confirmation.

### Cancellation dialog

shadcn `Dialog` (not Drawer — this is a focused form, not a filter panel). Max-width 480px (sm modal), radius `2xl`, padding `space-8` desktop / `space-6` mobile.

Content:
- Title h3 "Cancelar sessao" (18px/600)
- shadcn `Select` for reason: options "Paciente cancelou", "Psicologo cancelou", "Imprevisto", "Outro"
- shadcn `RadioGroup` for "Quem cancelou": "Paciente" / "Psicologo"
- Calculated notice display: shadcn `Alert` with variant based on notice level:
  - `24h+`: `info` variant (bg `info-50`, text `info-700`) — "Cancelamento com mais de 24h de antecedencia"
  - `less_24h`: `warning` variant — "Cancelamento com menos de 24h de antecedencia"
  - `less_1h`: `warning` variant (stronger text) — "Cancelamento com menos de 1h de antecedencia"
  - `on_time`: `danger` variant — "Cancelamento no horario da sessao ou apos"
- shadcn `Switch` for "Aplicar cobranca?" with label
- Footer: "Cancelar sessao" `Button danger` + loading state, "Voltar" `Button secondary`

### Public confirmation page `/confirmar-sessao/[token]`

Layout mirrors `/termo/[token]` (consent term):
- Route group `(public)` — outside `(app)` authenticated layout
- Layout: logo centered at top, bg `background`, max-width 480px centered, no sidebar, no nav
- Mobile-first: full-width, padding `space-4` mobile / `space-8` desktop

**Valid token (session pending):**
- `Card default` (radius `xl`, padding `space-8`, shadow `xs`)
- Heading h2 "Confirmar presenca" (22px/600)
- Session info in body (15px/400): "Sessao de [data] as [hora]" and "com [nome da psicologa]"
- Location info if present: icon (`MapPin` for in-person, `Monitor` for online) + address/instructions
- Two action buttons with gap `space-4`:
  - "Confirmar presenca" `Button primary` full-width with loading state, icon `CheckCircle2`
  - "Nao posso comparecer" `Button secondary` full-width, icon `XCircle`
- Clicking "Nao posso comparecer" expands a `Textarea` for optional reason (placeholder "Motivo (opcional)") and a confirm `Button danger` "Confirmar cancelamento"

**After confirmation:**
- Icon `CheckCircle2` in `success-500` (24px), h3 "Presenca confirmada" in `text-primary`
- Body-sm "Sua psicologa foi notificada. Ate la!" in `text-secondary`

**After declining:**
- Icon `Info` in `info-500`, h3 "Cancelamento registrado"
- Body-sm "Sua psicologa foi notificada sobre o cancelamento." in `text-secondary`

**Token expired (after session time):**
- Icon `Clock` in `text-tertiary`, h3 "Link expirado"
- Body-sm "O horario desta sessao ja passou." in `text-secondary`

**Session already responded:**
- Icon `Info` in `info-500`, h3 "Voce ja respondeu"
- Body-sm "Esta confirmacao ja foi processada." in `text-secondary`

**Session cancelled by psychologist:**
- Icon `XCircle` in `danger-500`, h3 "Sessao cancelada"
- Body-sm "Esta sessao foi cancelada pela sua psicologa." in `text-secondary`

**Invalid token:**
- Icon `AlertCircle` in `danger-500`, h3 "Link invalido"
- Body-sm "Este link de confirmacao nao e valido." in `text-secondary`

**Accessibility:**
- Text size minimum 15px body, headings 18-22px
- Contrast WCAG 2.1 AA on all text
- Focus visible on all interactive elements (shadow-focus ring)
- Full keyboard navigation (Tab between buttons, Enter to activate)
- `aria-label` on icon-only elements
- `aria-live="polite"` on result messages after action
- Minimum touch target 44x44px on mobile
- `prefers-reduced-motion` respected on any transitions

### Microcopy (fixed glossary)

- "Confirmar presenca" (not "Confirmar sessao" or "Confirm")
- "Cancelar sessao" (not "Cancelar" alone)
- "Marcar como realizada" (not "Concluir" or "Finalizar")
- "Marcar como falta" (not "No-show" or "Ausencia")
- "Remarcar" (not "Reagendar" or "Mover")
- "Nao posso comparecer" (not "Cancelar" on the public page — avoids confusion with system cancel)
- "Reativar" (not "Reabrir" or "Restaurar")
- "Excluir definitivamente" (not "Deletar" or "Remover")
- "Lembrete" for reminders (not "Notificacao")
- No emojis in UI — map PRD icons to Lucide: Lock, CheckCircle2, XCircle, AlertTriangle, Clock

## Risks / Trade-offs

- **[Service role for public confirmation page]** — The public page uses service-role Supabase client to read/write the session (RLS blocks unauthenticated access). Same pattern as consent term. Mitigation: Server Component/Action filters ONLY by token, never exposes data beyond the specific session's confirmation-relevant fields (date, time, psychologist name — no clinical data).
- **[Token in URL is the only auth for public page]** — A leaked token allows anyone to confirm or cancel the session. Mitigation: token is 256-bit entropy (computationally infeasible to guess), expires after session time, and is single-use. The damage surface is limited (confirming/cancelling one session, not accessing patient records).
- **[Inngest event schema coupling]** — Consumer functions (PRD 04) must match the event schema defined here. If the schema changes, consumers break. Mitigation: event payloads are validated with Zod schemas exported from the agenda module — consumers import and validate against the same schema.
- **[Soft-delete complexity]** — Adding `deleted_at` to sessions means all queries must filter `WHERE deleted_at IS NULL`. Mitigation: Drizzle queries use a shared `notDeleted` condition. The alternative (hard delete) violates RN-03.05.
- **[Missing note reminder depends on future evolutions table]** — The RN-03.06 cron function needs to JOIN against a `clinical_notes` or `evolutions` table that doesn't exist yet. Mitigation: initially, the cron function stubs the JOIN (always considers note missing) and will be updated when PRD 05 is implemented. The Inngest function and event schema are ready; only the query needs updating.
