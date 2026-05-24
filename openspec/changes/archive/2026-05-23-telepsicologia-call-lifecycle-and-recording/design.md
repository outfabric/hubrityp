## Context

Changes 1-4 provide the data model, token minting, psychologist UI, patient join flow, and in-call features. This change automates the plumbing: rooms are created automatically, expire on schedule, recordings are consent-gated and ephemeral, and Stream webhooks keep our DB in sync with the actual call state.

The existing Inngest infrastructure (from the WhatsApp module) is mature: cron functions, event-driven functions, step memoization, and the serve handler at `/api/inngest`. The agenda module already emits Inngest events on session lifecycle transitions (`agenda/session.created`, `agenda/session.updated`, `agenda/session.cancelled`).

Stream Video provides webhooks for call lifecycle events. The webhook payload includes a signature that must be validated server-side.

## Goals / Non-Goals

**Goals:**

- Auto-create video room when session is created/updated with modality='online'
- Auto-expire rooms past their `expires_at` (cron every 15 min)
- Auto-discard recordings older than 24h (cron every 1h)
- Stream webhook handler with signature validation for call event reconciliation
- Toggle recording with consent validation (Res. CFP 13/2022)
- Extend session duration (+15 min)
- Populate WhatsApp video link template variable
- Post-call metadata capture (RF-09.28)
- Dashboard stat helper (RF-09.29)
- Integration tests for auto-creation, webhook, recording consent, expiry
- E2E test for auto-room-creation flow

**Non-Goals:**

- Transcription processing (PRD 10 scope)
- Recording storage in Supabase Storage (audio stays in Stream's ephemeral storage until cleanup)
- Video recording (only audio for transcription)
- Notification when room auto-created (psychologist sees the room when they open the session)
- International session blocking (RN-09.06 — system warns during onboarding, does not enforce geolocation)

## Decisions

**1. Auto-create room: Inngest event-driven function**

Listens to `agenda/session.created` and `agenda/session.updated`. When the session has `modality='online'` and `status IN ('scheduled', 'confirmed')`:
1. Check if `video_rooms` already exists for this session (idempotent)
2. If not, call `createVideoRoom` (change 1's Server Action logic, extracted into a shared helper)
3. The helper creates the Stream call, generates tokens, inserts the DB row

Why event-driven (not cron): immediate room creation when the session is saved. The psychologist does not need to manually trigger it. Cron would introduce up to 5-min delay.

If the session is updated from `online` to `in_person`, the existing room is soft-invalidated (status set to 'expired') but not deleted.

**2. Room expiry cron: Inngest `*/15 * * * *`**

Every 15 minutes, queries `video_rooms` with `status IN ('pending', 'active') AND expires_at < NOW()`. For each:
1. Call `getStreamClient().video.call('default', streamCallId).end()` (wrapped in try/catch — call may already be ended)
2. UPDATE `video_rooms` SET status='expired'
3. INSERT `video_session_logs` event_type='room_expired'

Also handles the "5 min empty room" rule (RF-09.23): if room status is 'active' but the last participant left >5 min ago (check `video_session_logs` for most recent `*_left` event with no subsequent `*_joined`), expire the room.

**3. Recording cleanup cron: Inngest `0 * * * *` (hourly)**

Queries `video_recordings` with `status IN ('processing', 'transcribed') AND recorded_at < NOW() - INTERVAL '24 hours'`. For each:
1. UPDATE status='discarded', discarded_at=NOW(), audio_temp_url=NULL
2. If Stream has an API to delete the recording, call it

This enforces RNF-09.08: audio not persisted beyond 24h.

**4. Stream webhook handler**

`POST /api/webhooks/stream/video` Route Handler:
1. Read raw body for signature validation
2. Validate signature using `crypto.timingSafeEqual` with `STREAM_WEBHOOK_SECRET`
3. Parse payload, route by event type:
   - `call.session_ended` → UPDATE video_rooms SET status='ended', INSERT log event_type='room_ended'
   - `call.session_participant_joined` → INSERT log with participant info
   - `call.session_participant_left` → INSERT log
   - `call.recording_started` → UPDATE video_recordings SET status='recording', recorded_at=NOW()
   - `call.recording_stopped` → UPDATE video_recordings SET status='processing', generate temp audio URL
4. Return 200

Why webhooks in addition to our own Server Actions: Stream is the source of truth for call state. If a call ends due to network issues (not via our `endVideoSession` action), the webhook catches it. Defense-in-depth.

**5. Recording toggle with consent validation**

Server Action `toggleRecording`:
1. Authenticate via `supabase.auth.getUser()`
2. Validate input: room_id, action ('start' | 'stop')
3. Verify room ownership
4. If action='start':
   - Query patient's `recording_consent_signed_at` — must be non-null
   - Query patient's `recording_consent_revoked_at` — must be null (consent not revoked)
   - If consent valid: call Stream `call.startRecording()`, INSERT/UPDATE video_recordings, UPDATE video_rooms SET recording_enabled=true
   - If consent invalid: return `{ ok: false, code: 'CONSENT_REQUIRED' }`
5. If action='stop':
   - Call Stream `call.stopRecording()`, UPDATE video_recordings status, UPDATE video_rooms SET recording_enabled=false

Recording consent is checked BOTH at the DB level (this action) and displayed in the UI (change 2's controls — the "Gravar" button is disabled with tooltip when consent is missing per RN-09.05). Belt-and-suspenders.

**6. WhatsApp video link integration**

When `createVideoRoomHelper` creates a room, it stores the patient URL. The existing `select-template-variables.ts` (from the WhatsApp module) already has a `link_video` variable. This change ensures that variable is populated by querying `video_rooms` for the session and returning `generatePatientVideoUrl(baseUrl, room.patient_token)`.

No changes to the WhatsApp module's Inngest functions — `selectTemplateVariables` already reads session data and returns the URL if present. The integration is data-level: the video room row exists, the reminder engine picks it up.

**7. Post-call metadata (RF-09.28)**

When a session transitions to 'done' (via `endVideoSession` or webhook):
1. Query `video_session_logs` for the session to determine:
   - Real start time (first `therapist_joined` event)
   - Real end time (last `room_ended` event)
   - Effective duration (end - start)
   - Had recording (any `recording_started` event)
   - Had screen share (any `screen_share_started` event)
2. INSERT a summary event in `video_session_logs` with event_type='session_summary', metadata containing these fields

This data powers the dashboard stat (RF-09.29): `SELECT COUNT(*) FROM sessions WHERE modality='online' AND status='done' AND start_at BETWEEN [month_start] AND [month_end]` divided by total done sessions.

**8. Extend session (+15 min)**

Server Action `extendSession`:
1. Authenticate, validate room_id
2. Verify room ownership and status='active'
3. UPDATE video_rooms SET expires_at = expires_at + INTERVAL '15 minutes'
4. INSERT video_session_logs event_type='session_extended'

Simple, no Stream API call needed (Stream calls don't have a hard expiry — our expiry cron handles cleanup).

## Risks / Trade-offs

- [Risk: Stream webhook signature validation differs from Twilio] → Mitigation: consult Stream docs for exact validation method. If HMAC-SHA256, use `crypto.createHmac('sha256', secret).update(rawBody).digest('hex')` + `crypto.timingSafeEqual`. If different, adapt.
- [Risk: auto-create room fires before psychologist wants it] → Mitigation: room is "pending" and invisible to the patient until the psychologist enters. No cost from Stream for unused rooms (free tier). The psychologist can delete/recreate if needed.
- [Risk: expiry cron runs every 15 min — up to 15 min delay in cleanup] → Mitigation: acceptable for the use case. Rooms past expiry are also caught by the webhook (if Stream ends the call) and by the patient join handler (returns 'expired' status).
- [Risk: recording cleanup deletes audio before transcription completes] → Mitigation: only recordings with status 'processing' or 'transcribed' are cleaned up after 24h. If PRD 10's transcription takes longer, it must update the status to 'transcribing' (a new status that the cleanup cron skips). This is documented as a contract for the transcription change.
- [Trade-off: metadata computed from logs rather than tracked in real-time] → Accepted for simplicity. The log-based approach is append-only and audit-friendly.

## Migration Plan

1. Add `STREAM_WEBHOOK_SECRET` to `serverEnvSchema` and `.env.example`
2. Deploy Inngest functions (auto-create, expiry, cleanup) — register in serve handler
3. Deploy webhook Route Handler
4. Configure Stream dashboard to send webhooks to `https://<domain>/api/webhooks/stream/video`
5. Deploy Server Actions (toggleRecording, extendSession)

Rollback: disable Inngest functions (remove from serve handler), remove webhook route. Existing rooms continue to work manually. No data loss.

## Open Questions

- Stream webhook signature format: need to verify the exact HMAC algorithm and header name from Stream docs at implementation time. The design assumes HMAC-SHA256 with a shared secret.
- Should the recording cleanup also call Stream's API to delete the recording server-side? Depends on whether Stream auto-deletes recordings after their retention period. Verify at implementation time.
