## MODIFIED Requirements

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
