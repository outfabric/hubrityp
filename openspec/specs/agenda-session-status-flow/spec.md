# agenda-session-status-flow Specification

## Purpose

Session status state machine, status-dependent UI actions, done-session locking, status history tracking, Inngest notification events on transitions, and missing clinical note reminders.

## Requirements

### Requirement: Session status follows a defined state machine

The system SHALL enforce a session status state machine where the `status` column only accepts values `scheduled`, `confirmed`, `done`, `cancelled`, and `no_show`. Transitions between statuses are validated server-side via a pure function before any mutation. Invalid transitions are rejected with a typed error.

#### Scenario: Valid transition from scheduled to confirmed

- **WHEN** psychologist or patient confirms a session with status `scheduled`
- **THEN** status changes to `confirmed` and `confirmed_at` is set to current timestamp

#### Scenario: Valid transition from scheduled to done

- **WHEN** psychologist marks a `scheduled` session as done
- **THEN** status changes to `done` and a history entry is created

#### Scenario: Valid transition from confirmed to cancelled

- **WHEN** psychologist cancels a `confirmed` session with valid cancellation fields
- **THEN** status changes to `cancelled`, cancellation fields are populated, and a history entry is created

#### Scenario: Valid transition from cancelled to scheduled (reactivate)

- **WHEN** psychologist reactivates a `cancelled` session
- **THEN** status changes back to `scheduled`, cancellation fields are cleared, and a history entry records the reactivation

#### Scenario: Invalid transition from done to scheduled

- **WHEN** someone attempts to change a `done` session back to `scheduled`
- **THEN** system rejects with error code `INVALID_STATUS_TRANSITION`

#### Scenario: Invalid transition from no_show to confirmed

- **WHEN** someone attempts to change a `no_show` session to `confirmed`
- **THEN** system rejects with error code `INVALID_STATUS_TRANSITION`

#### Scenario: Database CHECK constraint enforces valid status values

- **WHEN** a direct SQL update attempts to set status to an invalid value like `pending`
- **THEN** Postgres rejects the operation due to the CHECK constraint

### Requirement: Session detail modal shows status-dependent actions

The system SHALL render different action buttons in the session detail modal based on the current session status. Each status has a defined set of available actions.

#### Scenario: Scheduled session shows all initial actions

- **WHEN** psychologist opens detail modal for a `scheduled` session
- **THEN** modal shows buttons: "Confirmar presenca" (primary), "Remarcar" (secondary), "Cancelar sessao" (danger), "Marcar como realizada" (primary), "Marcar como falta" (secondary)

#### Scenario: Confirmed session shows reduced actions

- **WHEN** psychologist opens detail modal for a `confirmed` session
- **THEN** modal shows buttons: "Remarcar" (secondary), "Cancelar sessao" (danger), "Marcar como realizada" (primary), "Marcar como falta" (secondary)

#### Scenario: Done session shows only links

- **WHEN** psychologist opens detail modal for a `done` session within 7 days
- **THEN** modal shows only link buttons: "Ver prontuario desta sessao" and "Adicionar pagamento"

#### Scenario: Cancelled session shows reactivation option

- **WHEN** psychologist opens detail modal for a `cancelled` session
- **THEN** modal shows buttons: "Reativar" (secondary) and "Excluir definitivamente" (danger)

#### Scenario: No-show session shows charge link

- **WHEN** psychologist opens detail modal for a `no_show` session
- **THEN** modal shows only "Cobrar falta" link button

### Requirement: Done sessions are locked after 7 days (RN-03.04)

The system SHALL prevent editing of sessions with status `done` after 7 calendar days have elapsed since the status was set. The lock is enforced both server-side (Server Action rejects) and client-side (buttons disabled with lock indicator).

#### Scenario: Edit attempt on done session within 7 days succeeds

- **WHEN** psychologist attempts to edit a session marked `done` 3 days ago
- **THEN** system allows the edit

#### Scenario: Edit attempt on done session after 7 days is rejected

- **WHEN** psychologist attempts to edit a session marked `done` 8 days ago
- **THEN** Server Action rejects with error `{ code: 'SESSION_LOCKED', message: 'Sessao realizada ha mais de 7 dias nao pode ser editada' }` and UI shows lock indicator with `Lock` icon and info alert

#### Scenario: Lock uses UTC for consistent calculation

- **WHEN** psychologist is in a different timezone than the session was created in
- **THEN** the 7-day lock calculation uses `TIMESTAMPTZ` (UTC-based) comparison, unaffected by timezone differences

### Requirement: Status transitions create session history entries

The system SHALL append a row to the `session_history` table for every status transition, recording who performed the action, the from/to statuses, and relevant metadata (cancellation details, reschedule links).

#### Scenario: Cancellation creates history entry with metadata

- **WHEN** psychologist cancels a session with reason "Paciente cancelou" and notice "less_24h"
- **THEN** a `session_history` row is created with `action='status_changed'`, `from_status='confirmed'`, `to_status='cancelled'`, `performed_by='therapist'`, and `metadata` containing reason, notice, and charge flag

#### Scenario: Patient confirmation via public link creates history entry

- **WHEN** patient confirms a session via the public confirmation page
- **THEN** a `session_history` row is created with `action='status_changed'`, `from_status='scheduled'`, `to_status='confirmed'`, `performed_by='patient'`, and `user_id=NULL` (no authenticated user)

#### Scenario: History entries are displayed in session detail modal

- **WHEN** psychologist opens the session detail modal
- **THEN** the history section shows a chronological list of events like "Criada em 10/05/2026", "Confirmada pelo paciente em 11/05/2026", "Cancelada pelo psicologo em 12/05/2026"

### Requirement: Notification events are emitted via Inngest on status transitions

The system SHALL emit typed Inngest events when session status changes. Events include `agenda/session.confirmed`, `agenda/session.cancelled`, `agenda/session.done`, `agenda/session.no_show`, and `agenda/session.rescheduled`. Event payloads are validated with Zod schemas exported from the agenda module.

#### Scenario: Confirmation emits event with confirmedBy field

- **WHEN** patient confirms a session via the public link
- **THEN** system emits `agenda/session.confirmed` event with payload `{ sessionId, patientId, userId, confirmedAt, confirmedBy: 'patient' }`

#### Scenario: Cancellation emits event with full cancellation details

- **WHEN** psychologist cancels a session
- **THEN** system emits `agenda/session.cancelled` event with payload including `cancelledBy`, `reason`, `notice`, and `chargeApplied`

#### Scenario: Event payloads match exported Zod schemas

- **WHEN** an Inngest event is emitted
- **THEN** the payload passes validation against the corresponding Zod schema exported from `src/modules/agenda/lib/session-events.ts`

### Requirement: Missing clinical note reminder triggers after 7 days (RN-03.06)

The system SHALL provide an Inngest scheduled function (cron) that queries sessions with `status='done'` and `updated_at` older than 7 days that have no linked clinical note. For each match, it emits an `agenda/session.missing_note_reminder` event. Initially, the clinical note check is stubbed (always triggers) since the evolutions table (PRD 05) does not yet exist.

#### Scenario: Cron identifies session without clinical note after 7 days

- **WHEN** the daily cron runs and finds a session marked `done` 8 days ago with no clinical note
- **THEN** system emits `agenda/session.missing_note_reminder` event with `{ sessionId, patientId, userId, doneAt, daysSinceDone: 8 }`

#### Scenario: Session with clinical note is not flagged

- **WHEN** the daily cron runs and a session marked `done` 10 days ago has a linked clinical note
- **THEN** no reminder event is emitted for that session (once evolutions table exists)
