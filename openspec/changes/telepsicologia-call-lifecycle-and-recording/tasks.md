## 1. Env vars and dependencies

- [x] 1.1 Add `STREAM_WEBHOOK_SECRET` (z.string().min(1)) to `serverEnvSchema` in `src/shared/env/schemas.ts`. Add to `.env.example`

## 2. Inngest function — auto-create video room

- [x] 2.1 Extract room creation logic from `createVideoRoom` Server Action (change 1) into a shared helper `src/modules/telepsicologia/server/create-video-room-helper.ts` — pure function that takes (streamClient, sessionData, patientData, supabaseClient) and returns the created room. The Server Action delegates to this helper after auth; the Inngest function calls it directly with service-role
- [x] 2.2 Create `src/modules/telepsicologia/inngest/auto-create-room.ts` — Inngest function triggered by `agenda/session.created` and `agenda/session.updated`. Steps: (1) check event.data.modality === 'online', (2) check event.data.status IN ('scheduled', 'confirmed'), (3) check no existing video_rooms for this session_id (idempotent), (4) call createVideoRoomHelper with service-role client (justified: system job, not user-initiated), (5) if session was updated from online to in_person: UPDATE existing video_rooms SET status='expired'. Retries: 3 with backoff
- [x] 2.3 **Integration test:** Create `src/__tests__/integration/telepsicologia/auto-create-room.int.test.ts` — mock Stream SDK. Tests: online session creation triggers room creation, non-online session skipped, existing room not duplicated (idempotent), session updated to in_person expires room, cancelled session not processed

## 3. Inngest cron — room expiry

- [x] 3.1 Create `src/modules/telepsicologia/inngest/room-expiry.ts` — Inngest cron `*/15 * * * *` TZ=America/Sao_Paulo. Steps: (1) query video_rooms WHERE status IN ('pending', 'active') AND expires_at < NOW(), (2) for each: end Stream call (try/catch), UPDATE status='expired', INSERT video_session_logs event_type='room_expired'. (3) Also check for "5 min empty" rooms: query video_rooms WHERE status='active', then check video_session_logs for rooms where last event is *_left with no subsequent *_joined and created_at > 5 min ago -> expire these too
- [x] 3.2 **Integration test:** Create `src/__tests__/integration/telepsicologia/room-expiry.int.test.ts` — mock Stream SDK. Tests: expired room gets status='expired' + log entry, active room not yet expired is skipped, empty-for-5min room is expired, already-ended room is skipped

## 4. Inngest cron — recording cleanup

- [x] 4.1 Create `src/modules/telepsicologia/inngest/recording-cleanup.ts` — Inngest cron `0 * * * *` (hourly). Steps: (1) query video_recordings WHERE status IN ('processing', 'transcribed') AND recorded_at < NOW() - INTERVAL '24 hours', (2) for each: UPDATE status='discarded', discarded_at=NOW(), audio_temp_url=NULL, (3) log count of discarded recordings (metadata only, no PII)
- [x] 4.2 **Integration test:** Create `src/__tests__/integration/telepsicologia/recording-cleanup.int.test.ts` — tests: recording older than 24h is discarded, recording younger than 24h is skipped, recording with status='idle' is skipped, discarded recording has audio_temp_url set to null

## 5. Stream webhook handler

- [x] 5.1 Create `src/app/api/webhooks/stream/video/route.ts` — POST Route Handler: (1) read raw body, (2) validate signature using STREAM_WEBHOOK_SECRET + crypto.timingSafeEqual (consult Stream docs for exact algorithm at implementation time), (3) parse payload, (4) route by event type: call.session_ended -> update room status + log, call.session_participant_joined -> log, call.session_participant_left -> log, call.recording_started -> update recording status, call.recording_stopped -> update recording status. (5) Return 200. Use service-role for DB writes (justified: webhook from external service). Never log payload content (may contain participant info)
- [x] 5.2 **Integration test:** Create `src/__tests__/integration/telepsicologia/stream-webhook.int.test.ts` — tests: valid signature + call.session_ended updates room status, valid signature + participant_joined inserts log, invalid signature returns 403, malformed payload returns 400, duplicate event is idempotent

## 6. Server Actions — toggleRecording + extendSession

- [x] 6.1 Create `src/modules/telepsicologia/server/toggle-recording.ts` — Server Action: (1) authenticate via supabase.auth.getUser(), (2) validate input (room_id, action: 'start'|'stop'), (3) verify room ownership, (4) if start: check patient recording_consent_signed_at IS NOT NULL AND recording_consent_revoked_at IS NULL, if consent invalid return { ok: false, code: 'CONSENT_REQUIRED' }, (5) if start: call Stream startRecording(), UPSERT video_recordings with status='recording', UPDATE video_rooms SET recording_enabled=true, INSERT log event_type='recording_started', (6) if stop: call Stream stopRecording(), UPDATE video_recordings status='processing', UPDATE video_rooms SET recording_enabled=false, INSERT log event_type='recording_ended', (7) return { ok: true }
- [x] 6.2 Create `src/modules/telepsicologia/server/extend-session.ts` — Server Action: (1) authenticate, (2) validate input (room_id), (3) verify room ownership and status='active', (4) UPDATE video_rooms SET expires_at = expires_at + INTERVAL '15 minutes', (5) INSERT video_session_logs event_type='session_extended', (6) return { ok: true }
- [x] 6.3 **Integration test:** Create `src/__tests__/integration/telepsicologia/toggle-recording.int.test.ts` — mock Stream SDK. Tests: start recording with valid consent succeeds, start recording without consent returns CONSENT_REQUIRED, start recording with revoked consent returns CONSENT_REQUIRED, stop recording succeeds, room not owned -> rejected, unauthenticated -> rejected
- [x] 6.4 **Integration test:** Create `src/__tests__/integration/telepsicologia/extend-session.int.test.ts` — tests: happy path extends expires_at by 15 min + logs event, room not active -> rejected, room not owned -> rejected

## 7. WhatsApp video link integration

- [ ] 7.1 Update `src/modules/whatsapp/lib/reminders/select-template-variables.ts` — when kind includes video link (kind='video' or session.modality='online'), query video_rooms for the session and populate `link_video` variable with `generatePatientVideoUrl(baseUrl, room.patient_token)`. If no room exists yet (auto-creation may not have fired), return empty string for link_video (the reminder sender will skip the video template and fall back to the standard reminder)
- [ ] 7.2 **Unit test:** Update `src/__tests__/unit/modules/whatsapp/lib/reminders/select-template-variables.test.ts` — add test: when video room exists for online session, link_video is populated with correct URL format. When no room exists, link_video is empty

## 8. Post-call metadata capture

- [ ] 8.1 Create `src/modules/telepsicologia/server/capture-session-metadata.ts` — helper function called when session transitions to 'done' (from endVideoSession or webhook). Queries video_session_logs for the session, computes: real_start (first therapist_joined), real_end (last room_ended/room_expired), effective_duration, had_recording (boolean), had_screen_share (boolean). Inserts a video_session_logs entry with event_type='session_summary' and metadata containing these fields
- [ ] 8.2 Update `src/modules/telepsicologia/server/end-video-session.ts` (change 2) — after marking session as done, call captureSessionMetadata
- [ ] 8.3 Create `src/modules/telepsicologia/server/get-online-session-stats.ts` — Server Action: authenticate, query sessions WHERE status='done' AND modality='online' AND start_at between month start/end, return { onlineCount, totalDoneCount, percentage }. For dashboard display (RF-09.29)
- [ ] 8.4 **Integration test:** Create `src/__tests__/integration/telepsicologia/session-metadata.int.test.ts` — seed session + logs, call captureSessionMetadata, verify summary log entry with correct computed values

## 9. Recording UI controls (psychologist side)

- [ ] 9.1 Create `src/modules/telepsicologia/components/recording-controls.tsx` — `'use client'` component. "Gravar sessao" toggle button in CallControlBar. States: disabled (no consent, tooltip "Paciente nao assinou termo de gravacao"), enabled idle (consent valid, "Iniciar gravacao"), recording (red dot + "Gravando" indicator + "Parar gravacao"). Patient sees banner "Esta sessao esta sendo gravada" (RF-09.20). Calls toggleRecording Server Action. If PRD 10 not implemented yet, show "Em breve" (RF-09.22)
- [ ] 9.2 Update `src/modules/telepsicologia/components/call-control-bar.tsx` — integrate RecordingControls
- [ ] 9.3 Update `src/modules/telepsicologia/components/patient-in-call-view.tsx` — show "Esta sessao esta sendo gravada" banner (Alert danger-50 + danger-700 text) when room.recording_enabled=true
- [ ] 9.4 **Unit test:** Create `src/__tests__/unit/modules/telepsicologia/components/recording-controls.test.tsx` — mock Server Action. Tests: disabled state when no consent (tooltip visible), start recording calls action, recording indicator visible when recording, stop recording calls action, patient banner visible when recording enabled

## 10. Inngest serve handler registration

- [ ] 10.1 Update `src/app/api/inngest/route.ts` — register all new Inngest functions: auto-create-room, room-expiry, recording-cleanup

## 11. Module barrel update

- [ ] 11.1 Update `src/modules/telepsicologia/index.ts` — add re-exports for: toggleRecording, extendSession, getOnlineSessionStats, RecordingControls, captureSessionMetadata, createVideoRoomHelper, Inngest function references
