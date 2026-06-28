# telepsicologia-patient-join Specification

## Purpose

Patient-facing video session join flow for telepsychology: public token-gated route for patients to join video calls without authentication, time-gating to prevent early access, waiting room with psychologist info, in-call UI with chat and troubleshooting, disconnection on session end, Route Handlers for token validation and event logging, browser compatibility check, and couple session partner token support.

## Requirements

### Requirement: Patient joins video session via public token-gated URL

The system SHALL provide a public route `/v/[token]` where the patient joins a video session using only the 64-char hex token in the URL. No Supabase session or login SHALL be required. The token is the sole authorization credential.

When the token resolves to a `video_rooms` row with `stream_call_id=NULL` (room reserved but not yet activated on Stream.io), the Route Handler SHALL treat this as `too_early` and return the session start time so the client displays the `TooEarlyView`. This ensures patients visiting the link before the room is activated (up to 1 hour before session start) see a meaningful message instead of an error.

#### Scenario: Patient navigates to valid token URL for an active room

- **WHEN** a patient navigates to `/v/[valid-token]` for a room with `stream_call_id IS NOT NULL` and `status='active'`
- **THEN** the patient sees the in-call view

#### Scenario: Patient navigates to valid token URL for a reserved-but-not-activated room

- **WHEN** a patient navigates to `/v/[valid-token]` for a room with `stream_call_id IS NULL`
- **THEN** the patient sees the `TooEarlyView` with the session start time
- **AND** no error message is displayed

#### Scenario: Patient navigates to invalid token URL

- **WHEN** a patient navigates to `/v/[invalid-token]`
- **THEN** a "Link de sessão inválido" message is displayed

#### Scenario: Patient navigates to expired session token

- **WHEN** a patient navigates to `/v/[token]` for a room with status='ended' or 'expired'
- **THEN** "Esta sessão já foi encerrada. Fale com [Psicólogo] se precisar reagendar." is displayed

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

### Requirement: Patient in-call view includes chat and troubleshooting
The patient's in-call view SHALL include a chat drawer toggle button and a "Problema tecnico?" troubleshooting button, in addition to mic, camera, and leave controls.

#### Scenario: Patient sees psychologist video
- **WHEN** the patient is connected to the call
- **THEN** the psychologist's video fills the main area, the patient's own video is in a PiP, and mic/camera/leave controls are available

#### Scenario: Patient cannot share screen
- **WHEN** the patient views their call controls
- **THEN** no screen share button is present

#### Scenario: Patient accesses chat during call
- **WHEN** the patient clicks the chat toggle
- **THEN** the chat drawer opens, allowing the patient to send and receive messages

#### Scenario: Patient accesses troubleshooting
- **WHEN** the patient clicks "Problema tecnico?"
- **THEN** a popover with troubleshooting steps is displayed

### Requirement: Patient is disconnected when psychologist ends call
When the psychologist ends the session, the patient SHALL be disconnected and shown a "Sessao encerrada" message with the psychologist's name.

#### Scenario: Psychologist ends the call
- **WHEN** the psychologist ends the video session
- **THEN** the patient sees "Sessao encerrada por [Psicologo]" and is disconnected from the call

### Requirement: Route Handler validates patient token and returns call metadata

A POST Route Handler at `/api/video/join` SHALL validate the patient token, query the video room via service-role (justified: patient has no Supabase session), and return the Stream JWT, API key, call ID, psychologist info, and room status. Invalid/expired tokens SHALL return appropriate error codes.

When the room has `stream_call_id=NULL` (reserved but not activated), the Route Handler SHALL return `status: 'too_early'` with the session's `startAt` timestamp resolved from the `sessions` table via `room.sessionId`. The Stream JWT SHALL NOT be returned in this case.

#### Scenario: Valid token for active room returns call metadata

- **WHEN** a POST to `/api/video/join` with a valid patient_token is received and the room is active with `stream_call_id IS NOT NULL`
- **THEN** the response includes streamToken, apiKey, callId, psychologistName, and `status: 'active'`

#### Scenario: Valid token for reserved-but-not-activated room returns too_early

- **WHEN** a POST to `/api/video/join` with a valid patient_token is received and the room has `stream_call_id IS NULL`
- **THEN** the response includes `status: 'too_early'`, `sessionStartAt` (from the sessions table), `psychologistName`, and `psychologistPhotoUrl`
- **AND** no `streamToken`, `apiKey`, or `callId` are returned

#### Scenario: Invalid token returns 404

- **WHEN** a POST with an unrecognized token is received
- **THEN** 404 with `{ error: 'NOT_FOUND' }` is returned

#### Scenario: Ended session returns 410

- **WHEN** a POST with a token for an ended/expired room is received
- **THEN** 410 with `{ error: 'SESSION_ENDED' }` is returned

### Requirement: Patient user is registered in Stream before receiving the Stream JWT
The `/api/video/join` Route Handler SHALL call `streamClient.upsertUsers()` to register the patient (or partner) user in Stream's user database BEFORE returning the Stream JWT in the `status === 'active'` response. The user SHALL be upserted with the synthetic ID matching the JWT's `user_id` claim (`patient-<patientId>` for patients). The patient's display name SHALL be fetched from the `patients` table.

#### Scenario: Patient user is upserted when room is active
- **WHEN** a POST to `/api/video/join` with a valid patient_token is received and the room status is 'active'
- **THEN** `streamClient.upsertUsers()` is called with the patient's synthetic user ID and display name before the response containing the Stream JWT is returned

#### Scenario: Partner user is upserted when room is active
- **WHEN** a POST to `/api/video/join` with a valid partner_token is received and the room status is 'active'
- **THEN** `streamClient.upsertUsers()` is called with the partner's synthetic user ID before the response containing the partner Stream JWT is returned

#### Scenario: No upsert for non-active rooms
- **WHEN** a POST to `/api/video/join` results in status 'waiting', 'too_early', or an error
- **THEN** no `upsertUsers()` call is made (the Stream JWT is not returned in these cases)

#### Scenario: Upsert failure returns 500
- **WHEN** `streamClient.upsertUsers()` throws during the join route
- **THEN** a 500 response with `{ error: 'INTERNAL_ERROR' }` is returned and the error is logged

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

### Requirement: Patient arrival and liveness are recorded on the waiting poll

When `POST /api/video/join` resolves to the `waiting` state (room status `pending`, within the availability window), the handler SHALL, on EVERY poll, advance the liveness heartbeat by setting `video_rooms.patient_last_seen_at = now()` (server clock). On the FIRST waiting poll only (when `patient_waiting_at` is currently NULL) it SHALL also set `patient_waiting_at = now()` and append a single `patient_arrived` entry to `video_session_logs` with the participant role matching the token that resolved (patient or partner). Subsequent waiting polls SHALL keep advancing `patient_last_seen_at`, SHALL NOT re-stamp `patient_waiting_at`, and SHALL NOT insert duplicate `patient_arrived` logs. The recording SHALL use the existing service-role/owner Drizzle client (justified: the patient has no Supabase session; the token is the credential) and SHALL NOT change the route's response shape: the `waiting` response SHALL continue to expose only `status`, `psychologistName`, and `psychologistPhotoUrl`, and SHALL NOT echo any timestamp, internal ID, JWT, or patient PII.

#### Scenario: First waiting poll records arrival and liveness once

- **WHEN** a patient's first `POST /api/video/join` resolves to `status: 'waiting'`
- **THEN** `video_rooms.patient_waiting_at` and `patient_last_seen_at` are both set to the current time and exactly one `video_session_logs` row with `event_type='patient_arrived'` is inserted

#### Scenario: Repeated waiting polls refresh liveness only

- **WHEN** subsequent `POST /api/video/join` polls for the same room resolve to `status: 'waiting'`
- **THEN** `patient_last_seen_at` advances on each poll while `patient_waiting_at` is left unchanged and no additional `patient_arrived` log rows are inserted

#### Scenario: Partner arrival is attributed to the partner role

- **WHEN** the waiting poll resolves via the `partner_token` and is the first arrival
- **THEN** the `patient_arrived` log row records `participant_role='partner'`

#### Scenario: Waiting response exposes no internal data

- **WHEN** the handler returns the `waiting` response
- **THEN** the JSON body contains only `status`, `psychologistName`, and `psychologistPhotoUrl` — no `patient_waiting_at`, `patient_last_seen_at`, room/session/user IDs, tokens, or JWTs

#### Scenario: Non-waiting branches do not record arrival or liveness

- **WHEN** a `POST /api/video/join` resolves to `too_early`, `active`, or an ended/expired (410) state
- **THEN** neither `patient_waiting_at` nor `patient_last_seen_at` is modified and no `patient_arrived` log is inserted

### Requirement: Patient departure clears liveness via a token-gated beacon

The waiting-room client SHALL signal patient departure by calling `navigator.sendBeacon` on the page `pagehide` event, targeting a public-but-token-gated `POST /api/video/depart` route with a body carrying only the 64-char hex token (the credential; `sendBeacon` cannot send custom auth headers). The `depart` route SHALL validate the token with Zod, be rate-limited per IP before any database work, and — for a room currently in `pending` (the waiting-equivalent state) with a non-null heartbeat — clear `video_rooms.patient_last_seen_at` back to NULL so the presence broadcast lapses immediately. The route SHALL NOT clear `patient_waiting_at` (the immutable first-arrival audit marker), SHALL be idempotent (duplicate beacons update zero rows), SHALL NOT clear liveness for a room already `active`, and SHALL expose no internal IDs, tokens, JWTs, or PII in its response. A patient who departs and reopens the link SHALL re-establish presence via the next waiting poll (which re-stamps `patient_last_seen_at`) without re-logging `patient_arrived`.

#### Scenario: Waiting-room view emits a departure beacon on page hide

- **WHEN** the patient's waiting-room page is hidden/unloaded (`pagehide`)
- **THEN** the client sends a `navigator.sendBeacon` POST to `/api/video/depart` whose body carries the patient (or partner) token

#### Scenario: Valid departure clears liveness but preserves the audit marker

- **WHEN** a valid `POST /api/video/depart` is received for a `pending` room whose `patient_last_seen_at` is set
- **THEN** `patient_last_seen_at` is set to NULL and `patient_waiting_at` is left unchanged

#### Scenario: Departure is idempotent

- **WHEN** a second `POST /api/video/depart` is received for a room whose `patient_last_seen_at` is already NULL
- **THEN** zero rows are updated and no redundant presence broadcast is emitted

#### Scenario: Departure does not disturb an already-admitted room

- **WHEN** a `POST /api/video/depart` arrives for a room whose status is already `active`
- **THEN** `patient_last_seen_at` is not cleared and the active call is unaffected

#### Scenario: Re-arrival after departure re-establishes presence

- **WHEN** a patient who departed (heartbeat cleared) reopens the link and polls `POST /api/video/join` within the window
- **THEN** `patient_last_seen_at` is re-stamped to the current time, no additional `patient_arrived` log is inserted, and a fresh heartbeat is broadcast

#### Scenario: Invalid token is rejected and departure response leaks nothing

- **WHEN** a `POST /api/video/depart` is received with an unrecognized or malformed token
- **THEN** the request is rejected (no row updated) and the response body exposes no internal IDs, tokens, JWTs, or PII

#### Scenario: Departure endpoint is rate-limited

- **WHEN** a client exceeds the per-IP request limit on `/api/video/depart`
- **THEN** further requests are rejected with a rate-limit response before any database work
