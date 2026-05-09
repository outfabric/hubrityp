## Why

The agenda is the operational heart of a psychology practice. Psychologists currently juggle Google Calendar, notebooks, and mental notes to coordinate patient sessions, personal blocks, and location changes. This fragmentation causes missed sessions, double-bookings, and confusion about whether a session is online or in-person — all of which translate to lost revenue and patient dissatisfaction.

HubrityP needs a native agenda module that centralizes session management with conflict detection, multiple locations, and visual calendar views, serving as the foundation upon which recurring sessions, status workflows, reminders, and billing will be built.

## What Changes

- New database tables: `locations`, `sessions`, `agenda_settings` — with owner-scoped RLS policies and appropriate indexes for time-window queries
- CRUD for attendance locations (Configuracoes > Locais de Atendimento): list, create, edit, delete, mark default
- Agenda settings page (Configuracoes > Agenda): default duration, inter-session interval, business hours, cancellation policy text, default session color
- Single session creation via modal (quick-create from empty slot + full form), with overlap conflict detection (warn, not block)
- Single session editing and deletion (basic — status defaults to `scheduled`, no advanced status flow)
- Time-block creation (`is_blocking=true`, no patient, Lock icon, differentiated color)
- Three calendar views at `/app/agenda`: day (default mobile), week (default desktop), month — with navigation (arrows, "Hoje", date-picker)
- Session detail modal showing all fields + basic actions (Editar, Marcar como realizada)
- Drag-and-drop to reschedule sessions with inline confirmation
- Session history tracking via `session_history` table for audit trail (RF-03.13)

## Capabilities

### New Capabilities
- `agenda-locations`: CRUD for attendance locations with type (in_person/online/other), color, arrival instructions, and default flag — linked to sessions
- `agenda-settings`: Per-psychologist agenda configuration (default duration, interval, business hours, cancellation policy, default color)
- `agenda-sessions`: Single session CRUD with conflict detection (overlap warning), time-block creation (is_blocking), session history audit, and basic status (scheduled/done)
- `agenda-views`: Three calendar views (day/week/month) with navigation, toggle, date-picker, drag-and-drop reschedule, and session detail modal

### Modified Capabilities
- `app-sidebar`: Sidebar gains "Agenda" nav item with Calendar icon, linking to /app/agenda

## Impact

- **Dependencies:** `@fullcalendar/react`, `@fullcalendar/core`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction` (calendar UI with built-in D&D); `date-fns-tz` (timezone handling)
- **Routes:** `src/app/(app)/agenda/page.tsx`, `src/app/(app)/configuracoes/locais/page.tsx`, `src/app/(app)/configuracoes/agenda/page.tsx`
- **New module:** `src/modules/agenda/` (server actions, components, lib, validators)
- **DB schema:** New files in `src/shared/db/schema/agenda/` (tables.ts, policies.ts, index.ts)
- **Performance:** Time-window queries with composite index on (user_id, start_at) ensure <800ms for 50 sessions (RNF-03.01)
- **Frontend:** FullCalendar wrapped in Client Component, custom event rendering following Design System Salvia, responsive (day view on mobile, week on desktop)
