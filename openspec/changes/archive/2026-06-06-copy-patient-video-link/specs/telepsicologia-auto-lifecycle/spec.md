## MODIFIED Requirements

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
