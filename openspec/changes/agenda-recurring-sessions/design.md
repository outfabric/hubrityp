## Context

Recurring sessions are the most common scheduling pattern in clinical psychology — a patient typically attends the same day/time weekly for months. This change adds recurrence rules, series materialization, edit propagation (Google Calendar pattern), couple sessions, and retroactive session logging.

This change **depends on `agenda-foundation-and-sessions`**, which creates the base `sessions`, `locations`, and `agenda_settings` tables, the single-session CRUD, calendar views, and the session creation/edit modal. We assume those exist and extend them here with recurrence, couple, and late-record capabilities.

The PRD (03-agenda-e-agendamentos) Appendix A defines the `session_recurrences` table and the relevant columns in `sessions`. This change implements that schema plus the business logic and UI.

## Goals / Non-Goals

**Goals:**
- `session_recurrences` table with RLS scoped by `user_id = auth.uid()`
- Recurrence UI in session creation form (frequency, end condition, day-of-week selection)
- Materialization: creating N individual `sessions` rows linked by `recurrence_id`
- Edit-3-options: "Apenas esta sessao" / "Esta e todas as proximas" / "Toda a serie"
- Couple session: `patient_ids UUID[]` supporting up to 2 patients per session
- Late record: `is_late_record` flag that bypasses past-date validation (RN-03.02)
- Pure generation function for recurrence dates (testable without DB)

**Non-Goals:**
- Base session CRUD, calendar views, drag-and-drop, modal de detalhes base -> `agenda-foundation-and-sessions`
- Status flow, cancellation with motive/notice/charge, public confirmation token, 7-day edit lock -> `agenda-status-cancellation-confirmation`
- WhatsApp reminders (PRD 04), video (PRD 09), clinical notes/evolution (PRD 05)
- RRULE/iCalendar standard compliance (we use a simpler custom model)
- Recurring time blocks (blocking recurrence reuses the same recurrence system but UI is in foundation)

## Decisions

### 1. Materialization over virtualization

**Decision:** Create all N individual session rows at recurrence creation time, linked by `recurrence_id`.

**Why (PRD mandates this):** RF-03.11 explicitly states "Sistema cria N sessoes individuais ligadas a um `recurrence_id` comum." Each session must be independently editable (status, time, notes), which rules out virtual expansion at query time.

**Tradeoffs:**
- N=24 (6 months weekly): 24 rows — trivially small, single INSERT batch
- N=52 (1 year weekly): 52 rows — still small, <100ms insert
- N=indefinite: **requires a cap**. We set `MAX_MATERIALIZED_SESSIONS = 104` (2 years weekly). For indefinite recurrences (`is_indefinite=true`), the system materializes the first 104 sessions and schedules an Inngest cron job to extend the series 3 months before the materialized window ends. This prevents unbounded row creation while keeping the "indefinite" UX seamless.

**Alternative rejected:** Virtual expansion (store only the rule, compute sessions on-the-fly). Rejected because: (a) each session needs independent status/notes/edits, (b) conflict detection requires concrete rows, (c) PRD explicitly mandates materialization.

### 2. Edit-3-options propagation algorithm

**"Apenas esta sessao":** The edited session is detached from the series. Set `recurrence_id = NULL` on this session, apply edits only to it. The rest of the series remains unchanged.

**"Esta e todas as proximas":** Split the series at the edit point.
1. Update `session_recurrences.end_date` to the day before the edited session's date (old series now ends earlier).
2. Create a new `session_recurrences` row with the updated rule starting from the edited session's date.
3. Update all sessions with the old `recurrence_id` whose `start_at >= edited_session.start_at` to point to the new `recurrence_id`.
4. Apply the field edits (time, location, etc.) to all those reassigned sessions.

**"Toda a serie":** Apply edits to all sessions in the series that are still in the future (status != `done`, `cancelled`, `no_show`). Past/completed sessions are never modified.

**Edge case — "Pausa temporaria":** Handled by cancelling N individual sessions within the series. No special "pause" concept needed — the psychologist selects the sessions to cancel (individually or via date range).

**Edge case — "Mudanca de horario fixo":** Handled by "Esta e todas as proximas" with the new time. This is the standard Google Calendar behavior.

### 3. Couple session: `patient_ids UUID[]` vs singular `patient_id`

**Decision:** Coexist both columns. `patient_id` remains the primary FK for standard sessions (used by indexes, joins, RLS). `patient_ids UUID[]` is populated only for couple sessions and always contains both patient IDs (including the one in `patient_id`).

**Why coexist instead of migrating to always-array:**
- `patient_id` is the FK used by indexes (`idx_sessions_patient`), RLS policies (subquery on patients), and joins throughout the foundation change. Removing it would break all those queries and require rewriting RLS policies to use `ANY(patient_ids)`.
- Couple sessions are an edge case (~5% of sessions). The array column adds the capability without disrupting the common path.
- When `patient_ids` is non-null and has 2 entries, the UI shows both patient names. `patient_id` is set to the "primary" patient (first selected).

**Constraint:** `patient_ids` max length = 2 (validated in Zod schema and DB CHECK constraint). This is a clinical product for individual/couple therapy, not group therapy.

### 4. Late record (`is_late_record`) — validation relaxation

**Decision:** When `is_late_record = true`, the following validations are relaxed:
- **RN-03.02 (no past scheduling):** Bypassed — the session date can be in the past
- **Conflict detection (RN-03.01):** Still enforced — even retroactive records must not overlap existing sessions (prevents accidental double-booking in historical records)
- **Reminder dispatch:** Skipped — no WhatsApp reminder is sent (the session already happened)

**How it works:** The session creation form has a toggle "Lancamento retroativo" (visible only when the selected date is in the past). Setting it flips `is_late_record=true` and sets status directly to `done`.

**Validations that remain:**
- RLS (owner-scoped access)
- Required fields (patient, date, time, duration)
- Conflict detection (RN-03.01)

### 5. Recurrence generation — cap and extension strategy

The pure function `generateRecurrenceInstances(rule, options)` receives a recurrence rule and returns an array of `Date` objects:

```
Input:  { frequency, daysOfWeek, startDate, endDate?, occurrenceCount?, isIndefinite }
Output: Date[]  (each date = start_at of a session instance)
```

For indefinite recurrences, the function receives `{ isIndefinite: true, materializationWindowMonths: 24 }` and generates dates for the next 24 months (cap at 104 instances for weekly). An Inngest scheduled function checks monthly for indefinite series approaching their materialization horizon and extends them.

Time of day comes from the session template (the original time set in the form), not from the recurrence rule. The function generates dates only; the caller combines date + time.

### 6. Recurrence deletion

When deleting a recurrence series:
- "Apenas esta sessao": delete/cancel the single session (soft-delete per RN-03.05)
- "Esta e todas as proximas": cancel all future sessions in the series, update `session_recurrences.end_date`
- "Toda a serie": cancel all non-completed sessions, mark `session_recurrences` as ended

Deletion follows the same 3-option modal as editing.

## Frontend — Design System Salvia (`docs/design-system/rules.md`)

### Recurrence section in session creation form

The recurrence UI is a collapsible section within the existing session creation/edit modal (from foundation). It expands when "Sessao recorrente" is checked.

**Checkbox "Sessao recorrente":**
- shadcn `Checkbox` + `Label` ("Sessao recorrente")
- Gap `space-3` between checkbox and label
- When checked, expands a `Collapsible` section below with `duration-base` (200ms) animation

**Frequency selector:**
- shadcn `RadioGroup` with 4 `RadioGroupItem` options: "Semanal", "Quinzenal", "Mensal", "Personalizada"
- Layout: vertical stack, gap `space-3` between items
- Each item: `RadioGroupItem` + `Label`, text body (15px/400)
- `aria-label="Frequencia da recorrencia"` on the RadioGroup

**Days of week selector (visible when frequency = "Semanal" or "Personalizada"):**
- shadcn `ToggleGroup` type `multiple` with 7 `ToggleGroupItem` buttons
- Labels: "D", "S", "T", "Q", "Q", "S", "S" (Dom-Sab), full day name as `aria-label`
- Size: 40x40px (md), radius `md`, gap `space-2`
- Active state: bg `brand-500`, text `inverse`
- Idle state: bg `surface-muted`, text `secondary`, border `border`
- Focus: `shadow-focus` ring

**Repetition end condition:**
- shadcn `RadioGroup` with 3 options:
  - "Data especifica" -> reveals shadcn `Popover` with `Calendar` component for date selection
  - "Numero de sessoes" -> reveals `Input type=number` (min=2, max=104, placeholder "Ex: 24")
  - "Indefinido" -> no extra input; helper text in `text-tertiary` caption: "O sistema criara sessoes para os proximos 2 anos automaticamente"
- Layout: vertical stack, gap `space-3`
- Label "Repetir ate" in h4 (16px/500), gap `space-2` below label

**Spacing within collapsible:**
- Padding top `space-4` (separating from checkbox)
- Gap between sections (frequency, days, end condition): `space-6`
- Entire recurrence block wrapped in a subtle bg `surface-sunken` card with radius `lg` and padding `space-4`

### Edit-scope modal (3 options)

- shadcn `AlertDialog` (max-width 480px, radius `2xl`, padding `space-8`)
- Title h3 (18px/600): "Editar sessao recorrente"
- Description in body `text-secondary`: "Esta sessao faz parte de uma serie. Como deseja aplicar as alteracoes?"
- 3 options as shadcn `Button secondary` stacked vertically, full-width, gap `space-3`:
  1. "Apenas esta sessao" — subtitle in caption `text-tertiary`: "As demais sessoes da serie nao serao alteradas"
  2. "Esta e todas as proximas" — subtitle: "Sessoes anteriores permanecem como estao"
  3. "Toda a serie" — subtitle: "Todas as sessoes futuras serao atualizadas"
- Each button: text-left alignment, padding `space-3 space-4`, radius `lg`
- Cancel link at bottom: `Button ghost` "Cancelar"
- Focus trapped in dialog; first option receives focus on open
- Escape closes; click outside closes

### Couple session — multi-patient selector

- In the session creation form, the patient field changes behavior:
  - Default: single patient `Select` (from foundation)
  - When couple mode is toggled: second `Select` appears below with label "Segundo paciente"
- Toggle: shadcn `Checkbox` + `Label` "Atendimento de casal" below the patient field
- When checked: second `Select` with same patient search/select as the first, gap `space-3`
- Both selects share the same patient list but prevent selecting the same patient twice
- Validation error if same patient selected in both: `danger-700` inline message "Selecione pacientes diferentes"

### Late record toggle

- Visible only when the selected date/time is in the past
- shadcn `Checkbox` + `Label` "Lancamento retroativo"
- Helper text in caption `text-tertiary`: "Esta sessao ja foi realizada e sera registrada como concluida"
- When checked, status is automatically set to `done` (status field becomes read-only)
- No visual change to the rest of the form; the toggle is placed after the date/time fields

### Recurring session indicator in calendar views

- Sessions that are part of a recurrence show a small `Repeat` icon (Lucide, 12px) in the bottom-right corner of the calendar cell
- Couple sessions show both patient initials separated by " & " in the cell title
- These are visual-only indicators; interaction opens the same detail modal

### Responsiveness

- Recurrence section: single column on all breakpoints (already vertical)
- Edit-scope AlertDialog: full-screen slide-up on mobile (< md), centered modal on desktop
- Days-of-week ToggleGroup: wraps naturally on narrow screens (flex-wrap)
- Couple patient selects: stack vertically on mobile (already the default)

### Accessibility

- RadioGroup frequency: `aria-label="Frequencia da recorrencia"`, arrow key navigation between options
- ToggleGroup days: each item has `aria-label` with full day name ("Domingo", "Segunda-feira", etc.)
- AlertDialog edit-scope: focus trapped, Escape closes, `aria-describedby` on description text
- Late record checkbox: `aria-label="Marcar como lancamento retroativo"`
- All interactive elements meet 44x44px minimum touch target on mobile

## Risks / Trade-offs

- **[Materialization cap at 104]** For indefinite weekly recurrences, 104 sessions = 2 years. The Inngest extension job adds complexity but prevents unbounded growth. If the job fails, the psychologist sees sessions only up to the materialized window — acceptable degradation, not data loss.
- **[Series split on "Esta e todas as proximas"]** Creates a new `session_recurrences` row, increasing table size. For typical use (1-2 splits per series lifetime), this is negligible.
- **[Coexisting patient_id + patient_ids]** Adds slight schema complexity. The alternative (always-array) would require rewriting all foundation queries and RLS policies, which is a larger change with higher risk.
- **[Edit-scope modal adds friction]** Every edit to a recurring session requires an extra click. This matches Google Calendar behavior and user expectations — the modal prevents accidental mass edits.
- **[Late record edge case]** A psychologist could abuse `is_late_record` to backfill sessions indefinitely. This is acceptable — the data belongs to the psychologist, and there is no regulatory limit on retrospective documentation (in fact, CFP encourages retroactive record-keeping over no record at all).
