# agenda-views Specification

## Purpose

Calendar UI for viewing and interacting with the psychologist's agenda: day, week, and month views with session chips, navigation controls, drag-and-drop rescheduling, click-to-create, and detail drawer.

## Requirements

### Requirement: Psychologist can view the agenda in day view

The system SHALL render a day view as a single vertical column with time slots from business hours start to end (default 07:00-22:00), with 30-minute slot granularity. Sessions and blocks appear as positioned event chips within their corresponding time slots.

#### Scenario: Day view with sessions

- **WHEN** psychologist navigates to /app/agenda and selects day view for 2026-05-15 which has 3 sessions
- **THEN** the day column shows 3 session chips at their correct time positions with patient name, time range, and location icon

#### Scenario: Day view is default on mobile

- **WHEN** psychologist opens /app/agenda on a mobile device (viewport < 768px)
- **THEN** the day view is shown by default

### Requirement: Psychologist can view the agenda in week view

The system SHALL render a week view as a 7-column grid (Sunday to Saturday) with time slots. Each column shows sessions for that day. The current day column has a subtle highlight.

#### Scenario: Week view with sessions across multiple days

- **WHEN** psychologist selects week view for the week of 2026-05-11
- **THEN** the grid shows 7 columns, with sessions positioned in their respective day columns at correct times

#### Scenario: Week view is default on desktop

- **WHEN** psychologist opens /app/agenda on a desktop device (viewport >= 1024px)
- **THEN** the week view is shown by default

#### Scenario: Today column is highlighted

- **WHEN** the current week is displayed
- **THEN** today's column has a subtle brand-50 background highlight

### Requirement: Psychologist can view the agenda in month view

The system SHALL render a month view as a traditional calendar grid. Each day cell shows compact event pills (patient name truncated, color dot). When more than 3 events exist in a day cell, a "+N mais" link is shown.

#### Scenario: Month view with busy day

- **WHEN** psychologist views month and 2026-05-15 has 8 sessions
- **THEN** the cell for May 15 shows 3 event pills and a "+5 mais" link

#### Scenario: Click "+N mais" expands day

- **WHEN** psychologist clicks "+5 mais" on a day cell
- **THEN** system navigates to day view for that date, showing all sessions

### Requirement: Psychologist can navigate between time periods

The system SHALL provide navigation controls: previous/next arrows, "Hoje" button to jump to current period, and a date-picker to jump to a specific date.

#### Scenario: Navigate to next week

- **WHEN** psychologist clicks the next arrow in week view
- **THEN** the calendar advances to the following week

#### Scenario: Jump to today

- **WHEN** psychologist clicks "Hoje"
- **THEN** the calendar navigates to the current day/week/month (depending on active view)

#### Scenario: Jump to specific date via date-picker

- **WHEN** psychologist selects 2026-07-20 in the date-picker
- **THEN** the calendar navigates to the period containing July 20

### Requirement: Psychologist can toggle between views

The system SHALL provide a tab-style toggle to switch between day, week, and month views. The active view is visually indicated with an underline.

#### Scenario: Switch from week to day view

- **WHEN** psychologist clicks "Dia" tab while in week view
- **THEN** the calendar switches to day view for the currently focused date

### Requirement: Session chips display key information

The system SHALL render each session in the calendar grid as a chip showing: patient name (line 1), time range (line 2), location icon (Building2 for in_person, Video for online), and status indicator. Blocking events show Lock icon + title with muted styling.

#### Scenario: Regular session chip in week view

- **WHEN** a session with patient "Marina" at 14:00-14:50 at "Consultorio" exists
- **THEN** the chip shows "Marina" (truncated if needed), "14:00 - 14:50", Building2 icon

#### Scenario: Blocking event chip in week view

- **WHEN** a blocking event "Supervisao" at 08:00-09:30 exists
- **THEN** the chip shows Lock icon + "Supervisao", with dashed border and muted background

### Requirement: Click on session opens detail drawer

The system SHALL open a detail drawer (Sheet) when the psychologist clicks on a session chip in the calendar. The drawer shows all session fields, history, and action buttons.

#### Scenario: Open detail for regular session

- **WHEN** psychologist clicks on "Marina 14:00" chip
- **THEN** the Sheet opens showing: patient "Marina Silva", date/time, location, modality, value, notes, status badge "Agendada", history entries, and action buttons "Editar" and "Marcar como realizada"

#### Scenario: Open detail for blocking event

- **WHEN** psychologist clicks on a blocking event chip
- **THEN** the Sheet opens showing: title "Almoco", date/time, and action buttons "Editar" and "Excluir"

### Requirement: Drag-and-drop reschedules sessions with confirmation

The system SHALL allow the psychologist to drag a session chip to a different time slot (or day in week view) to reschedule it. A confirmation dialog appears before the change is persisted. Visual feedback must appear in <100ms.

#### Scenario: Drag session to new time

- **WHEN** psychologist drags "Marina 14:00" from 14:00 to 16:00 on the same day
- **THEN** system shows confirmation "Remarcar sessao de Marina para 16:00?" with "Confirmar" and "Cancelar" buttons

#### Scenario: Confirm reschedule

- **WHEN** psychologist confirms the drag-and-drop reschedule
- **THEN** session start_at and end_at are updated, history entry "rescheduled" is recorded, and toast "Sessao remarcada para 15/05 as 16:00" appears

#### Scenario: Cancel reschedule

- **WHEN** psychologist clicks "Cancelar" in the confirmation dialog
- **THEN** the session snaps back to its original position; no changes are saved

#### Scenario: Drag to conflicting time shows warning

- **WHEN** psychologist drags a session to a slot that overlaps with another session
- **THEN** the confirmation dialog includes a conflict warning "Voce ja tem [Nome] nesse horario. Remarcar mesmo assim?"

### Requirement: Click on empty slot opens quick-create

The system SHALL open the session creation modal pre-filled with the clicked slot's date and time when the psychologist clicks an empty time slot in day or week view.

#### Scenario: Click empty slot

- **WHEN** psychologist clicks the empty 10:00 slot on 2026-05-18
- **THEN** the session creation modal opens with date=2026-05-18 and start=10:00 pre-filled

### Requirement: Calendar loads within 800ms for 50 sessions

The system SHALL load and render the calendar view (including all sessions for the visible time window) within 800ms. Sessions are fetched with a time-window query using the composite index on (user_id, start_at).

#### Scenario: Week view with 50 sessions loads under 800ms

- **WHEN** psychologist opens week view and the week contains 50 sessions
- **THEN** the calendar is fully rendered (sessions visible) within 800ms

### Requirement: Dates display in Sao Paulo timezone

The system SHALL display all dates and times in the `America/Sao_Paulo` timezone (UTC-3). All timestamps are stored as UTC in the database and converted for display.

#### Scenario: Session stored as UTC displays in Sao Paulo time

- **WHEN** a session has start_at = "2026-05-15T17:00:00Z" (UTC)
- **THEN** the calendar displays it at 14:00 (America/Sao_Paulo = UTC-3)
