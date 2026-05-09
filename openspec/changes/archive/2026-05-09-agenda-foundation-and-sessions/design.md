## Context

The agenda module is the first scheduling capability in HubrityP. It depends on PRD 02 (patients module) being implemented — sessions reference patients. This change lays the foundation: schema, single-session CRUD, locations, settings, and calendar views. Recurrence, advanced status workflows, and patient-facing confirmation are deferred to subsequent changes.

The PRD appendix A provides a SQL reference model. This design adapts it to Drizzle ORM conventions, the project's RLS patterns, and the decision to split advanced features across multiple changes.

## Goals / Non-Goals

**Goals:**
- Database schema for `locations`, `sessions`, `agenda_settings`, and `session_history` with owner-scoped RLS
- Full CRUD for attendance locations with default-location support
- Agenda settings (duration, interval, business hours, cancellation policy text, default color)
- Single session creation with conflict detection (warn-not-block, per RN-03.01)
- Time-block creation (non-patient slots) with visual differentiation
- Three calendar views (day/week/month) with navigation, toggle, drag-and-drop reschedule
- Session detail modal with basic actions (edit, mark as done)
- Session history audit trail for changes
- Performance: <800ms load for 50 sessions via time-window indexing (RNF-03.01)

**Non-Goals:**
- **Recurring sessions** (`session_recurrences` table, edit-3-options, couple sessions) — deferred to change `agenda-recurring-sessions`
- **Advanced status flow** (cancelled, confirmed, no_show), cancellation with reason/notice/charge, patient-facing confirmation token, 7-day edit lock, event dispatch for PRD 04 — deferred to change `agenda-status-cancellation-confirmation`
- **WhatsApp reminders** (PRD 04), video integration (PRD 09), Google Calendar sync, public booking
- **Late record flag** (`is_late_record`) — deferred to change `agenda-recurring-sessions` alongside past-session entry
- **Couple sessions** (`patient_ids` array) — deferred to change `agenda-recurring-sessions`

## Decisions

### 1. FullCalendar.js over React Big Calendar

**Chosen:** FullCalendar v6 (`@fullcalendar/react` + plugins).

**Rationale:**
- **Built-in drag-and-drop** via `@fullcalendar/interaction` — no HOC wrapper needed, first-class support for event drag, resize, and date-click
- **Plugin architecture** keeps bundle lean — only import `daygrid`, `timegrid`, `interaction`
- **Custom event rendering** via `eventContent` prop — allows full JSX control for Design System compliance (icons, badges, colors)
- **TimeGrid views** (day/week) natively support time slots with configurable `slotMinTime`/`slotMaxTime` and `slotDuration`
- **TypeScript support** is first-class with `@fullcalendar/core` types
- **Locale support** via `@fullcalendar/core/locales/pt-br`

**Rejected alternative:** React Big Calendar — requires `moment.js` (or date-fns localizer but less tested), drag-and-drop via HOC wrapper (`withDragAndDrop`), less granular event rendering customization, and the API surface is more opinionated about styling (harder to align with Salvia DS).

**Bundle impact:** FullCalendar core + 3 plugins ~45KB gzipped. Loaded via `dynamic(() => import(...))` to avoid impacting non-agenda pages.

### 2. Schema: `agenda_settings` as separate table (not profile columns)

**Chosen:** Dedicated `agenda_settings` table with 1:1 relationship to profiles (keyed by `user_id`).

**Rationale:**
- Keeps the `profiles` table focused on auth/identity concerns (SRP)
- Agenda settings will grow (timezone preference, week-start-day, notification preferences) — a dedicated table avoids column bloat on profiles
- RLS policy is trivially `user_id = auth.uid()` (same as profiles)
- Upsert pattern (INSERT ON CONFLICT) matches the anamnesis precedent

**Rejected alternative:** Adding columns to `profiles` — rejected because it creates coupling between auth and scheduling domains, and the profiles table already has 15+ columns.

### 3. Timezone handling: store UTC, display in `America/Sao_Paulo`

All `start_at` and `end_at` columns use `TIMESTAMPTZ` (stored as UTC by Postgres). The application layer converts to the psychologist's timezone for display using `date-fns-tz`.

For this change, the timezone is hardcoded to `America/Sao_Paulo` (UTC-3). The infrastructure supports per-user timezone via a future `timezone` column in `agenda_settings` — the display helper accepts a timezone parameter, defaulting to `America/Sao_Paulo`.

This satisfies RNF-03.03 (prepared for multiple timezones) without over-engineering for a feature that 95%+ of users won't need yet.

### 4. Conflict detection algorithm

Conflict detection is a **pure function** that receives a candidate session `(start_at, end_at)` and an array of existing non-cancelled sessions for the same user in the same time window. It returns overlapping sessions using interval overlap logic: `existingStart < candidateEnd AND existingEnd > candidateStart`.

The query fetches sessions within a 24-hour window around the candidate time (indexed by `(user_id, start_at)`). The pure function enables easy unit testing.

Per RN-03.01, conflicts produce a **warning**, not a hard block. The UI shows "Voce ja tem [Nome] das 14h as 14:50 nesse horario" and lets the psychologist proceed if they choose ("Agendar mesmo assim").

### 5. Session history for audit trail

A `session_history` table records every mutation (create, update, reschedule, status change) with:
- `session_id` (FK), `user_id`, `action` (enum: 'created', 'updated', 'rescheduled', 'status_changed', 'deleted'), `changes` (JSONB diff), `created_at`

This satisfies RF-03.13 (modal shows history of changes). The history is append-only — no updates or deletes. RLS scopes to `user_id = auth.uid()`.

### 6. `locations` table with `is_default` flag

Only one location per psychologist can be default. The Server Action enforces this in a transaction: when setting a new default, it first clears the previous default (`UPDATE locations SET is_default = false WHERE user_id = $1 AND is_default = true`) then sets the new one. No DB-level unique partial index needed — the transaction guarantees consistency.

### 7. Business hours as JSONB in `agenda_settings`

Business hours are stored as a JSONB array of `{ day: number, start: string, end: string }` objects (e.g., `[{ "day": 1, "start": "08:00", "end": "20:00" }, ...]`). This accommodates per-day schedules (Mon-Fri 8-20, Sat 8-12) without requiring a separate table. FullCalendar's `businessHours` prop accepts this shape directly.

### 8. Modal for session CRUD, not page

Session creation and editing use modals (shadcn Dialog/Sheet), not dedicated pages. Rationale:
- The calendar is the primary context — leaving it to create a session breaks flow
- Quick-create (click on empty slot) naturally maps to a modal
- The form has ~8 fields — within modal complexity threshold (DS rules: "Modal for forms simples")
- Mobile: modal becomes full-screen sheet (bottom-up) per DS responsive pattern

The **detail modal** (view session) is a Drawer (Sheet) — right panel on desktop, bottom-up on mobile — so the psychologist sees details without losing calendar context.

## Frontend — Design System Salvia

### Calendar Views (`/app/agenda`)

**Page layout:**
- Title h1 "Agenda" (28px/600) with navigation bar below
- Navigation: `Button ghost` for prev/next arrows (`ChevronLeft`/`ChevronRight`, 20px), `Button secondary` "Hoje", shadcn `Popover` + `Calendar` for date-picker
- View toggle: shadcn `Tabs` underline variant — "Dia" / "Semana" / "Mes" (active: border-bottom 2px `brand-500`, text `primary`; idle: text `secondary`)
- "+ Agendar" button: `Button primary` (top-right) with `Plus` icon

**Calendar grid (FullCalendar):**
- Container: `Card flat` (border `border`, radius `xl`)
- Header (day names): bg `surface-muted`, text `secondary`, font 11px, weight 500, uppercase
- Time gutter: text `tertiary`, caption (12px)
- Current-time indicator: 2px line in `brand-500`
- Slot hover: bg `brand-50` (subtle highlight for clickable slots)
- Today column: bg `brand-50` (very subtle)

**Session event chips (inside calendar cells):**
- Regular session: bg derived from session `color` or `brand-100`, text `brand-700`, radius `sm`, padding `space-1 space-2`
  - Line 1: patient name (body-sm 13px/500, truncated)
  - Line 2: time range (caption 12px/400, `text-secondary`)
  - Location icon: `Building2` (in_person), `Video` (online) — 12px, inline, `text-tertiary`
  - Status badge: only `scheduled` (default) in this change — `Badge neutral` with `Clock` icon
- Blocking event: bg `surface-muted`, border dashed `border-strong`, text `text-secondary`
  - `Lock` icon (14px) + title (body-sm 13px/400)
  - No patient name, no status badge
- Drag ghost: shadow `md`, opacity 0.85, `brand-500` border-left 3px

**Month view events:**
- Compact pills: radius `full`, 22px height, patient name truncated, color dot only
- "+N mais" link when >3 events in a cell — text `brand-700`, caption size

**Responsive:**
- Mobile (<768px): default to day view, hide week/month tabs initially (accessible via toggle), navigation condensed to icon-only buttons, session chips show name + time only (no location icon)
- Desktop (>=1024px): default to week view, full navigation bar, all chip details visible
- Modal (create/edit) becomes bottom Sheet on mobile per DS pattern

### Session Create/Edit Modal

- shadcn `Dialog` (max-width 640px md, radius `2xl`, padding `space-8`)
- Title h3: "Agendar sessao" (create) / "Editar sessao" (edit) — 18px/600
- Form fields (React Hook Form + Zod):
  - "Paciente" — shadcn `Combobox` (Command + Popover) with search, required. Hidden when `is_blocking=true`
  - "Data" — shadcn `Popover` + `Calendar` date-picker
  - "Hora inicio" — shadcn `Select` with 30-min slots from business hours
  - "Duracao" — shadcn `Select` (30/40/45/50/60/90/120 min, default from agenda_settings)
  - "Hora fim" — auto-calculated, displayed as read-only caption below duration
  - "Local" — shadcn `Select` populated from locations, default = is_default location
  - "Modalidade" — shadcn `RadioGroup` (Presencial / Online)
  - "Valor" — shadcn `Input` type number, prefix "R$"
  - "Observacao" — shadcn `Textarea` (optional, 3 rows)
  - "Cor" — color picker (6 preset swatches from DS palette, no free-form input)
- Conflict warning: shadcn `Alert` variant `warning` (bg `warning-50`, text `warning-700`, icon `AlertTriangle`): "Voce ja tem [Nome] das 14h as 14:50 nesse horario" with `Button secondary` "Agendar mesmo assim"
- Validation: inline on blur per DS rule, error with `AlertCircle` icon in `danger-700`
- Gap label-to-input: `space-2`. Gap between fields: `space-4`
- Footer: "Salvar" `Button primary` (loading state), "Cancelar" `Button secondary`
- Mobile: full-screen Sheet slide-up

### Block Time Modal

- Same Dialog shell as session create, but simplified
- Title h3: "Bloquear horario"
- Fields: Titulo (Input, e.g. "Almoco", "Supervisao"), Data, Hora inicio, Duracao, Hora fim
- No patient, no value, no modality
- Footer: "Bloquear" `Button primary` with `Lock` icon, "Cancelar" `Button secondary`

### Session Detail Drawer

- shadcn `Sheet` (right panel desktop 480px, bottom-up mobile)
- Header: patient name as h3, `Badge` for status (`Clock` + "Agendada" in `neutral` variant)
- Body sections separated by `Separator`:
  - Date/time: `Calendar` icon + formatted date + time range
  - Location: `Building2`/`Video` icon + location name + address
  - Modality: text label
  - Value: "R$ 200,00"
  - Notes: text block if present
  - History: list of audit entries (caption, `text-tertiary`), most recent first
- Actions footer:
  - "Editar" `Button secondary` with `Pencil` icon
  - "Marcar como realizada" `Button primary` with `CheckCircle2` icon
  - (Future: "Cancelar", "Remarcar" — disabled/hidden in this change, placeholder for `agenda-status-cancellation-confirmation`)
- Blocking detail: shows title, time, no patient section, "Editar" + "Excluir" actions

### Drag-and-drop Reschedule

- On drop: inline confirmation `AlertDialog` — "Remarcar sessao de [Nome] para [nova data/hora]?" with "Confirmar" `Button primary` + "Cancelar" `Button ghost`
- Feedback: toast (Sonner) success "Sessao remarcada para [data] as [hora]" with `CheckCircle2` icon, border-left `success-500`
- Visual feedback during drag: <100ms response (RNF-03.02), ghost with shadow `md`

### Configuracoes > Locais de Atendimento

- Page title h1 "Locais de Atendimento" (28px/600)
- List: `Card interactive` per location (radius `xl`, padding `space-6`)
  - Name as h4 (16px/500), type as `Badge` (in_person: `neutral`, online: `info`), color dot
  - Address below in body-sm `text-secondary`
  - `Badge brand` "Padrao" if `is_default`
  - Actions: `MoreHorizontal` dropdown with Edit / Set as default / Delete
- Empty state: `Building2` icon (24px `text-tertiary`) + h4 "Nenhum local cadastrado" + "Cadastre seu primeiro local de atendimento" + "Adicionar local" `Button primary`
- Create/Edit: shadcn `Dialog` (max-width 480px) with fields: Nome (Input), Endereco (Input), Tipo (Select: Presencial/Online/Outro), Cor (swatches), Instrucoes de chegada (Textarea), Marcar como padrao (Checkbox)
- Delete: `AlertDialog` — "Excluir [nome]?" destructive confirm

### Configuracoes > Agenda

- Page title h1 "Configuracoes da Agenda" (28px/600)
- Single `Card default` (radius `xl`, padding `space-6`)
- Form sections separated by `Separator`:
  - "Duracao padrao da sessao" — `Select` (30/40/45/50/60/90/120 min, default 50)
  - "Intervalo entre sessoes" — `Select` (0/5/10/15/20/30 min, default 10)
  - "Horario de funcionamento" — per-day rows with `Checkbox` (enabled), two time `Select` (start/end). Mon-Fri checked by default 08:00-20:00, Sat 08:00-12:00, Sun unchecked
  - "Politica de cancelamento" — `Textarea` (optional, 5 rows) with helper text "Este texto sera incluido no termo de consentimento"
  - "Cor padrao das sessoes" — color swatches (6 options)
- Footer: "Salvar" `Button primary` with loading state

### Accessibility

- Calendar cells: `role="gridcell"`, `aria-label="[dia], [data] [hora]"`, navigable via arrow keys
- Session chips: `role="button"`, `aria-label="Sessao com [paciente] as [hora]"` or `aria-label="Bloqueio: [titulo] as [hora]"`
- Drag-and-drop: `aria-grabbed`, `aria-dropeffect` attributes; keyboard alternative via Edit modal
- Skip link on agenda page: "Pular para agenda"
- Focus trap in modals/drawers
- All standalone icons: `aria-hidden="true"` for decorative, `aria-label` for functional
- Focus ring: `shadow-focus` (brand-500 based) on all interactive elements
- Color alone never conveys meaning — icons + text always accompany color indicators

### Dark Mode

All tokens reference CSS variables that have `[data-theme='dark']` overrides. No hardcoded colors. FullCalendar's CSS will be overridden via Tailwind utilities mapping to DS tokens. Session chip backgrounds use semantic tokens (e.g., `brand-100` which auto-maps to dark equivalent `brand-100: #364937`).

### Microcopy (Glossary)

- "Sessao" (never "consulta" or "atendimento")
- "Agendar" / "Marcar sessao" (never "criar evento")
- "Paciente" (never "cliente" in default config)
- "Configuracoes" (never "preferencias")
- "Lembrete" (never "notificacao")
- "Bloqueio" / "Bloquear horario" (never "evento pessoal")
- "Realizada" (for done status, never "concluida")
- "Remarcar" (for reschedule via D&D, never "mover")

### Icon Mapping (PRD emojis to Lucide)

| PRD emoji | Lucide icon | Context |
|---|---|---|
| (lock) | `Lock` | Blocking event indicator |
| (building) | `Building2` | In-person location |
| (video) | `Video` | Online location |
| (check) | `CheckCircle2` | Confirmed/done status |
| (clock) | `Clock` | Scheduled status |
| (x) | `XCircle` | Cancelled status (future) |
| (warning) | `AlertTriangle` | Conflict warning, no-show (future) |

## Risks / Trade-offs

- **[FullCalendar CSS override complexity]** — FullCalendar ships its own CSS. We must override extensively to match Salvia DS. Mitigation: wrap in a Client Component with scoped Tailwind classes and CSS module overrides; document the override layer.
- **[Session history table growth]** — Every edit creates a history row. For a busy psychologist with 40 sessions/week and frequent edits, this can grow. Mitigation: the table is lightweight (JSONB diff), and pagination on the detail modal keeps UI snappy. Future: retention policy or archival.
- **[No recurrence in first change]** — Psychologists expect recurrence immediately. Mitigation: the schema is designed to accept `recurrence_id` FK from the start; the UI has a "Sessao recorrente" checkbox that shows "Em breve" tooltip. The follow-up change is planned.
- **[Conflict detection query scope]** — Fetching all sessions in a 24h window for conflict check. For most psychologists (8-12 sessions/day), this is fast. The composite index `(user_id, start_at)` ensures it stays under 10ms.
- **[date-fns-tz dependency]** — Adds ~5KB. Justified by timezone-safe date formatting. Already using `date-fns` for `pt-BR` locale.
