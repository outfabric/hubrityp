## MODIFIED Requirements

### Requirement: Psychologist can create a single session

The system SHALL allow the psychologist to create a session with: patient (required), date, start time, duration (default from agenda_settings), auto-calculated end time, location (default from is_default location), modality (in_person/online), value (optional), notes (optional), and color (optional). The session status defaults to `scheduled`.

When the session modality is `online`, the system SHALL eagerly reserve a video room (via `reserveVideoRoom`) immediately after inserting the session row. If `APP_URL` is configured, the `CreateSessionResult` SHALL include `patientVideoUrl` with the patient's video join URL. If `APP_URL` is not configured or the reservation fails, `patientVideoUrl` SHALL be omitted (graceful degradation — session creation still succeeds).

The video room reservation SHALL NOT block or fail the session creation: if `reserveVideoRoom` fails, the error SHALL be logged and session creation SHALL succeed without `patientVideoUrl` (the Inngest deferred-creation flow serves as fallback).

#### Scenario: Create online session reserves video room and returns patient URL

- **WHEN** psychologist creates a session with `modality='online'` and `APP_URL` is configured
- **THEN** the session is created with status "scheduled"
- **AND** a `video_rooms` row is inserted with `patient_token`, `stream_call_id=NULL`, `patient_jwt=NULL`
- **AND** the result includes `patientVideoUrl` set to `{APP_URL}/v/{patient_token}`

#### Scenario: Create online session without APP_URL

- **WHEN** psychologist creates a session with `modality='online'` and `APP_URL` is not configured
- **THEN** the session is created with status "scheduled"
- **AND** a `video_rooms` row is inserted with `patient_token`
- **AND** the result does not include `patientVideoUrl`

#### Scenario: Create in-person session does not reserve video room

- **WHEN** psychologist creates a session with `modality='in_person'`
- **THEN** the session is created with status "scheduled"
- **AND** no `video_rooms` row is created
- **AND** the result does not include `patientVideoUrl`

#### Scenario: Video room reservation failure does not block session creation

- **WHEN** psychologist creates a session with `modality='online'` and `reserveVideoRoom` fails
- **THEN** the session is created successfully
- **AND** the error is logged
- **AND** the result does not include `patientVideoUrl`

#### Scenario: Create session with all fields

- **WHEN** psychologist fills all fields (patient "Marina Silva", date 2026-05-15, start 14:00, duration 50min, location "Consultorio Vila Mariana", modality "in_person", value 200.00) and clicks "Salvar"
- **THEN** system creates the session with status "scheduled", end_at auto-calculated to 14:50, and it appears in the calendar

#### Scenario: Create session with defaults only

- **WHEN** psychologist selects only patient and date/time (other fields use defaults)
- **THEN** system creates the session with default duration from agenda_settings, default location, no value, no notes

#### Scenario: End time is auto-calculated from start + duration

- **WHEN** psychologist sets start_at to 14:00 and duration to 50 minutes
- **THEN** end_at is calculated as 14:50 and displayed read-only

### Requirement: Online session cards show "Iniciar video" action

Session cards in the agenda for sessions with modality='online' and status IN ('scheduled', 'confirmed') SHALL display an "Iniciar video" button with the Video Lucide icon. Clicking the button SHALL navigate to `/sessao/[sessionId]/video`.

#### Scenario: Online session shows video button

- **WHEN** a session card is rendered for a session with modality='online' and status='scheduled'
- **THEN** an "Iniciar video" button is visible

#### Scenario: In-person session does not show video button

- **WHEN** a session card is rendered for a session with modality='in_person'
- **THEN** no "Iniciar video" button is visible
