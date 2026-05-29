## 1. Fix Stream.io Recording Configuration (Cause Root)

- [x] 1.1 In `src/modules/telepsicologia/server/create-video-room-helper.ts`, update the `settings_override.recording` object at lines 129-131 from `{ mode: 'available' }` to `{ mode: 'available', quality: '1080p', audio_only: false }` — this resolves the Stream.io HTTP 400 error `"recording quality is required when audio_only is false and recording is enabled"`
- [x] 1.2 In the same file's catch block (lines 180-184), update the error log to include `err.message`: change `{ event: 'create_video_room_helper_failed', errorCode: pgError.code }` to `{ event: 'create_video_room_helper_failed', errorCode: (err as { code?: string }).code, errorMessage: err instanceof Error ? err.message : 'unknown' }` — this ensures Stream API errors are fully logged for diagnosis (no PII risk — Stream errors contain only technical details)

## 2. Fix Silent Failure in Inngest Handler

- [x] 2.1 In `src/modules/telepsicologia/inngest/auto-create-room.ts`, in the `processSessionCreated` function (lines 97-98), replace `return { action: 'error', message: result.message }` with `throw new Error(\`Video room creation failed: \${result.message}\`)` — this activates Inngest's `retries: 3` mechanism and makes failures visible in the dashboard
- [x] 2.2 In the same file, in the `processSessionUpdated` function (around line 153-155), apply the same change: replace `return { action: 'error', message: result.message }` with `throw new Error(\`Video room creation failed: \${result.message}\`)` — ensuring consistent retry behavior for both event types
- [x] 2.3 Update the `AutoCreateRoomResult` type (lines 58-63) to remove the `| { action: 'error'; message: string }` variant, since the error path now throws instead of returning — this makes the type system enforce correctness

## 3. Defer Room Creation to 1h Before Session

- [x] 3.1 In `src/modules/telepsicologia/inngest/auto-create-room.ts`, restructure the Inngest function to add a `step.sleepUntil` step before room creation: after the guard checks (modality=online, status=schedulable), compute `wakeUpAt = new Date(startAt.getTime() - 60 * 60 * 1000)`; if `wakeUpAt > Date.now()`, call `await step.sleepUntil('wait-until-1h-before', wakeUpAt)` before proceeding to `step.run('auto-create-room', ...)` — if `wakeUpAt` is already past, skip the sleep and create immediately
- [x] 3.2 Add `cancelOn` configuration to the Inngest function definition: `cancelOn: [{ event: 'agenda/session.cancelled', if: 'async.data.sessionId == event.data.sessionId' }]` — this cancels the sleeping function when the session is cancelled, preventing room creation for cancelled sessions
- [x] 3.3 Refactor the `session.updated` handler to support the deferred approach: when the session is (still) online and schedulable, check if a room already exists in `video_rooms` (query DB); if not, compute `wakeUpAt` from the updated `startAt` and sleep/create with the same pattern as `session.created`; if a room exists, return `{ action: 'existing' }`
- [x] 3.4 Add a re-check step after the sleep wakes up: before creating the room, re-query the session from the database to confirm it is still `modality='online'` and `status IN ('scheduled', 'confirmed')` — if the session was changed to in_person or cancelled while the function was sleeping (and the `cancelOn` did not fire, e.g., due to a race), skip room creation with `{ action: 'skipped', reason: 'session_no_longer_eligible' }`

## 4. Cascade Cancellation Function

- [x] 4.1 Create `src/modules/telepsicologia/inngest/cancel-room-on-session-cancel.ts` — a new Inngest function `telepsicologia-cancel-room-on-session-cancel` triggered by `agenda/session.cancelled` with `retries: 3`: query `video_rooms WHERE session_id = event.data.sessionId AND user_id = event.data.userId AND status IN ('pending', 'active')`; if no room found, return `{ action: 'skipped', reason: 'no_room' }`; if found, end the Stream call via `streamClient.video.call('default', room.streamCallId).end()` (try/catch, log error if Stream fails but continue), update room status to `'expired'`, insert `video_session_logs` entry with `eventType: 'room_expired'`, return `{ action: 'expired_room', roomId: room.id }`
- [x] 4.2 Register the new function in the Inngest serve call — add `cancelRoomOnSessionCancel` to the functions array in the Inngest route handler at `src/app/api/inngest/route.ts` (or wherever the Inngest functions are registered), following the same import pattern as existing telepsicologia functions

## 5. Unit Tests

- [x] 5.1 Update `src/__tests__/unit/modules/telepsicologia/server/create-video-room-helper.test.ts` (or create if it does not exist) — test that the `call.getOrCreate()` mock receives `settings_override.recording` with `{ mode: 'available', quality: '1080p', audio_only: false }`; test that the error log includes `errorMessage` when Stream throws a non-Postgres error
- [x] 5.2 Update `src/__tests__/unit/modules/telepsicologia/inngest/auto-create-room.test.ts` (or create if it does not exist) — test that `processSessionCreated` throws `Error` (not returns `{ action: 'error' }`) when helper returns `{ ok: false }`; test same for `processSessionUpdated`; test that the `AutoCreateRoomResult` type no longer includes the `error` variant
- [x] 5.3 Create `src/__tests__/unit/modules/telepsicologia/inngest/cancel-room-on-session-cancel.test.ts` — test the core logic: (a) no room found returns `{ action: 'skipped' }`, (b) room found triggers Stream `call.end()` + DB update + log insert, (c) Stream `call.end()` failure does not prevent DB update

## 6. Integration Tests

- [x] 6.1 Create `src/__tests__/integration/telepsicologia/stream-recording-fix.int.test.ts` — against real Postgres with Drizzle migrations: insert a session, mock the Stream client, call `createVideoRoomHelper`, verify the mock received the correct recording settings (`quality: '1080p'`, `audio_only: false`, `mode: 'available'`), verify the `video_rooms` row is created successfully
- [x] 6.2 Create `src/__tests__/integration/telepsicologia/cancel-room-cascade.int.test.ts` — against real Postgres: insert a session and a `video_rooms` row with status `'pending'`, mock the Stream client, call the cascade cancellation core logic, verify the room status is `'expired'` and a `video_session_logs` entry with `eventType: 'room_expired'` exists; also test the no-room-found path
