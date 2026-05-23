## Why

Changes 1-4 deliver the manual video call creation, psychologist/patient UIs, and in-call features. This final change automates the lifecycle: rooms are created automatically when a session is marked as online (RF-09.03), rooms expire and are cleaned up on schedule (RF-09.23), the WhatsApp video link template is populated (RF-09.05), recording can be activated with consent (RF-09.20-22), session metadata is captured for history/stats (RF-09.28-29), and Stream webhooks reconcile call state. This change closes all remaining PRD 09 requirements.

## What Changes

- Inngest function: auto-create video room when a session is created/updated with modality='online' (listens to `agenda/session.created` and `agenda/session.updated` events)
- Inngest cron: room expiry — every 15 min, find rooms past `expires_at` with status != 'ended'/'expired', update status to 'expired', end the Stream call if still active
- Inngest cron: recording cleanup — every 1h, find recordings with status='processing' or 'transcribed' and `recorded_at < NOW() - 24h`, mark as 'discarded', delete temp audio URL (RNF-09.08)
- Route Handler for Stream webhooks: `POST /api/webhooks/stream/video` — validates webhook signature, processes call events (call.ended, call.session_participant_joined, call.session_participant_left, call.recording_started, call.recording_stopped)
- Server Action `toggleRecording` — starts/stops recording on a call (only if recording_consent_signed=true for the patient, per RN-09.05)
- Server Action `extendSession` — adds 15 min to expires_at (edge case from PRD)
- Recording consent check helper — verifies patient has signed recording consent before enabling
- Video link population for WhatsApp reminders: when a video room is created, the patient URL is stored so the existing reminder engine (`select-template-variables.ts`) can include it
- Session completion metadata: when session is marked 'done', capture real start/end time, duration, recording flag, screen share flag in `video_session_logs` summary event
- Dashboard stat: "% sessoes online no mes" query (RF-09.29) — a helper that counts online done sessions vs total done sessions

## Capabilities

### New Capabilities

- `telepsicologia-auto-lifecycle`: Inngest functions for automatic room creation on online session, room expiry cron, recording cleanup cron
- `telepsicologia-recording`: Toggle recording with consent validation, recording state management, 24h ephemeral cleanup
- `telepsicologia-webhooks`: Stream Video webhook handler for call event reconciliation
- `telepsicologia-session-metadata`: Post-call metadata capture (real times, duration, flags) and dashboard statistics

### Modified Capabilities

- `telepsicologia-data-model`: Recording-related status transitions in video_recordings table
- `whatsapp-reminders-dispatch`: When video room is created, the patient video URL becomes available for the `link_video` template variable in reminder messages
- `agenda-sessions`: Session completion (status='done') now captures video session metadata

## Impact

- **Inngest functions:** 3 new (auto-create, expiry cron, recording cleanup cron), registered in serve handler
- **Route Handler:** New `src/app/api/webhooks/stream/video/route.ts`
- **Server Actions:** `toggleRecording`, `extendSession`
- **Env vars:** `STREAM_WEBHOOK_SECRET` added to `serverEnvSchema` for webhook signature validation
- **Security:** Webhook validates Stream signature via `crypto.timingSafeEqual`. Recording requires verified consent. Room expiry prevents stale rooms from being accessible
- **LGPD:** Recording only with signed consent (Res. CFP 13/2022). Audio is ephemeral — discarded within 24h. No clinical content in logs
