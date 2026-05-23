## 1. Middleware — explicit public classification for `/v`

- [x] 1.1 In `src/middleware.ts:classifyPath()`, add an explicit `'public'` classification for `/v` prefix (same pattern as `/escala`). Comment: "Public patient video join page — token in URL is the auth credential, not a Supabase session"
- [x] 1.2 **Integration test:** Create `src/__tests__/integration/middleware/video-join-public.int.test.ts` — verify: GET `/v/some-token` is classified as public (no redirect to login), unauthenticated access passes through

## 2. Route Handler — token validation (`POST /api/video/join`)

- [x] 2.1 Create `src/app/api/video/join/route.ts` — POST Route Handler: (1) parse + validate body with Zod ({ token: z.string().length(64).regex(/^[a-f0-9]+$/) }), (2) create service-role Supabase client (justified comment: patient has no Supabase session), (3) query video_rooms WHERE patient_token = input.token OR partner_token = input.token, (4) if not found: return 404 { error: 'NOT_FOUND' }, (5) determine status: if room.status='ended' or 'expired' -> 410 { error: 'SESSION_ENDED' }; if now < room.available_from -> 200 { status: 'too_early', sessionStartAt, psychologistName, psychologistPhotoUrl }; if room.status='active' -> 200 { status: 'active', streamToken, apiKey, callId, ... }; else -> 200 { status: 'waiting', ... }. (6) Load psychologist profile (name, photo) via join. (7) Return streamToken from patient_jwt or partner_jwt based on which token matched. Never expose internal IDs, session content, or patient data in response
- [x] 2.2 **Integration test:** Create `src/__tests__/integration/telepsicologia/video-join-handler.int.test.ts` — tests against real Postgres: valid token returns 200 with correct status, invalid token returns 404, expired room returns 410, too-early returns status 'too_early' with session time, active room returns stream token, partner_token resolves correctly, malformed token (wrong length) returns 400

## 3. Route Handler — patient event logging (`POST /api/video/log`)

- [x] 3.1 Create `src/app/api/video/log/route.ts` — POST Route Handler: (1) validate body with Zod ({ token: z.string().length(64).regex(/^[a-f0-9]+$/), event_type: z.enum(['patient_joined','patient_left','partner_joined','partner_left','connection_drop','reconnected']), metadata: z.record(z.string()).optional() }), (2) service-role Supabase to look up video_rooms by token, (3) if not found or room ended: return 404, (4) INSERT into video_session_logs with user_id from room, session_id from room, event_type, participant_role derived from which token matched, metadata (no PII), (5) return 200. Rate-limit: max 10 calls per token per minute
- [x] 3.2 **Integration test:** Create `src/__tests__/integration/telepsicologia/video-log-handler.int.test.ts` — valid token + valid event_type inserts log row, invalid token returns 404, invalid event_type returns 400, ended room returns 404

## 4. Patient video join page — Server Component

- [ ] 4.1 Create `src/app/v/[token]/page.tsx` — Server Component: (1) extract token from params, (2) validate token format (64-char hex), (3) render PatientVideoPage client component passing the token. No data loading here — the client component calls the Route Handler. This is a thin RSC shell for the public page
- [ ] 4.2 Create `src/app/v/[token]/layout.tsx` — minimal layout: no app shell, no sidebar. Clean page with only the video content. Meta tags for SEO: title "Sessao de video", noindex
- [ ] 4.3 Create `src/app/v/[token]/not-found.tsx` — custom 404: "Link de sessao invalido. Verifique o link ou entre em contato com seu psicologo."

## 5. Patient video client components

- [ ] 5.1 Create `src/modules/telepsicologia/components/patient-video-page.tsx` — `'use client'` component. Props: { token }. (1) On mount, POST to /api/video/join with token, (2) render based on status: too_early -> TooEarlyView, waiting -> WaitingRoomView (poll every 10s), active -> PatientInCallView, ended/expired -> SessionEndedView. (3) Handle fetch errors gracefully
- [ ] 5.2 Create `src/modules/telepsicologia/components/browser-check.tsx` — `'use client'` component. Checks navigator.mediaDevices and RTCPeerConnection existence. If unsupported: show "Seu navegador nao e compativel" message with links to Chrome/Firefox download. Renders children only if compatible
- [ ] 5.3 Create `src/modules/telepsicologia/components/too-early-view.tsx` — `'use client'` component. Props: { psychologistName, psychologistPhotoUrl, sessionStartAt }. Shows centered card with psychologist avatar, session time, "Volte 10 minutos antes" message. Optional "Testar camera e microfone" button that opens device test inline
- [ ] 5.4 Create `src/modules/telepsicologia/components/waiting-room-view.tsx` — `'use client'` component. Props: { psychologistName, psychologistPhotoUrl, token }. Shows psychologist info + "Aguarde" message. Polls /api/video/join every 10s. When status changes to 'active', transitions to PatientInCallView. Device check summary (camera/mic indicators). Pulsing dot animation (respects prefers-reduced-motion)
- [ ] 5.5 Create `src/modules/telepsicologia/components/patient-in-call-view.tsx` — `'use client'` component. Props: { streamToken, apiKey, callId, psychologistName }. Initializes StreamVideoClient with patient user { id: 'patient-xxx', name: 'Paciente' }. Joins call. Layout: psychologist video large, patient PiP bottom-right. Controls: mic toggle, camera toggle, "Sair" button (danger). Connection quality indicator (reuse). On call end (psychologist ends): transition to ended view. Logs patient_joined/patient_left via /api/video/log
- [ ] 5.6 Create `src/modules/telepsicologia/components/session-ended-view.tsx` — `'use client'` component. Props: { psychologistName }. Shows "Sessao encerrada" + "Se precisar reagendar, entre em contato com [Psicologo]." No action buttons
- [ ] 5.7 Create `src/modules/telepsicologia/components/device-test.tsx` — `'use client'` component. Camera preview + mic level indicator. Permission request with troubleshooting instructions if denied. Reusable by both psychologist lobby (change 2) and patient too-early/waiting views

## 6. Unit tests

- [ ] 6.1 **Unit test:** Create `src/__tests__/unit/modules/telepsicologia/components/patient-video-page.test.tsx` — mock fetch. Tests: renders too-early view when status='too_early', renders waiting room when status='waiting', renders in-call when status='active', renders ended view when status='ended', handles 404 from API (invalid token), handles network error gracefully
- [ ] 6.2 **Unit test:** Create `src/__tests__/unit/modules/telepsicologia/components/browser-check.test.tsx` — mock navigator. Tests: renders children when WebRTC supported, shows incompatible message when not supported

## 7. E2E test

- [ ] 7.1 **E2E test:** Create `src/__tests__/e2e/seeded/telepsicologia/patient-join-flow.spec.ts` — seed: psychologist + patient + online session + video_room with patient_token. Mock Stream SDK via page.route() to intercept Stream API calls. Flow: navigate to /v/[token], verify waiting room renders with psychologist name, simulate room status change to 'active' (update DB directly), verify in-call UI renders with controls (mic, camera, leave). Mark Stream-dependent assertions clearly for mock review

## 8. Module barrel update

- [ ] 8.1 Update `src/modules/telepsicologia/index.ts` — add re-exports for patient components (PatientVideoPage, BrowserCheck, TooEarlyView, WaitingRoomView, PatientInCallView, SessionEndedView, DeviceTest)
