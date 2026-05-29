## Why

The telepsychology video room feature is completely broken in production: **zero rooms have been created across all 5 online sessions** since launch. The root cause is a combination of two bugs:

1. **Stream.io API rejection (HTTP 400):** The `call.getOrCreate()` request in `src/modules/telepsicologia/server/create-video-room-helper.ts:119-134` enables recording (`mode: 'available'`) without specifying the mandatory `quality` field. Stream.io returns:
   ```
   GetOrCreateCall failed with error: "recording quality is required when audio_only is false and recording is enabled"
   ```
   This was confirmed in Inngest/Stream logs from production.

2. **Silent failure in Inngest handler:** The helper's catch block (`create-video-room-helper.ts:165-189`) returns `{ ok: false }` instead of throwing. The Inngest handler (`auto-create-room.ts:97-98`) converts this to `{ action: 'error' }` inside a `step.run`, which completes "successfully" from Inngest's perspective. The configured `retries: 3` never trigger, and the `@inngest/middleware-encryption` encrypts the output, hiding the error in the dashboard.

Additionally, the current architecture creates rooms **immediately** on `agenda/session.created`, which is wasteful: sessions scheduled days or weeks in advance don't need a Stream call and patient JWT minted right away. Patient JWTs have a bounded validity, so early minting may cause tokens to expire before the session starts.

## What Changes

### (A) Deferred room creation (~1h before session) with cancellation support

- Replace the immediate room creation trigger with a deferred approach: when `agenda/session.created` fires for an online session, the Inngest function sleeps until `startAt - 1h` using `step.sleepUntil()`, then creates the room. This ensures the patient JWT is minted close to the session start and avoids unnecessary Stream API calls for sessions that may be cancelled before they begin.
- Add `cancelOn` configuration to the Inngest function so that `agenda/session.cancelled` events for the same session abort the sleeping function — preventing room creation for cancelled sessions.
- Handle `agenda/session.updated` events: if a session's modality changes from online to in_person (or vice-versa), or if `startAt` changes, the function must handle these transitions appropriately.
- Ensure uniform coverage for all session types (standard, recurring, couple): since all sessions go through `createSessionImpl` which emits `agenda/session.created`, the event-driven approach covers all types without special-casing.
- Add a cascade cancellation Inngest function: when `agenda/session.cancelled` fires and a `video_rooms` row already exists (room was created within the 1h window), end the Stream call and set the room status to `expired`.

### (B) Fix Stream.io recording quality and silent failure

- Add `quality: '1080p'` (and explicitly `audio_only: false`) to the `recording` settings in `call.getOrCreate()` at `create-video-room-helper.ts:129-131`, resolving the HTTP 400 error.
- Fix the Inngest handler to **throw** when the helper returns `{ ok: false }`, activating the `retries: 3` mechanism and making failures visible in the Inngest dashboard.
- Improve error logging in the helper's catch block: log the full `err.message` (not just `err.code`) for non-Postgres errors, enabling faster diagnosis of Stream API failures.

## Capabilities

### Modified Capabilities

- `telepsicologia-auto-lifecycle`: Room creation timing changes from immediate to deferred (1h before session). Adds cancellation-aware lifecycle management. Recording quality fix resolves the Stream.io API rejection.

### New Capabilities

- `telepsicologia-session-cancellation-cascade`: When a session is cancelled, any existing video room is ended on Stream and marked as expired in the database. If the room has not been created yet (session cancelled before the 1h window), the sleeping Inngest function is automatically cancelled via `cancelOn`.

## Impact

- **Code (modified):**
  - `src/modules/telepsicologia/server/create-video-room-helper.ts` — add `quality: '1080p'` and `audio_only: false` to recording settings; improve error logging.
  - `src/modules/telepsicologia/inngest/auto-create-room.ts` — restructure to use `step.sleepUntil(startAt - 1h)` before room creation; add `cancelOn` for `agenda/session.cancelled`; throw on helper failure instead of returning `{ action: 'error' }`.
- **Code (new):**
  - `src/modules/telepsicologia/inngest/cancel-room-on-session-cancel.ts` — new Inngest function that handles room cleanup when a session is cancelled after the room has already been created.
- **Dependencies:** No new dependencies. Uses existing `@stream-io/node-sdk`, `inngest`, Drizzle ORM.
- **Downstream consumers:** The `agenda/session.cancelled` event emission (from the companion change `agenda-session-events-lifecycle`) is a prerequisite. The `cancelOn` mechanism depends on this event being emitted.
- **No new routes, tables, RLS policies, migrations, or frontend changes.**
- **Security/LGPD:** No change to the security posture. Room creation still runs in the Inngest system context (service-role DB). Patient tokens are minted closer to session time, which is strictly better from a token lifetime perspective.
