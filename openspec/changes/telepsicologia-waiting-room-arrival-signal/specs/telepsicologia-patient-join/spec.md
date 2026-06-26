## ADDED Requirements

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
