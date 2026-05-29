## Context

The telepsychology module provisions Stream.io video rooms for online sessions. The current implementation (`auto-create-room.ts`) listens to `agenda/session.created` and `agenda/session.updated` events, and attempts to create a room immediately. This approach has two confirmed production failures:

1. The Stream.io `call.getOrCreate()` request fails with HTTP 400 because the `recording` settings enable recording (`mode: 'available'`) without the mandatory `quality` field. The exact error from Stream: `"recording quality is required when audio_only is false and recording is enabled"`. The bug is at `src/modules/telepsicologia/server/create-video-room-helper.ts:129-131`.

2. The Inngest handler swallows the error: the helper returns `{ ok: false }` (line 185-189), the handler converts it to `{ action: 'error' }` inside `step.run` (line 97-98), Inngest considers the step successful, `retries: 3` never fire, and the encrypted output hides the failure.

Result: the `video_rooms` table is empty for all 5 production online sessions — the feature has never worked.

### Current code references

- Helper: `src/modules/telepsicologia/server/create-video-room-helper.ts`
  - Lines 119-134: `call.getOrCreate()` — missing `quality` field in `settings_override.recording`
  - Lines 165-189: catch block returns `{ ok: false }` instead of rethrowing
  - Lines 180-184: error log only captures `err.code`, missing `err.message`
- Handler: `src/modules/telepsicologia/inngest/auto-create-room.ts`
  - Lines 97-98: converts `{ ok: false }` to `{ action: 'error' }`, does not throw
  - Lines 190-198: `step.run` wraps the entire logic; non-thrown result = step success
- Room expiry cron: `src/modules/telepsicologia/inngest/room-expiry.ts` — already handles expired rooms correctly
- Session events: `src/modules/agenda/lib/session-events.ts` — `sessionCancelledEventSchema` already defined

### Session types coverage

All session types (standard, recurring, couple) go through `createSessionImpl` (`src/modules/agenda/server/create-session.ts`), which emits `agenda/session.created`. There are no separate `create-recurring-session.ts` or `create-couple-session.ts` files — recurring sessions are generated from `session_recurrences` templates but each individual occurrence is inserted via the standard `sessions` table and triggers the same event. Couple sessions use `patient_ids` (UUID array) alongside `patient_id` but are created through the same flow. Therefore, the event-driven approach covers all types uniformly.

## Goals / Non-Goals

**Goals:**

- Fix the Stream.io API call to include `quality: '1080p'` and `audio_only: false` in recording settings, resolving the HTTP 400 rejection.
- Fix the Inngest handler to throw on helper failure, enabling retries and dashboard visibility.
- Improve error logging to include `err.message` for faster diagnosis.
- Defer room creation to ~1 hour before session start using `step.sleepUntil()`.
- Cancel sleeping room-creation functions when a session is cancelled (via `cancelOn`).
- Clean up existing rooms when a session is cancelled after the room was already created.
- Cover all session types (standard, recurring, couple) without special-casing.

**Non-Goals:**

- Modifying the `video_rooms` schema or adding new columns/tables.
- Changing the room expiry cron (`room-expiry.ts`) — it already works correctly.
- Modifying the frontend UI for video calls — the fix is entirely backend.
- Implementing recording consent flow changes — out of scope.
- Adding the `agenda/session.cancelled` event emission to `cancelSessionImpl` — that is the responsibility of the companion change `agenda-session-events-lifecycle`.
- Handling session rescheduling in this change — the `agenda/session.rescheduled` event cancels the old session and creates a new one, which naturally triggers room cancellation for the old and deferred creation for the new.

## Decisions

### Decision 1: `step.sleepUntil()` with `cancelOn` over cron-based polling

**Choice:** Use `step.sleepUntil(startAt - 1h)` inside the event-triggered function, combined with `cancelOn` for `agenda/session.cancelled`.

**Rationale:**

- **Simplicity:** One function handles both creation timing and cancellation, no additional polling infra.
- **Precision:** The room is created exactly ~1h before the session, not at the next cron tick (which could be up to 15 minutes late or early).
- **Natural cancellation:** `cancelOn` cancels the sleeping function atomically — no orphaned room creation attempts.
- **No wasted work:** A cron-based approach would scan all upcoming sessions every N minutes, creating unnecessary DB queries for sessions that don't need rooms yet.

**Trade-offs:**

- If `startAt` changes (session rescheduled), the sleeping function holds the old time. Mitigation: rescheduling cancels the old session (triggering `cancelOn`) and creates a new one (triggering a new function with the correct `startAt`). The `agenda/session.updated` event with `startAt` change is handled separately (see Decision 4).
- Very long sleeps (weeks/months) are subject to Inngest's infrastructure guarantees. Inngest documents that `step.sleepUntil` is durable and survives restarts, so this is acceptable.

**Alternative considered:** Cron running every 10 minutes, querying `sessions WHERE modality='online' AND status IN ('scheduled','confirmed') AND start_at BETWEEN NOW() AND NOW() + 70min AND NOT EXISTS (SELECT 1 FROM video_rooms WHERE session_id = sessions.id)`. Rejected because it adds complexity (new cron, new query, edge cases with timing), is less precise (10-min granularity), and requires explicit cancellation handling separate from the creation logic.

### Decision 2: Throw on helper failure instead of returning error

**Choice:** The Inngest handler (`auto-create-room.ts`) will throw an `Error` when `createVideoRoomHelper` returns `{ ok: false }`, instead of returning `{ action: 'error' }`.

**Rationale:** Inngest's retry mechanism requires an exception inside `step.run` to trigger retries. Returning a value (even one containing an error) is treated as a successful step completion. Throwing ensures the `retries: 3` configuration actually works, and makes failures visible in the Inngest dashboard (red status instead of green).

**Change:**
```typescript
// Before (broken):
if (!result.ok) {
  return { action: 'error', message: result.message };
}

// After (correct):
if (!result.ok) {
  throw new Error(`Video room creation failed: ${result.message}`);
}
```

### Decision 3: Recording quality `1080p` as default

**Choice:** Use `quality: '1080p'` for all calls, with `audio_only: false` explicit.

**Rationale:** The Stream.io documentation shows `quality: '1080p'` as the standard value in all examples for `call.getOrCreate()` and `call.update()` when recording is enabled with `audio_only: false`. Since the platform serves telepsychology sessions where video quality matters for therapeutic rapport and clinical observation, 1080p is the appropriate default. Lower qualities (360p, 480p) are available but inappropriate for clinical use. The `audio_only: false` is set explicitly to document the intent and match the Stream API's validation requirement.

**Stream.io documentation reference (Context7, source: getstream/stream-node):**
```typescript
// From official examples:
recording: { mode: 'available', quality: '1080p' }
recording: { mode: 'auto-on', audio_only: false, quality: '1080p' }
recording: { mode: 'available', quality: '1080p', audio_only: false }
```

### Decision 4: Handle `session.updated` with `startAt` changes

**Choice:** When `agenda/session.updated` fires and the session is still online + schedulable, but `startAt` has changed, the existing sleeping function (from the original `session.created`) may be waiting for the wrong time. Rather than trying to "reschedule" the sleep, rely on the fact that:
- If the session is updated (not cancelled), the update Server Action emits `agenda/session.updated`.
- The Inngest function for `session.updated` checks if a room already exists. If not, it starts a new sleep cycle for the updated `startAt`.
- If the old sleeping function wakes up and tries to create a room, the helper is idempotent — the first to succeed wins, the second is a no-op.

**Rationale:** This avoids the complexity of cancelling-and-re-creating Inngest functions for time changes. The idempotency guarantee in `createVideoRoomHelper` (checks for existing room before creating) makes double-creation harmless.

**Edge case:** If `startAt` is moved EARLIER (and the new `startAt - 1h` is already past), the `session.updated` handler must create the room immediately instead of sleeping.

### Decision 5: Cascade cancellation as a separate function

**Choice:** Create a new Inngest function `cancel-room-on-session-cancel.ts` triggered by `agenda/session.cancelled` that handles room cleanup for already-created rooms.

**Rationale:** The `cancelOn` mechanism on the creation function only covers the case where the room has NOT been created yet (function is still sleeping). If the room was already created (session cancelled within the 1h window or after session start), a separate function must end the Stream call and expire the room. This is cleaner than adding cancellation logic to the existing `auto-create-room` function.

### Decision 6: Dependency on `agenda/session.cancelled` event emission

**Choice:** This change assumes that `cancelSessionImpl` and `publicDeclineSessionImpl` emit the `agenda/session.cancelled` Inngest event. This is being implemented by the companion change `agenda-session-events-lifecycle`.

**Rationale:** Without the cancellation event, the `cancelOn` mechanism and the cascade cancellation function will not trigger. The change can be implemented and tested independently (mocking the event), but will only work end-to-end after the companion change is merged.

If the companion change is not yet merged at implementation time, the `cancelOn` and cascade function should still be implemented and tested with mock events, but the end-to-end flow should be verified after both changes are merged.

## Risks / Trade-offs

- **[Risk] Long sleep durations** → Sessions scheduled weeks ahead will have Inngest functions sleeping for that long. Inngest's durable execution guarantees handle this, but extreme durations (months) may hit undocumented limits. → Mitigated by the room expiry cron as a safety net: even if a sleeping function is lost, the cron will eventually clean up orphaned rooms.
- **[Risk] Companion change dependency** → The `cancelOn` mechanism depends on `agenda/session.cancelled` being emitted. If the companion change is reverted or broken, cancellation will not work. → Mitigated by the room expiry cron, which expires rooms past their window regardless of cancellation.
- **[Risk] Double room creation on `session.updated`** → If `startAt` changes, both the old sleeping function and the new one may try to create a room. → Mitigated by idempotency in `createVideoRoomHelper` (checks for existing room, returns it if found; handles unique constraint violations with re-fetch).
- **[Trade-off] 1h advance creation window** → If the psychologist or patient tries to access the room more than 1h before the session, the room will not exist yet. → Acceptable: the existing `ROOM_AVAILABLE_BEFORE_MINUTES = 10` constant already restricts access to 10 minutes before start. The 1h creation window provides 50 minutes of buffer for retries.
- **[Trade-off] No explicit handling of `startAt` changes** → Relying on idempotency rather than explicit cancellation-and-recreation for time changes. → Acceptable for the current scale. If this proves problematic, a dedicated `startAt` change handler can be added later.
