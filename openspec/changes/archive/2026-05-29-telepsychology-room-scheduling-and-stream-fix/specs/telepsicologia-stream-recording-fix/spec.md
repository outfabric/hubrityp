## MODIFIED Requirements

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
