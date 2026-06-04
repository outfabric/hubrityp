## ADDED Requirements

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

### Requirement: Psychologist user is refreshed in Stream during token minting
The `getVideoTokenImpl` function SHALL call `streamClient.upsertUsers()` for the psychologist (Supabase UUID + profile name from DB) BEFORE generating the call token. This ensures the psychologist's display name in Stream is current at the moment they open the video page.

#### Scenario: Psychologist is upserted during token minting
- **WHEN** `getVideoTokenImpl` is called for a valid room owned by the psychologist
- **THEN** `streamClient.upsertUsers()` is called with the psychologist's current profile name before `generateCallToken()` is invoked

#### Scenario: Token minting fails if upsert fails
- **WHEN** `streamClient.upsertUsers()` throws during token minting
- **THEN** the action returns `{ ok: false, error: 'unknown' }` and the error is logged

## MODIFIED Requirements

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
