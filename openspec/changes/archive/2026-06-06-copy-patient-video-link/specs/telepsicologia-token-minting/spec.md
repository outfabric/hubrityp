## ADDED Requirements

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

## MODIFIED Requirements

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
