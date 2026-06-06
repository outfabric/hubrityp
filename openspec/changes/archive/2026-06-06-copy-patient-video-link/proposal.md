## Why

After scheduling an online session, the psychologist has no way to view or copy the patient's video room link (`/v/[token]`). The token is only generated ~1 hour before the session via the Inngest deferred-creation flow, which means the link does not exist when the psychologist wants to share it with the patient (typically right after scheduling). This blocks the primary workflow: schedule → send link → patient joins.

## What Changes

- **Eager token reservation**: when an online session is created (or an existing session is changed to online), a `video_rooms` row is inserted immediately with a stable `patient_token` but without the Stream.io call or JWT (those remain deferred to startAt − 1h). This makes the patient URL available from the moment of scheduling.
- **Schema adjustment**: `video_rooms.stream_call_id` and `video_rooms.patient_jwt` become nullable to represent the "reserved but not yet activated" lifecycle state.
- **Inngest handler update**: `autoCreateVideoRoom` transitions from INSERT to UPDATE for the deferred activation step, populating `stream_call_id`, `patient_jwt`, and `status='pending'` on the pre-existing row.
- **`createSessionImpl` returns patient URL**: when creating an online session, the Server Action returns `patientVideoUrl` alongside `sessionId` so the UI can show a copy affordance immediately.
- **Session Detail Drawer — copy link section**: for online sessions in `scheduled`/`confirmed` status, the drawer shows the patient video URL with a copy-to-clipboard button.
- **Post-scheduling copy link toast**: immediately after creating an online session, a Sonner toast appears with a button to copy the patient link. Dismissable by the user.
- **`/v/[token]` graceful handling**: when a patient visits the link before the Stream call is provisioned (room row exists but `stream_call_id` is NULL), the page shows the existing `TooEarlyView` (or similar) instead of a 404.

## Capabilities

### New Capabilities

- `patient-video-link-copy`: the psychologist-facing capability to view and copy the patient's video room link, both from the session detail drawer and via a post-scheduling toast.

### Modified Capabilities

- `telepsicologia-data-model`: `stream_call_id` and `patient_jwt` become nullable to support the "reserved" lifecycle state.
- `telepsicologia-auto-lifecycle`: the Inngest auto-create handler changes from INSERT to UPDATE for rooms that were eagerly reserved, while remaining backward-compatible with the INSERT path.
- `telepsicologia-patient-join`: the `/v/[token]` route must handle the case where the room row exists but `stream_call_id` is NULL (room reserved but not yet activated).
- `telepsicologia-token-minting`: `createVideoRoomHelper` changes to support two modes — full creation (current behavior for backward compat) and activation-only (UPDATE an existing reserved row with Stream call + JWT).
- `agenda-sessions`: `CreateSessionResult` gains an optional `patientVideoUrl` field, and `createSessionImpl` calls the eager reservation helper for online sessions.

## Impact

- **Database**: migration to make `video_rooms.stream_call_id` and `video_rooms.patient_jwt` nullable. No data loss (existing rows already have values). No new tables.
- **Backend**: `createSessionImpl`, `createVideoRoomHelper`, `autoCreateVideoRoom` Inngest handler, `/v/[token]` page server component, `/api/video/join` Route Handler.
- **Frontend**: `SessionDetailDrawer`, `SessionFormModal` (post-submit toast), clipboard API usage.
- **Dependencies**: no new external dependencies. Uses existing `navigator.clipboard` API and Sonner toast.
- **RLS**: no new tables; existing `video_rooms` RLS policies remain valid (nullable columns do not affect `user_id = auth.uid()` scoping).
