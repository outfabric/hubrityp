## MODIFIED Requirements

### Requirement: Video rooms are created ~1 hour before session start, not immediately

The Inngest function `telepsicologia-auto-create-video-room` SHALL defer room creation until approximately 1 hour before the session's `startAt` time. When an `agenda/session.created` event fires for an online session in a schedulable status, the function SHALL use `step.sleepUntil(startAt - 1h)` to pause execution, then proceed with room creation via `createVideoRoomHelper`.

#### Scenario: Standard session scheduled 3 days ahead

- **WHEN** a session is created with `modality='online'`, `status='scheduled'`, and `startAt` 3 days from now
- **THEN** the Inngest function starts, validates guards (online + schedulable), and sleeps until `startAt - 1h`
- **AND** wakes up ~1 hour before the session and creates the video room

#### Scenario: Session scheduled less than 1 hour ahead

- **WHEN** a session is created with `modality='online'` and `startAt` is 30 minutes from now
- **THEN** the function detects that `startAt - 1h` is already in the past
- **AND** creates the room immediately (no sleep)

#### Scenario: Recurring session triggers deferred creation

- **WHEN** a recurring session occurrence is created via `createSessionImpl` with `modality='online'`
- **THEN** the `agenda/session.created` event fires and the same deferred creation logic applies
- **AND** no special handling is needed for recurring sessions

#### Scenario: Couple session triggers deferred creation

- **WHEN** a couple session is created with `modality='online'` and `patient_ids` array populated
- **THEN** the `agenda/session.created` event fires, `patientId` is set, and `createVideoRoomHelper` sets `maxParticipants=3`
- **AND** room creation is deferred to `startAt - 1h` like any other online session

### Requirement: Session updated to online triggers deferred room creation

When `agenda/session.updated` fires and the session is (still or newly) online and schedulable, the function SHALL check if a room already exists. If not, it SHALL sleep until the updated `startAt - 1h` and create the room. If `startAt - 1h` is already past, it SHALL create the room immediately.

#### Scenario: Session changed from in_person to online

- **WHEN** a session is updated from `modality='in_person'` to `modality='online'` with `startAt` 2 hours from now
- **THEN** the function sleeps until `startAt - 1h` and creates a room

#### Scenario: Session updated with new startAt while still online

- **WHEN** a session is updated with a new `startAt` while `modality` stays `'online'`
- **THEN** a new function invocation sleeps until the new `startAt - 1h`
- **AND** if the original function also wakes up, `createVideoRoomHelper`'s idempotency prevents a duplicate room

## ADDED Requirements

### Requirement: Sleeping creation function is cancelled when session is cancelled

The Inngest function SHALL include a `cancelOn` configuration that listens for `agenda/session.cancelled` events matching the same `sessionId`. When a session is cancelled before the room creation window, the sleeping function is automatically cancelled by Inngest without executing room creation.

#### Scenario: Session cancelled 2 days before start

- **WHEN** a session is created with `startAt` 3 days from now, and the function is sleeping
- **AND** the psychologist cancels the session 2 days before start
- **THEN** Inngest receives `agenda/session.cancelled` with matching `sessionId`
- **AND** the sleeping function is cancelled (status "Cancelled" in dashboard)
- **AND** no room is created, no Stream API call is made

#### Scenario: Session cancelled 30 minutes before start (room already created)

- **WHEN** a session's room was already created (within the 1h window)
- **AND** the psychologist cancels the session 30 minutes before start
- **THEN** the sleeping function has already completed (room exists)
- **AND** the `cancelOn` does NOT apply (function already finished)
- **AND** the cascade cancellation function handles cleanup (see next requirement)

### Requirement: Existing rooms are cleaned up when session is cancelled

A new Inngest function `telepsicologia-cancel-room-on-session-cancel` SHALL listen for `agenda/session.cancelled` events. When a `video_rooms` row exists for the cancelled session with status IN (`'pending'`, `'active'`), the function SHALL:
1. End the Stream call via `call.end()` (wrapped in try/catch — may already be ended).
2. Update the room status to `'expired'`.
3. Insert a `room_expired` log entry in `video_session_logs`.

If no room exists for the session (cancelled before the 1h creation window), the function SHALL return early with no action.

#### Scenario: Room exists and is cleaned up

- **WHEN** `agenda/session.cancelled` fires for a session that has a `video_rooms` row with status `'pending'`
- **THEN** the Stream call is ended, room status is set to `'expired'`, and a log entry is inserted

#### Scenario: Room does not exist (cancelled before creation window)

- **WHEN** `agenda/session.cancelled` fires for a session that has no `video_rooms` row
- **THEN** the function returns `{ action: 'skipped', reason: 'no_room' }` and takes no action

#### Scenario: Stream call end fails (already ended or network error)

- **WHEN** the function tries to end the Stream call but `call.end()` throws
- **THEN** the room status is still updated to `'expired'` in the database
- **AND** the error is logged with `{ event: 'stream_call_end_failed' }` but does not prevent DB cleanup

### Requirement: Session modality change from online to in_person expires existing room

When `agenda/session.updated` fires with `previousModality='online'` and `modality != 'online'`, the existing behavior of expiring the room SHALL be preserved. Additionally, any sleeping creation function for that session SHOULD be cancelled via the `cancelOn` mechanism if the session is subsequently cancelled.

#### Scenario: Online session changed to in_person (room exists)

- **WHEN** a session with an existing video room is updated from online to in_person
- **THEN** the room status is set to `'expired'` (existing behavior, unchanged)

#### Scenario: Online session changed to in_person (room not yet created)

- **WHEN** a session is updated from online to in_person before the 1h creation window
- **THEN** the sleeping creation function continues to sleep (it will eventually wake up)
- **AND** when it wakes up, it finds `modality != 'online'` via a re-check and skips creation
- **OR** if the session is also cancelled, the `cancelOn` cancels the sleeping function
