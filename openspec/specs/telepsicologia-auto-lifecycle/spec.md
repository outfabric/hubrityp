# telepsicologia-auto-lifecycle Specification

## Purpose

Automated lifecycle management for telepsychology video rooms: deferred auto-creation of rooms approximately 1 hour before an online session starts, expiration of rooms when sessions change modality, valid Stream.io recording configuration and visible failure handling, cron-based cleanup of expired and empty rooms, and cron-based discarding of old recording audio.

## Requirements

### Requirement: Video rooms are created ~1 hour before session start, not immediately

The Inngest function `telepsicologia-auto-create-video-room` SHALL defer Stream.io call activation until approximately 1 hour before the session's `startAt` time. When an `agenda/session.created` event fires for an online session in a schedulable status, the function SHALL use `step.sleepUntil(startAt - 1h)` to pause execution, then proceed with room activation via `createVideoRoomHelper`.

A `video_rooms` row with `patient_token` SHALL already exist at this point (created eagerly by `reserveVideoRoom` at scheduling time). The Inngest handler SHALL UPDATE this existing row with `stream_call_id` and `patient_jwt` instead of INSERTing a new one. If no reserved row exists (backward compatibility), `createVideoRoomHelper` SHALL fall back to the full INSERT path.

The guard logic SHALL distinguish between "room fully activated" (skip — `stream_call_id IS NOT NULL`) and "room reserved but not activated" (proceed with activation — `stream_call_id IS NULL`).

#### Scenario: Standard session scheduled 3 days ahead

- **WHEN** a session is created with `modality='online'`, `status='scheduled'`, and `startAt` 3 days from now
- **THEN** `reserveVideoRoom` creates a partial `video_rooms` row immediately (at scheduling time)
- **AND** the Inngest function starts, validates guards, and sleeps until `startAt - 1h`
- **AND** after waking, `createVideoRoomHelper` finds the reserved row and UPDATEs it with Stream call ID and patient JWT

#### Scenario: Session scheduled less than 1 hour ahead

- **WHEN** a session is created with `modality='online'` and `startAt` is 30 minutes from now
- **THEN** `reserveVideoRoom` creates a partial row immediately
- **AND** the Inngest function detects that `startAt - 1h` is already in the past
- **AND** activates the room immediately (no sleep) by UPDATEing the reserved row

#### Scenario: Guard skips fully activated room

- **WHEN** the Inngest event fires for a session that already has a video room with `stream_call_id IS NOT NULL`
- **THEN** the function returns `{ action: 'existing' }` without sleeping or calling `createVideoRoomHelper`

#### Scenario: Guard proceeds for reserved-but-not-activated room

- **WHEN** the Inngest event fires for a session that has a video room with `stream_call_id IS NULL`
- **THEN** the function proceeds with the deferred activation flow (sleep → activate)

#### Scenario: No reserved row exists (backward compatibility)

- **WHEN** the Inngest event fires for a session that has no `video_rooms` row at all
- **THEN** `createVideoRoomHelper` falls back to the full INSERT path (generate token, create Stream call, INSERT row)

#### Scenario: Recurring session triggers deferred activation

- **WHEN** a recurring session occurrence is created via `createSessionImpl` with `modality='online'`
- **THEN** `reserveVideoRoom` reserves the room immediately
- **AND** the `agenda/session.created` event fires and the same deferred activation logic applies

#### Scenario: Couple session triggers deferred activation

- **WHEN** a couple session is created with `modality='online'` and `patient_ids` array populated
- **THEN** `reserveVideoRoom` reserves the room immediately
- **AND** the `agenda/session.created` event fires, `createVideoRoomHelper` sets `maxParticipants=3` during activation

#### Scenario: Cancelled session does not trigger room activation

- **WHEN** a session event fires with status='cancelled'
- **THEN** no room activation occurs (existing cancelOn behavior is preserved)

### Requirement: Session updated to online triggers deferred room creation

When `agenda/session.updated` fires and the session is (still or newly) online and schedulable, the function SHALL check if a room already exists. If not, it SHALL sleep until the updated `startAt - 1h` and create the room. If `startAt - 1h` is already past, it SHALL create the room immediately.

#### Scenario: Session changed from in_person to online

- **WHEN** a session is updated from `modality='in_person'` to `modality='online'` with `startAt` 2 hours from now
- **THEN** the function sleeps until `startAt - 1h` and creates a room

#### Scenario: Session updated with new startAt while still online

- **WHEN** a session is updated with a new `startAt` while `modality` stays `'online'`
- **THEN** a new function invocation sleeps until the new `startAt - 1h`
- **AND** if the original function also wakes up, `createVideoRoomHelper`'s idempotency prevents a duplicate room

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

### Requirement: Stream call creation includes valid recording configuration

The `call.getOrCreate()` request in `createVideoRoomHelper` SHALL include `quality: '1080p'` and `audio_only: false` in the `settings_override.recording` object alongside `mode: 'available'`. This resolves the Stream.io HTTP 400 error `"recording quality is required when audio_only is false and recording is enabled"`.

#### Scenario: Room creation succeeds with valid recording settings

- **WHEN** the system creates a Stream call via `call.getOrCreate()` with recording mode `'available'`
- **THEN** the request includes `settings_override.recording` with `{ mode: 'available', quality: '1080p', audio_only: false }`
- **AND** Stream.io returns a successful response (no HTTP 400)

#### Scenario: Recording settings match Stream API contract

- **WHEN** the recording configuration is built for a new call
- **THEN** `quality` is `'1080p'` (standard video quality for clinical sessions)
- **AND** `audio_only` is `false` (video recording, not audio-only)
- **AND** `mode` is `'available'` (recording can be started manually, not auto-on)

### Requirement: Inngest handler throws on helper failure to activate retries

The Inngest handler in `auto-create-room.ts` SHALL throw an `Error` inside `step.run` when `createVideoRoomHelper` returns `{ ok: false }`. This activates the `retries: 3` configuration and makes failures visible in the Inngest dashboard.

#### Scenario: Helper failure triggers retry

- **WHEN** `createVideoRoomHelper` returns `{ ok: false, error: 'unknown', message: 'Stream API error' }`
- **THEN** the Inngest handler throws `Error('Video room creation failed: Stream API error')` inside `step.run`
- **AND** Inngest retries the step up to 3 times with backoff

#### Scenario: Helper failure is visible in dashboard

- **WHEN** `createVideoRoomHelper` fails and the handler throws
- **THEN** the Inngest dashboard shows the function run as "Failed" (not "Completed")
- **AND** the error message is visible in the run details

### Requirement: Error logging includes full error message

The catch block in `createVideoRoomHelper` SHALL log `err.message` (in addition to `err.code`) for all error types, not just Postgres errors. The log MUST NOT include PII, Stack traces, or raw request/response bodies.

#### Scenario: Stream API error is fully logged

- **WHEN** `call.getOrCreate()` throws an error with message `"recording quality is required..."` and no `code` property
- **THEN** the logger captures `{ event: 'create_video_room_helper_failed', errorCode: undefined, errorMessage: 'recording quality is required...' }`

#### Scenario: Postgres unique violation still handled correctly

- **WHEN** a Postgres unique violation (code `23505`) occurs during room insertion
- **THEN** the helper re-fetches and returns the existing room (idempotency preserved)
- **AND** no error is logged (the re-fetch path does not go through the generic catch)

### Requirement: Expired rooms are cleaned up by cron
An Inngest cron running every 15 minutes SHALL find rooms with status IN ('pending', 'active') and expires_at < NOW(), end the Stream call, and set status to 'expired'. Rooms that have been empty for more than 5 minutes (no participants) SHALL also be expired.

#### Scenario: Past-expiry room is cleaned up
- **WHEN** the cron runs and finds a room with expires_at in the past
- **THEN** the Stream call is ended and room status is set to 'expired'

#### Scenario: Empty room for 5 minutes is expired
- **WHEN** the cron runs and finds an active room where the last participant left more than 5 minutes ago
- **THEN** the room is expired

#### Scenario: Active room with participants is not touched
- **WHEN** the cron runs and finds an active room with connected participants
- **THEN** the room is left unchanged

### Requirement: Recording audio is discarded within 24 hours
An Inngest cron running hourly SHALL find recordings with status IN ('processing', 'transcribed') and recorded_at older than 24 hours, set status to 'discarded', clear audio_temp_url, and set discarded_at.

#### Scenario: Old recording is discarded
- **WHEN** the cron runs and finds a recording with recorded_at > 24h ago and status='processing'
- **THEN** the recording status becomes 'discarded' and audio_temp_url is set to NULL

#### Scenario: Recent recording is preserved
- **WHEN** the cron runs and finds a recording with recorded_at < 24h ago
- **THEN** the recording is not modified
