## Requirements

### Requirement: Server-side Stream client uses env-validated credentials
The system SHALL initialize the Stream Node.js SDK client using `STREAM_API_KEY` and `STREAM_API_SECRET` from `serverEnv`. These credentials SHALL NOT be exposed to the client bundle. The client SHALL be a lazy singleton.

#### Scenario: Stream client initialization
- **WHEN** `getStreamClient()` is called for the first time
- **THEN** a `StreamClient` instance is created with credentials from `serverEnv`

#### Scenario: Singleton behavior
- **WHEN** `getStreamClient()` is called multiple times
- **THEN** the same instance is returned each time

### Requirement: Stream users are registered via upsertUsers before call creation
The `createVideoRoomHelper` function SHALL call `streamClient.upsertUsers()` to register both the psychologist and the patient in Stream's user database BEFORE calling `call.getOrCreate()`. The psychologist SHALL be upserted with their Supabase UUID as `id` and their `profiles.fullName` as `name`. The patient SHALL be upserted with `patient-<patientId>` as `id` and their `patients.fullName` as `name`. If no patient is linked to the session, only the psychologist SHALL be upserted.

#### Scenario: Psychologist and patient are upserted during room creation
- **WHEN** `createVideoRoomHelper` is called for a session with a linked patient
- **THEN** `streamClient.upsertUsers()` is called with both the psychologist (id=userId, name=psychologistName) and the patient (id=`patient-<patientId>`, name=patientFullName) before `call.getOrCreate()` is invoked

#### Scenario: Only psychologist is upserted when no patient is linked
- **WHEN** `createVideoRoomHelper` is called for a session with `patientId = null`
- **THEN** `streamClient.upsertUsers()` is called with only the psychologist user

#### Scenario: Upsert is idempotent on repeated room creation attempts
- **WHEN** `createVideoRoomHelper` is called for a session that already has a room (idempotent path)
- **THEN** no `upsertUsers` call is made (the existing room is returned directly)

### Requirement: createVideoRoom creates a Stream call and persists the video room
The `createVideoRoom` Server Action SHALL authenticate the user, validate the session is online and scheduled/confirmed, create a Stream call via `getOrCreate()`, generate a 64-char hex patient token and a call-scoped patient JWT, compute the availability window, and INSERT the video room row. The action SHALL be idempotent — if a room already exists for the session, it SHALL return the existing room. The `createVideoRoomHelper` function SHALL accept the psychologist's display name and the patient's display name as part of its input, and SHALL register both users in Stream via `upsertUsers()` before creating the call.

#### Scenario: Successful room creation for online session
- **WHEN** an authenticated psychologist calls createVideoRoom for an online session with status='scheduled'
- **THEN** users are registered in Stream via upsertUsers, a Stream call is created, a video_rooms row is inserted with patient_token, patient_jwt, available_from, and expires_at, and the room is returned

#### Scenario: Session not owned by the user
- **WHEN** a psychologist calls createVideoRoom for a session they do not own
- **THEN** the action returns an error without creating a room

#### Scenario: Session is not online
- **WHEN** createVideoRoom is called for a session with modality='in_person'
- **THEN** the action returns an error

#### Scenario: Room already exists for the session
- **WHEN** createVideoRoom is called for a session that already has a video room
- **THEN** the existing room is returned without creating a duplicate or calling upsertUsers

### Requirement: getVideoToken mints a call-scoped JWT for the psychologist
The `getVideoToken` Server Action SHALL authenticate the user, verify room ownership, and generate a call-scoped JWT via `client.generateCallToken()` with admin role and 2-hour validity. The token SHALL be scoped to the specific call ID.

#### Scenario: Successful token minting
- **WHEN** an authenticated psychologist calls getVideoToken for their own room
- **THEN** a JWT scoped to the room's Stream call ID with admin role is returned

#### Scenario: Room not owned by user
- **WHEN** getVideoToken is called for a room the user does not own
- **THEN** the action returns an error

#### Scenario: Room is expired
- **WHEN** getVideoToken is called for a room with status='expired'
- **THEN** the action returns an error

### Requirement: Psychologist user is refreshed in Stream during token minting
The `getVideoTokenImpl` function SHALL call `streamClient.upsertUsers()` for the psychologist (Supabase UUID + profile name from DB) BEFORE generating the call token. This ensures the psychologist's display name in Stream is current at the moment they open the video page.

#### Scenario: Psychologist is upserted during token minting
- **WHEN** `getVideoTokenImpl` is called for a valid room owned by the psychologist
- **THEN** `streamClient.upsertUsers()` is called with the psychologist's current profile name before `generateCallToken()` is invoked

#### Scenario: Token minting fails if upsert fails
- **WHEN** `streamClient.upsertUsers()` throws during token minting
- **THEN** the action returns `{ ok: false, error: 'unknown' }` and the error is logged

### Requirement: Patient tokens are call-scoped with time-limited validity
Patient JWTs generated during room creation SHALL be scoped to the specific Stream call via `call_cids`, use a synthetic user ID (`patient-<patientId>`), and have a validity window matching the room's available_from to expires_at period.

#### Scenario: Patient JWT is scoped to the call
- **WHEN** a patient JWT is generated
- **THEN** its `call_cids` field contains only the room's Stream call ID, and its expiry does not exceed the room's `expires_at`

### Requirement: Env vars for Stream are validated at boot
`STREAM_API_KEY`, `STREAM_API_SECRET` SHALL be required in `serverEnvSchema`. `NEXT_PUBLIC_STREAM_API_KEY` SHALL be required in `clientEnvSchema`. Missing values SHALL cause a boot-time validation error.

#### Scenario: Missing STREAM_API_KEY causes validation error
- **WHEN** the server starts without `STREAM_API_KEY` set
- **THEN** the Zod env validation fails with a descriptive error
