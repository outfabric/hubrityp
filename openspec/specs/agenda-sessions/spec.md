# agenda-sessions Specification

## Purpose

Core session (appointment) management for the psychologist's agenda: create, edit, delete, mark as done, time blocks, conflict detection, and append-only session history.

## Requirements

### Requirement: Psychologist can create a single session

The system SHALL allow the psychologist to create a session with: patient (required), date, start time, duration (default from agenda_settings), auto-calculated end time, location (default from is_default location), modality (in_person/online), value (optional), notes (optional), and color (optional). The session status defaults to `scheduled`.

#### Scenario: Create session with all fields

- **WHEN** psychologist fills all fields (patient "Marina Silva", date 2026-05-15, start 14:00, duration 50min, location "Consultorio Vila Mariana", modality "in_person", value 200.00) and clicks "Salvar"
- **THEN** system creates the session with status "scheduled", end_at auto-calculated to 14:50, and it appears in the calendar

#### Scenario: Create session with defaults only

- **WHEN** psychologist selects only patient and date/time (other fields use defaults)
- **THEN** system creates the session with default duration from agenda_settings, default location, no value, no notes

#### Scenario: End time is auto-calculated from start + duration

- **WHEN** psychologist sets start_at to 14:00 and duration to 50 minutes
- **THEN** end_at is calculated as 14:50 and displayed read-only

### Requirement: Quick-create session from empty calendar slot

The system SHALL open the session creation modal pre-filled with the clicked slot's date and time when the psychologist clicks an empty time slot in day or week view.

#### Scenario: Click empty slot at 10:00 on Monday

- **WHEN** psychologist clicks the empty slot at 10:00 on 2026-05-18 (Monday) in the week view
- **THEN** the creation modal opens with date pre-filled to 2026-05-18 and start time to 10:00

### Requirement: Conflict detection warns about overlapping sessions

The system SHALL detect time overlaps between the new/edited session and existing non-cancelled sessions for the same psychologist. Conflicts produce a warning (not a hard block). The psychologist can force-create despite conflicts.

#### Scenario: Session overlaps with existing session

- **WHEN** psychologist creates a session at 14:00-14:50 and another session exists at 14:00-14:50 with patient "Joao"
- **THEN** system shows warning "Voce ja tem Joao das 14:00 as 14:50 nesse horario" with option "Agendar mesmo assim"

#### Scenario: Psychologist forces creation despite conflict

- **WHEN** psychologist sees the conflict warning and clicks "Agendar mesmo assim"
- **THEN** system creates the session despite the overlap

#### Scenario: No conflict with cancelled sessions

- **WHEN** psychologist creates a session at 14:00 and the only overlapping session has status "cancelled"
- **THEN** no conflict warning is shown

#### Scenario: Partial overlap is detected

- **WHEN** psychologist creates a session at 14:30-15:20 and another exists at 14:00-14:50
- **THEN** system shows conflict warning (14:30-14:50 overlaps)

### Requirement: Psychologist cannot schedule sessions in the past

The system SHALL reject session creation with a start_at in the past. The error message is "Nao e possivel agendar sessoes no passado." Exception: when `is_late_record` is set to `true` (see `agenda-recurring-sessions` capability), past dates are accepted and the session is created with status `done`.

#### Scenario: Attempt to create session in the past

- **WHEN** psychologist tries to create a session with start_at = yesterday 14:00
- **THEN** system shows validation error "Nao e possivel agendar sessoes no passado"

#### Scenario: Session starting now or later is accepted

- **WHEN** psychologist creates a session starting in 30 minutes
- **THEN** system accepts and creates the session

#### Scenario: Late record bypasses past-date validation

- **WHEN** psychologist creates a session with `is_late_record=true` and a past date
- **THEN** system accepts the session and creates it with status `done` (see `agenda-recurring-sessions` capability for full late record spec)

### Requirement: Psychologist can edit a single session

The system SHALL allow the psychologist to edit all fields of an existing session. Editing a session records the change in session_history.

#### Scenario: Edit session time

- **WHEN** psychologist changes session start from 14:00 to 15:00 and saves
- **THEN** system updates start_at and end_at, records history entry "rescheduled" with old and new times

#### Scenario: Edit session patient

- **WHEN** psychologist changes the patient from "Marina" to "Carlos"
- **THEN** system updates patient_id and records history entry "updated"

### Requirement: Psychologist can delete a session

The system SHALL allow the psychologist to delete a session with status `scheduled`. Deletion is permanent (hard delete) with confirmation dialog. A history entry "deleted" is recorded before removal.

#### Scenario: Delete a scheduled session

- **WHEN** psychologist clicks delete on a scheduled session and confirms in the AlertDialog
- **THEN** system records a "deleted" history entry, then permanently removes the session

### Requirement: Psychologist can mark a session as done

The system SHALL allow the psychologist to change a session's status from `scheduled` to `done`. This records a history entry "status_changed" with the old and new status.

#### Scenario: Mark session as done

- **WHEN** psychologist clicks "Marcar como realizada" on a scheduled session
- **THEN** session status changes to "done" and a history entry is recorded

### Requirement: Psychologist can create a time block

The system SHALL allow the psychologist to create a blocking event (non-patient) with: title, date, start time, duration, end time. Blocking events have `is_blocking=true`, no patient_id, and appear with differentiated styling (dashed border, Lock icon, muted color).

#### Scenario: Create a lunch block

- **WHEN** psychologist clicks "Bloquear horario" and fills title "Almoco", date 2026-05-15, start 12:00, duration 60min
- **THEN** system creates a session with is_blocking=true, blocking_title="Almoco", no patient_id

#### Scenario: Block appears differently in calendar

- **WHEN** a blocking event exists at 12:00-13:00
- **THEN** the calendar renders it with Lock icon, dashed border, muted background color, and title "Almoco" (not a patient name)

#### Scenario: Blocks participate in conflict detection

- **WHEN** psychologist creates a patient session overlapping with a block
- **THEN** system shows conflict warning mentioning the block title

### Requirement: Session mutations are recorded in session_history

The system SHALL record every create, update, reschedule, status change, and delete action in the `session_history` table with: session_id, user_id, action type, JSONB diff of changes, and timestamp. The history is append-only.

#### Scenario: Session creation records history

- **WHEN** a new session is created
- **THEN** a history entry with action "created" and the full initial data is recorded

#### Scenario: Session edit records diff

- **WHEN** psychologist changes session start_at from 14:00 to 15:00
- **THEN** a history entry with action "rescheduled" and changes `{ "start_at": { "old": "14:00", "new": "15:00" }, "end_at": { "old": "14:50", "new": "15:50" } }` is recorded

#### Scenario: History is visible in session detail

- **WHEN** psychologist opens the session detail drawer
- **THEN** the history section shows all entries for that session, most recent first, with timestamps

### Requirement: Sessions table supports recurrence, couple patients, and late records

The `sessions` table SHALL include the following columns added by `agenda-recurring-sessions`:
- `recurrence_id UUID REFERENCES session_recurrences(id)` — links the session to a recurrence series (NULL for one-off sessions)
- `patient_ids UUID[]` — array of up to 2 patient UUIDs for couple sessions (NULL for individual sessions; when set, `patient_id` holds the primary patient)
- `is_late_record BOOLEAN DEFAULT FALSE` — when true, bypasses past-date validation (RN-03.02) and creates the session with status `done`

These columns are defined and fully specified in the `agenda-recurring-sessions` capability. The session creation/edit form gains: a recurrence checkbox expanding frequency/end-condition options, a couple patient selector ("Atendimento de casal"), and a late record toggle ("Lancamento retroativo").

#### Scenario: Session with recurrence_id belongs to a series

- **WHEN** a session has a non-null `recurrence_id`
- **THEN** editing or cancelling that session presents the 3-option scope modal (see `agenda-recurring-sessions` for details)

#### Scenario: Couple session stores both patients

- **WHEN** a couple session is created with patients "Ana" and "Carlos"
- **THEN** `patient_id = Ana.id`, `patient_ids = [Ana.id, Carlos.id]`, and the calendar displays "Ana & Carlos"

### Requirement: Sessions table includes cancellation, confirmation, and reschedule columns

The `sessions` table (created by `agenda-foundation-and-sessions`) SHALL be extended with the following columns for status lifecycle management:

- `cancellation_reason VARCHAR(50)` — predefined reason code: `'patient_cancelled'`, `'therapist_cancelled'`, `'unforeseen'`, `'other'`
- `cancelled_by VARCHAR(20)` — `'patient'` or `'therapist'`
- `cancellation_notice VARCHAR(20)` — auto-calculated: `'24h+'`, `'less_24h'`, `'less_1h'`, `'on_time'`
- `cancelled_at TIMESTAMPTZ` — when cancellation occurred
- `charge_cancellation BOOLEAN DEFAULT FALSE` — whether to charge for the cancellation
- `confirmation_token VARCHAR(64) UNIQUE` — public confirmation link token
- `confirmed_at TIMESTAMPTZ` — when patient confirmed attendance
- `rescheduled_to_session_id UUID REFERENCES sessions(id)` — replacement session (set on cancelled session)
- `rescheduled_from_session_id UUID REFERENCES sessions(id)` — original session (set on new session)
- `deleted_at TIMESTAMPTZ` — soft-delete timestamp (filtered from all queries)
- CHECK constraint: `status IN ('scheduled', 'confirmed', 'done', 'cancelled', 'no_show')`

#### Scenario: Migration adds all columns to existing sessions table

- **WHEN** the migration for this change runs
- **THEN** all new columns are added to the `sessions` table as nullable (except `charge_cancellation` which defaults to FALSE and the CHECK constraint), and the UNIQUE index on `confirmation_token` is created

#### Scenario: CHECK constraint prevents invalid status

- **WHEN** a SQL update attempts `SET status = 'invalid_status'`
- **THEN** Postgres rejects with a CHECK constraint violation

#### Scenario: Reschedule self-references are valid

- **WHEN** session A is rescheduled to session B
- **THEN** `A.rescheduled_to_session_id = B.id` and `B.rescheduled_from_session_id = A.id` — self-referencing FK on sessions is valid

### Requirement: RLS enforces owner-scoped access on sessions and session_history tables

The system SHALL enable RLS on `sessions` using `user_id = auth.uid()`. The `session_history` table uses the same policy. A psychologist can only access their own sessions and history.

#### Scenario: Cross-psychologist session access is blocked

- **WHEN** psychologist A queries the sessions table
- **THEN** only sessions belonging to psychologist A are returned

#### Scenario: Cross-psychologist history access is blocked

- **WHEN** psychologist A queries session_history
- **THEN** only history entries for psychologist A's sessions are returned

### Requirement: Sessions RLS prevents DELETE operations

The system SHALL configure RLS policies on `sessions` to grant SELECT, INSERT, and UPDATE (scoped to `user_id = auth.uid()`) but NOT DELETE. This enforces RN-03.05 at the database level — cancelled sessions are preserved forever. The soft-delete pattern (`deleted_at IS NOT NULL`) handles cleanup without violating this constraint.

#### Scenario: Authenticated user cannot DELETE session via RLS

- **WHEN** an authenticated psychologist issues a DELETE query against their own session
- **THEN** RLS blocks the operation (no DELETE policy exists)

#### Scenario: Authenticated user can UPDATE their own session

- **WHEN** an authenticated psychologist updates status of their own session
- **THEN** the UPDATE succeeds (scoped by `user_id = auth.uid()`)

### Requirement: All session queries filter soft-deleted records

The system SHALL append `WHERE deleted_at IS NULL` (or Drizzle equivalent `isNull(sessions.deletedAt)`) to all session queries by default. Soft-deleted sessions are invisible in calendar views, listings, statistics, and search.

#### Scenario: Soft-deleted session does not appear in agenda view

- **WHEN** a session has `deleted_at` set
- **THEN** it does not appear in day/week/month calendar views

#### Scenario: Soft-deleted session does not appear in patient session history

- **WHEN** a session has `deleted_at` set
- **THEN** it does not appear in the patient's session history listing

### Requirement: Calendar views display status badges with semantic colors

The system SHALL render session status as a Badge on each calendar event using Design System Salvia semantic colors: `scheduled`=neutral, `confirmed`=success, `done`=brand, `cancelled`=danger, `no_show`=warning. Each badge includes a Lucide icon (Clock, CheckCircle2, Check, XCircle, AlertTriangle respectively).

#### Scenario: Confirmed session shows green badge

- **WHEN** a `confirmed` session is rendered in the week view
- **THEN** the event shows a Badge with bg `success-50`, text `success-700`, label "Confirmada", and icon `CheckCircle2`

#### Scenario: No-show session shows yellow/amber badge

- **WHEN** a `no_show` session is rendered in the day view
- **THEN** the event shows a Badge with bg `warning-50`, text `warning-700`, label "Falta", and icon `AlertTriangle`

#### Scenario: Cancelled session is visually de-emphasized

- **WHEN** a `cancelled` session is rendered in the calendar
- **THEN** the event shows a Badge with bg `danger-50`, text `danger-700`, label "Cancelada", and the event card has reduced opacity or muted styling to indicate it is no longer active

### Requirement: Sessions table includes reminders_disabled column

The `sessions` table SHALL be extended with:

- `reminders_disabled BOOLEAN DEFAULT FALSE` — per-session override that suppresses WhatsApp reminder dispatch for this session

This column is consumed by the WhatsApp dispatcher cron: sessions with `reminders_disabled = true` are excluded from reminder scanning.

#### Scenario: Migration adds reminders_disabled column

- **WHEN** the migration for this change runs
- **THEN** the `reminders_disabled` column is added to `sessions` as `BOOLEAN DEFAULT FALSE`

#### Scenario: Default value is false

- **WHEN** a new session is created without specifying reminders_disabled
- **THEN** reminders_disabled defaults to false (reminders are sent normally)

#### Scenario: Existing sessions are unaffected

- **WHEN** the migration runs against a database with existing sessions
- **THEN** all existing sessions have reminders_disabled = false (backfilled by DEFAULT)

### Requirement: Session form includes WhatsApp reminder suppression checkbox

The session create/edit modal SHALL include a `Checkbox` labeled "Nao enviar lembretes WhatsApp para esta sessao" that controls the `reminders_disabled` field. The checkbox is visible only when the selected patient has a phone number and `whatsapp_opt_out` is `false`.

#### Scenario: Checkbox visible for eligible patient

- **WHEN** psychologist creates a session for patient Marina who has a phone and whatsapp_opt_out=false
- **THEN** the checkbox "Nao enviar lembretes WhatsApp para esta sessao" is visible below the notes field

#### Scenario: Checkbox hidden for opted-out patient

- **WHEN** psychologist creates a session for patient Carlos who has whatsapp_opt_out=true
- **THEN** the checkbox is hidden (reminders already globally disabled for this patient)

#### Scenario: Checkbox hidden for patient without phone

- **WHEN** psychologist creates a session for a patient with no phone number
- **THEN** the checkbox is hidden (no phone to send to)

#### Scenario: Checkbox hidden for blocking events

- **WHEN** psychologist creates a blocking event (is_blocking=true)
- **THEN** the checkbox is hidden (blocks have no patient and no reminders)

#### Scenario: Checking the box disables reminders for this session

- **WHEN** psychologist checks "Nao enviar lembretes WhatsApp para esta sessao" and saves
- **THEN** session is created with reminders_disabled=true

#### Scenario: Helper text explains the purpose

- **WHEN** the checkbox is visible
- **THEN** helper text reads "Util quando o paciente avisou que nao pode receber" in body-sm text-tertiary

### Requirement: Online session cards show "Iniciar video" action

Session cards in the agenda for sessions with modality='online' and status IN ('scheduled', 'confirmed') SHALL display an "Iniciar video" button with the Video Lucide icon. Clicking the button SHALL navigate to `/sessao/[sessionId]/video`.

#### Scenario: Online session shows video button

- **WHEN** a session card is rendered for a session with modality='online' and status='scheduled'
- **THEN** an "Iniciar video" button is visible

#### Scenario: In-person session does not show video button

- **WHEN** a session card is rendered for a session with modality='in_person'
- **THEN** no "Iniciar video" button is visible

### Requirement: Session completion captures video metadata

When a session with modality='online' transitions to status='done', the system SHALL compute and store real start time, real end time, effective duration, had_recording, and had_screen_share metadata derived from video_session_logs.

#### Scenario: Online session done triggers metadata capture

- **WHEN** an online session is marked as done via endVideoSession or webhook
- **THEN** a session_summary log entry is created with computed metadata
