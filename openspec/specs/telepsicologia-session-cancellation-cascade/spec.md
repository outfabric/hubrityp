# telepsicologia-session-cancellation-cascade Specification

## Purpose

Cancellation-aware cleanup for telepsychology video rooms. When a session is cancelled before the room creation window, the sleeping Inngest creation function is automatically cancelled via `cancelOn`, so no Stream call is made. When a session is cancelled after the room has already been created, a dedicated cascade function ends the Stream call and marks the room as expired.

## Requirements

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
