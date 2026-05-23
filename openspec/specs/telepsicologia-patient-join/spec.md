# telepsicologia-patient-join Specification

## Purpose

Patient-facing video session join flow for telepsychology: public token-gated route for patients to join video calls without authentication, time-gating to prevent early access, waiting room with psychologist info, minimal in-call UI, disconnection on session end, Route Handlers for token validation and event logging, browser compatibility check, and couple session partner token support.

## Requirements

### Requirement: Patient joins video session via public token-gated URL
The system SHALL provide a public route `/v/[token]` where the patient joins a video session using only the 64-char hex token in the URL. No Supabase session or login SHALL be required. The token is the sole authorization credential.

#### Scenario: Patient navigates to valid token URL
- **WHEN** a patient navigates to `/v/[valid-token]` for an active room
- **THEN** the patient sees the waiting room or in-call view depending on room status

#### Scenario: Patient navigates to invalid token URL
- **WHEN** a patient navigates to `/v/[invalid-token]`
- **THEN** a "Link de sessao invalido" message is displayed

#### Scenario: Patient navigates to expired session token
- **WHEN** a patient navigates to `/v/[token]` for a room with status='ended' or 'expired'
- **THEN** "Esta sessao ja foi encerrada. Fale com [Psicologo] se precisar reagendar." is displayed

### Requirement: Time-gating prevents early access
The patient join page SHALL check the room's `available_from` timestamp. If the current time is before `available_from`, the page SHALL show "Sua sessao e as [hora]. Volte 10 minutos antes." with an optional device test.

#### Scenario: Patient arrives too early
- **WHEN** a patient navigates to `/v/[token]` more than 10 minutes before session start
- **THEN** a "Volte 10 minutos antes" message is shown with the session time

#### Scenario: Patient arrives within 10-minute window
- **WHEN** a patient navigates to `/v/[token]` within 10 minutes of session start
- **THEN** the waiting room is displayed

### Requirement: Waiting room shows psychologist info and awaiting message
When the patient is in the waiting room (room status='pending'), the page SHALL display the psychologist's name and photo, and the message "Aguarde, [Psicologo] vai admitir voce em breve". The page SHALL poll for status changes every 10 seconds.

#### Scenario: Patient sees waiting room
- **WHEN** a patient enters during the availability window and the room is pending
- **THEN** the psychologist's name, photo, and "Aguarde" message are displayed

#### Scenario: Psychologist admits patient
- **WHEN** the room status changes from 'pending' to 'active' while the patient is waiting
- **THEN** the patient transitions to the in-call view

### Requirement: Patient in-call UI is clean and minimal
During an active call, the patient SHALL see the psychologist's video as the main view, their own video as a small PiP, and controls for mic, camera, and "Sair" (leave). The patient SHALL NOT have screen sharing capability.

#### Scenario: Patient sees psychologist video
- **WHEN** the patient is connected to the call
- **THEN** the psychologist's video fills the main area, the patient's own video is in a PiP, and mic/camera/leave controls are available

#### Scenario: Patient cannot share screen
- **WHEN** the patient views their call controls
- **THEN** no screen share button is present

### Requirement: Patient is disconnected when psychologist ends call
When the psychologist ends the session, the patient SHALL be disconnected and shown a "Sessao encerrada" message with the psychologist's name.

#### Scenario: Psychologist ends the call
- **WHEN** the psychologist ends the video session
- **THEN** the patient sees "Sessao encerrada por [Psicologo]" and is disconnected from the call

### Requirement: Route Handler validates patient token and returns call metadata
A POST Route Handler at `/api/video/join` SHALL validate the patient token, query the video room via service-role (justified: patient has no Supabase session), and return the Stream JWT, API key, call ID, psychologist info, and room status. Invalid/expired tokens SHALL return appropriate error codes.

#### Scenario: Valid token returns call metadata
- **WHEN** a POST to `/api/video/join` with a valid patient_token is received
- **THEN** the response includes streamToken, apiKey, callId, psychologistName, and status

#### Scenario: Invalid token returns 404
- **WHEN** a POST with an unrecognized token is received
- **THEN** 404 with `{ error: 'NOT_FOUND' }` is returned

#### Scenario: Ended session returns 410
- **WHEN** a POST with a token for an ended/expired room is received
- **THEN** 410 with `{ error: 'SESSION_ENDED' }` is returned

### Requirement: Patient events are logged via service-role Route Handler
A POST Route Handler at `/api/video/log` SHALL accept patient event logs (patient_joined, patient_left, connection_drop, reconnected) with the patient token as authorization. The handler SHALL use service-role to insert into `video_session_logs`.

#### Scenario: Patient join event is logged
- **WHEN** a POST to `/api/video/log` with a valid token and event_type='patient_joined' is received
- **THEN** a row is inserted in video_session_logs with the correct session_id and event_type

#### Scenario: Invalid token is rejected
- **WHEN** a POST with an invalid token is received
- **THEN** 404 is returned and no log is inserted

### Requirement: Browser compatibility is checked before rendering video
The patient page SHALL check for WebRTC and MediaDevices API support before loading the Stream SDK. If the browser is unsupported, a message SHALL direct the patient to use Chrome, Edge, Firefox, or Safari.

#### Scenario: Unsupported browser
- **WHEN** the patient opens `/v/[token]` in a browser without WebRTC support
- **THEN** a "Seu navegador nao e compativel" message is shown with download links

### Requirement: Couple sessions support partner token
For couple sessions, a second patient (partner) SHALL join using the `partner_token` at `/v/[partnerToken]`. The Route Handler SHALL check both `patient_token` and `partner_token` columns.

#### Scenario: Partner joins via partner token
- **WHEN** a partner navigates to `/v/[partner-token]`
- **THEN** the partner joins the same call using the partner_jwt
