## ADDED Requirements

### Requirement: Psychologist can cancel a session with structured reason

The system SHALL present a cancellation dialog requiring: reason (select from predefined options), who cancelled (patient or therapist), and a charge flag (apply cancellation fee). The cancellation notice period is auto-calculated based on session start time and current time. All fields are persisted in the session record.

#### Scenario: Cancel with all fields populated

- **WHEN** psychologist clicks "Cancelar sessao" on a `scheduled` session, selects reason "Paciente cancelou", selects "Paciente" as who cancelled, sees notice "less_24h" (session is in 5 hours), and enables "Aplicar cobranca"
- **THEN** session status becomes `cancelled`, `cancellation_reason='patient_cancelled'`, `cancelled_by='patient'`, `cancellation_notice='less_24h'`, `cancelled_at=NOW()`, `charge_cancellation=true`

#### Scenario: Cancel with 30 hours notice

- **WHEN** psychologist cancels a session that starts in 30 hours
- **THEN** `cancellation_notice` is set to `'24h+'`

#### Scenario: Cancel with 5 hours notice

- **WHEN** psychologist cancels a session that starts in 5 hours
- **THEN** `cancellation_notice` is set to `'less_24h'`

#### Scenario: Cancel with 30 minutes notice

- **WHEN** psychologist cancels a session that starts in 30 minutes
- **THEN** `cancellation_notice` is set to `'less_1h'`

#### Scenario: Cancel after session start time

- **WHEN** psychologist cancels a session whose start time has already passed
- **THEN** `cancellation_notice` is set to `'on_time'`

#### Scenario: Cancellation reason options

- **WHEN** psychologist opens the cancellation dialog
- **THEN** the reason select shows options: "Paciente cancelou", "Psicologo cancelou", "Imprevisto", "Outro"

#### Scenario: Cancellation preserves session record (RN-03.05)

- **WHEN** a session is cancelled
- **THEN** the session record is preserved with all original data plus cancellation fields; no row is deleted

### Requirement: Psychologist can reschedule a session (cancel + new)

The system SHALL implement reschedule as a cancellation of the current session followed by immediate creation of a new session. The two sessions are linked bidirectionally via `rescheduled_to_session_id` and `rescheduled_from_session_id`.

#### Scenario: Reschedule creates linked sessions

- **WHEN** psychologist clicks "Remarcar" on a session, completes the cancellation form, and then creates a new session in the pre-filled creation modal
- **THEN** the old session has `status='cancelled'` and `rescheduled_to_session_id` pointing to the new session, and the new session has `rescheduled_from_session_id` pointing to the old session

#### Scenario: Reschedule pre-fills new session form

- **WHEN** psychologist completes the cancellation step of a reschedule
- **THEN** the session creation modal opens pre-filled with the same patient, location, duration, amount, and modality from the cancelled session

#### Scenario: Reschedule history shows link

- **WHEN** psychologist views the history of a rescheduled session
- **THEN** history shows "Remarcada em [date]" with a link to the replacement session

#### Scenario: Reschedule emits event

- **WHEN** a reschedule is completed (both cancel and new session saved)
- **THEN** system emits `agenda/session.rescheduled` event with `{ oldSessionId, newSessionId, patientId, userId, rescheduledAt }`

### Requirement: No-show is distinct from cancellation (RN-03.07)

The system SHALL treat `no_show` as a separate status from `cancelled`. No-shows are counted separately in statistics and allow the psychologist to charge a no-show fee (via link to PRD 06).

#### Scenario: Mark as no-show

- **WHEN** psychologist clicks "Marcar como falta" on a `scheduled` or `confirmed` session
- **THEN** session status becomes `no_show` and an `agenda/session.no_show` event is emitted

#### Scenario: No-show does not populate cancellation fields

- **WHEN** a session is marked as no-show
- **THEN** `cancellation_reason`, `cancelled_by`, `cancellation_notice`, `cancelled_at` remain NULL — no-show is not a cancellation

#### Scenario: No-show appears separately in statistics

- **WHEN** psychologist views session statistics (future feature)
- **THEN** no-shows are counted separately from cancellations (distinct buckets)

### Requirement: Psychologist can reactivate a cancelled session

The system SHALL allow reactivating a `cancelled` session back to `scheduled` status. Reactivation clears all cancellation fields and creates a history entry.

#### Scenario: Reactivate cancelled session

- **WHEN** psychologist clicks "Reativar" on a `cancelled` session
- **THEN** status returns to `scheduled`, all cancellation fields (`cancellation_reason`, `cancelled_by`, `cancellation_notice`, `cancelled_at`, `charge_cancellation`) are set to NULL, and a history entry records the reactivation

#### Scenario: Reactivation of a rescheduled session clears reschedule link

- **WHEN** psychologist reactivates a session that was cancelled as part of a reschedule
- **THEN** `rescheduled_to_session_id` is set to NULL, and the replacement session's `rescheduled_from_session_id` is also set to NULL

### Requirement: Soft-delete for sessions that were never meaningfully used

The system SHALL allow soft-deletion (setting `deleted_at` timestamp) ONLY for sessions that have `status='cancelled'` AND have never been in `done` or `no_show` status AND have no linked clinical note or payment. Soft-deleted sessions are filtered from all queries but preserved in the database.

#### Scenario: Soft-delete a cancelled session with no history beyond creation

- **WHEN** psychologist clicks "Excluir definitivamente" on a session that was created and then cancelled without any other status changes
- **THEN** session's `deleted_at` is set to current timestamp and it no longer appears in agenda views or listings

#### Scenario: Soft-delete rejected for session that was previously done

- **WHEN** psychologist attempts to soft-delete a cancelled session that was previously marked as `done` (visible in session_history)
- **THEN** system rejects with error "Esta sessao possui historico e nao pode ser excluida"

#### Scenario: Soft-delete requires destructive confirmation

- **WHEN** psychologist clicks "Excluir definitivamente"
- **THEN** system shows an `AlertDialog` confirmation with input requiring the user to type "EXCLUIR" to confirm
