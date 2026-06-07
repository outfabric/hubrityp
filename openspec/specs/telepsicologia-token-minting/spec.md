# telepsicologia-token-minting Specification

## Purpose

Server-side Stream.io integration for telepsychology: env-validated Stream client, user registration via `upsertUsers`, eager room reservation (`reserveVideoRoom`) and deferred activation (`createVideoRoomHelper`), and call-scoped JWT minting for both psychologists and patients, with shared room time-window constants to keep reservation and activation aligned.

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
The `createVideoRoomHelper` function SHALL support two modes:

1. **Activation mode** (reserved row exists with `stream_call_id=NULL`): the function SHALL UPDATE the existing row with `stream_call_id`, `patient_jwt`, and partner fields. It SHALL use the existing `patient_token` from the row (not generate a new one). It SHALL register Stream users via `upsertUsers()` and create the Stream call via `getOrCreate()` before updating.

2. **Full creation mode** (no row exists — backward compatibility): the function SHALL generate a new `patient_token`, create the Stream call, mint the patient JWT, and INSERT the row (existing behavior, unchanged).

The function SHALL remain idempotent: if a room with `stream_call_id IS NOT NULL` already exists, it SHALL return it without changes.

#### Scenario: Activation of a reserved room

- **WHEN** `createVideoRoomHelper` is called for a session that has a `video_rooms` row with `stream_call_id=NULL`
- **THEN** users are registered in Stream via `upsertUsers`, a Stream call is created via `getOrCreate`, a patient JWT is minted, and the existing row is UPDATEd with `stream_call_id`, `patient_jwt`, and partner fields
- **AND** the `patient_token`, `available_from`, and `expires_at` remain unchanged

#### Scenario: Full creation when no reserved row exists

- **WHEN** `createVideoRoomHelper` is called for a session with no existing `video_rooms` row
- **THEN** a new `patient_token` is generated, users are registered in Stream, a Stream call is created, a patient JWT is minted, and a new row is INSERTed (existing behavior)

#### Scenario: Fully activated room is returned without changes

- **WHEN** `createVideoRoomHelper` is called for a session that has a `video_rooms` row with `stream_call_id IS NOT NULL`
- **THEN** the existing room is returned without creating a duplicate, calling `upsertUsers`, or creating a Stream call

#### Scenario: Session not owned by the user

- **WHEN** a psychologist calls createVideoRoom for a session they do not own
- **THEN** the action returns an error without creating or activating a room

#### Scenario: Session is not online

- **WHEN** createVideoRoom is called for a session with modality='in_person'
- **THEN** the action returns an error

### Requirement: reserveVideoRoom creates a partial video room row at scheduling time

A new server function `reserveVideoRoom` SHALL create a partial `video_rooms` row when an online session is scheduled. The function SHALL generate a 64-char hex `patient_token` via `crypto.randomBytes(32)`, compute `available_from` (startAt − 10 minutes) and `expires_at` (endAt + 1 hour) using the same constants as `createVideoRoomHelper`, and INSERT the row with `stream_call_id=NULL`, `patient_jwt=NULL`, and `status='pending'`.

The function SHALL be idempotent: if a `video_rooms` row already exists for the session, it SHALL return the existing row's `patient_token` without inserting a duplicate. It SHALL handle unique constraint violations (23505) by re-fetching the existing row.

The function SHALL NOT interact with Stream.io (no SDK dependency). It SHALL use the Drizzle db client directly and carry `import 'server-only'`.

#### Scenario: Reserve room for new online session

- **WHEN** `reserveVideoRoom` is called for a session with no existing `video_rooms` row
- **THEN** a row is inserted with `patient_token` (64-char hex), `stream_call_id=NULL`, `patient_jwt=NULL`, `available_from = startAt - 10min`, `expires_at = endAt + 1h`, `status='pending'`
- **AND** the function returns `{ ok: true, patientToken: <token> }`

#### Scenario: Room already exists (idempotent)

- **WHEN** `reserveVideoRoom` is called for a session that already has a `video_rooms` row
- **THEN** the existing row's `patient_token` is returned without inserting a duplicate

#### Scenario: Concurrent reservation handled via unique constraint

- **WHEN** two concurrent calls to `reserveVideoRoom` race on the same session
- **THEN** one INSERT succeeds and the other catches the 23505 unique violation, re-fetches, and returns the existing token

### Requirement: Room time-window constants are shared between reservation and activation

The constants `ROOM_AVAILABLE_BEFORE_MINUTES` (10) and `ROOM_EXPIRES_AFTER_HOURS` (1) SHALL be defined in a shared module (`src/modules/telepsicologia/lib/room-constants.ts`) and imported by both `reserveVideoRoom` and `createVideoRoomHelper`. This prevents drift between reservation and activation time windows.

#### Scenario: Reservation and activation use identical time windows

- **WHEN** a room is reserved at scheduling time and later activated by Inngest
- **THEN** both operations compute `available_from` and `expires_at` using the same constant values

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
