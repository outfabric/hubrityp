---
name: telepsicologia-module-patterns
description: Architecture patterns, security decisions, and recurring issues for the telepsicologia (Stream.io video) module — changes 1 (data model) and 2 (psychologist call UI)
metadata:
  type: project
---

## Module structure (change 1: 2026-05-21, change 2: 2026-05-22)

- `src/modules/telepsicologia/` — domain module with `lib/schemas.ts`, `lib/video-url.ts`, `server/stream-client.ts`, `server/create-video-room.ts`, `server/get-video-token.ts`, `server/admit-patient.ts`, `server/end-video-session.ts`, `index.ts` barrel, `edge.ts` edge-safe entrypoint.
- `src/app/(app)/sessao/[id]/video/` — page.tsx (Server Component), layout.tsx (minimal chrome), actions.ts ('use server' shell), create-room-card.tsx ('use client').
- `src/modules/telepsicologia/components/` — VideoCallLoader (ssr:false wrapper), VideoCallClient, PreCallLobby, InCallView, CallControlBar, PostCallView, EndCallDialog, ConnectionQualityIndicator, ElapsedTime.
- `src/shared/db/schema/telepsicologia/` — tables, policies, index barrel.
- Three tables: `video_rooms` (full CRUD RLS), `video_session_logs` (append-only: SELECT+INSERT only), `video_recordings` (SELECT+INSERT+UPDATE, no DELETE).

## Resolved issues from change 1

- VideoRoom type collision: FIXED. `index.ts` now exports `VideoRoom` from Drizzle `$inferSelect` only. No Zod `VideoRoom` type.
- RLS user_id indexes: FIXED. `video_session_logs_user_id_idx` and `video_recordings_user_id_idx` now present in `tables.ts`.
- VideoRoom type collision confirmed resolved in review-2.

## Security patterns verified (change 2)

- All four Server Action impls (`createVideoRoomImpl`, `getVideoTokenImpl`, `admitPatientImpl`, `endVideoSessionImpl`) call `supabase.auth.getUser()` FIRST before any DB/Stream work.
- IDOR prevention: double predicate `eq(table.userId, userId)` in every Drizzle query + RLS policy as second layer.
- Stream JWT is call-scoped (`call_cids: ['default:<streamCallId>']`), 2-hour validity, minted server-side only.
- `STREAM_API_SECRET` stays server-only. `NEXT_PUBLIC_STREAM_API_KEY` is intentionally public.
- Error responses sanitized: PG error codes in server logs, user-facing strings only on client.
- No PII in logs: only `event` name and `errorCode` (PG code). No patient names, emails, UUIDs of clinical data.

## Known open issues (change 2 review findings)

### Missing DB transactions (HIGH — not yet fixed)
`admitPatientImpl` and `endVideoSessionImpl` do multiple sequential writes without `db.transaction()`:
- `admitPatientImpl`: UPDATE video_rooms + INSERT video_session_logs
- `endVideoSessionImpl`: UPDATE video_rooms + UPDATE sessions + INSERT video_session_logs
If any write after the first fails, partial state results (room ended but session still 'scheduled', or audit log missing). The Stream call `.end()` is correctly outside — it's a remote call and can't be rolled back. Fix: wrap the DB writes in `db.transaction()`, Stream call before the transaction.

### Missing E2E negative-auth test for /sessao (HIGH — not yet fixed)
`app-routes-auth-gate.spec.ts` has no case for `/sessao/*`. Integration test (`sessao-route-gating.int.test.ts`) covers the middleware logic thoroughly, but the project requires both integration AND E2E coverage for auth gates. A simple `page.goto('/sessao/fake-uuid/video') -> waitForURL('/login')` test is needed.

### onAdmitPatient prop unused in CallControlBar (MEDIUM)
The `admitPatient` Server Action is fully implemented and tested, but the UI never calls it. `CallControlBar` accepts `onAdmitPatient` in its props interface but does not destructure or invoke it. The waiting-room badge in `InCallView` is informational only. Feature is incomplete — either wire an "Admitir paciente" button or remove the prop.

### Still-open from change 1: createVideoRoom concurrent race (transaction)
Concurrent `createVideoRoom` calls for the same session both pass the idempotency read, then one hits `23505` unique constraint. The catch block returns `unknown` error instead of re-fetching the existing room.

## Stream.io client component pattern

- `VideoCallLoader` in a `'use client'` file uses `next/dynamic` with `ssr: false` — keeps Stream SDK out of SSR and other pages' initial chunk.
- Stream CSS imported inside the dynamically-loaded component only, preventing global style leakage.
- `StreamVideoClient` initialized in `useEffect`, disconnected on unmount.
- Token and apiKey passed as RSC props: necessary by design (Stream SDK requires them client-side). Token is scoped to the specific call.

## Test patterns (change 2)

- Integration: `fakeSupabaseClient(userId)` returns mock `auth.getUser()`. `runAsService` seeds fixtures. `runAsUser(userId, fn)` verifies RLS cross-user isolation.
- Unit: Stream SDK mocked via `vi.mock('@stream-io/video-react-sdk', ...)` returning mock hooks/call objects.
- Negative-auth integration test for middleware: `sessao-route-gating.int.test.ts` with `vi.mock('@/modules/registration/edge')` and `vi.mock('@/shared/supabase/middleware')`.

## Change 5 patterns (2026-05-23 — call lifecycle, recording, webhook, Inngest crons)

### Fixed from change 2
- `endVideoSessionImpl`: DB writes now wrapped in `db.transaction()`. Fixed.
- `admitPatientImpl`: DB writes now wrapped in `db.transaction()`. Fixed.

### New Inngest functions registered in /api/inngest/route.ts
- `autoCreateVideoRoom` — triggers on `agenda/session.created` and `agenda/session.updated`. Core logic extracted to `processSessionCreated` / `processSessionUpdated` functions for testability. Uses `createVideoRoomHelper` shared with the Server Action.
- `roomExpiryCron` — runs every 15 min (`TZ=America/Sao_Paulo */15 * * * *`). Two sub-steps: (1) expire rooms past `expires_at`; (2) expire active rooms empty for >5 min. Each expired room: Stream `.end()` outside tx, then `db.transaction(UPDATE + INSERT log)`.
- `recordingCleanupCron` — runs every hour. Sets `status='discarded', discarded_at=now(), audio_temp_url=null` for recordings older than 24h. Enforces RNF-09.08.

### Stream webhook handler pattern
- Route: `POST /api/webhooks/stream/video` — public route (no Supabase session), HMAC-SHA256 authenticated.
- `STREAM_WEBHOOK_SECRET` read from `serverEnv` (never `NEXT_PUBLIC_*`).
- Signature verification: reads raw body BEFORE JSON parse (prevents length-extension attacks), uses `crypto.timingSafeEqual` with Buffer coercion + try/catch for length mismatch.
- Returns 200 on all processed events (including handler errors), to prevent Stream infinite retries. Internal errors are logged without PII.
- Event routing: `call.session_ended` → UPDATE room status + INSERT log; `call.session_participant_joined/left` → INSERT log; `call.recording_started/stopped` → UPDATE video_recordings status.
- Uses service-role Drizzle client (no user session exists in webhook context). Justified and commented.

### toggleRecording Server Action pattern
- Auth: `getUser()` first.
- Zod input: `{ room_id: uuid, action: 'start' | 'stop' }`.
- IDOR prevention: Drizzle predicate `eq(videoRooms.userId, userId)` on all room queries.
- Consent check (start only): `INNER JOIN sessions JOIN patients WHERE recording_consent_signed_at IS NOT NULL AND recording_consent_revoked_at IS NULL`. If session has no patient, INNER JOIN returns null → `CONSENT_REQUIRED`. This is correct.
- Stream call (`.startRecording({ recording_type: 'audio' })`) happens OUTSIDE the DB transaction — it's a remote call that can't be rolled back.
- `recording_type: 'audio'` IS the correct Stream Node SDK parameter — it's a URL path segment in `/api/v2/video/call/{type}/{id}/recordings/{recording_type}/start`.
- DB writes (UPSERT video_recordings + UPDATE video_rooms recording_enabled + INSERT log) are wrapped in `db.transaction()`.

### extendSession Server Action pattern
- Auth: `getUser()` first.
- Zod input: `{ room_id: uuid }`.
- IDOR prevention: Drizzle predicate `eq(videoRooms.userId, userId)`.
- Status guard: room must be `'active'` (not pending/ended/expired).
- DB writes: `UPDATE expires_at = expires_at + interval '15 minutes'` + INSERT log, inside `db.transaction()`.

### createVideoRoomHelper extraction
- `src/modules/telepsicologia/server/create-video-room-helper.ts` — shared by Server Action and Inngest `autoCreateVideoRoom`.
- Marked `server-only`. Does NOT authenticate — caller responsibility.
- Concurrent race fix: 23505 (unique violation) → re-fetch existing room. If re-fetch also fails → log error + return generic error.

### WhatsApp reminder video link integration
- `fetchVideoLink(db, sessionId, appUrl)` added to `reminders-dispatcher.ts`. Queries `video_rooms` by `sessionId` only (service-role Drizzle, in cron context — no userId needed, sessionId comes from authenticated psychologist join).
- `APP_URL` env var: optional (`z.string().url().optional()`), server-only. Graceful degradation when absent.
- KNOWN ISSUE: `fetchVideoLink` is called sequentially per session in the dispatcher loop — N+1 queries. Should be batched.
- `fetchVideoLink` is not directly integration-tested (only the template variable layer is unit-tested).

### Patient recording banner gap — BLOCKER (open after change 5)
- `PatientInCallView` accepts `isRecordingActive?: boolean` prop (new in this PR).
- The only call site (`patient-video-page.tsx:252`) does NOT pass `isRecordingActive`.
- Recording state is local to the psychologist's browser; there is no mechanism (Stream custom event, Supabase Realtime, etc.) to push it to the patient's browser.
- LGPD/Res. CFP 13/2022 compliance defect: patients cannot see when they are being recorded.
- Recommended fix: emit `call.sendCustomEvent({ type: 'recording_state_changed', data: { isRecording } })` from `RecordingControls.onRecordingChange`, listen in `PatientCallContent`'s `call.on('custom', ...)` handler (same pattern as chat).

### Recording banner text bug
- `patient-in-call-view.tsx:305`: "Esta sessao esta sendo gravada" — missing cedilla (sessão) and accent (está). Legally significant text.

### env var propagation (STREAM_WEBHOOK_SECRET)
- Added to: vitest.setup.ts, integration/global-setup.ts, e2e/seeded/start-server.ts, playwright.real.config.ts, ci.yml (both build jobs), .env.example. Complete.
- APP_URL is optional so no propagation needed in test setups.

## Change 5 fixes confirmed (commit 7b131a3, review-2 iteration 2 — 2026-05-23)

### Patient recording banner (LGPD BLOCKER — FIXED)
- `RecordingControls.handleToggle` now calls `call.sendCustomEvent({ type: 'recording-state-changed', isRecording: newRecordingState })` after a successful toggle (best-effort `void .catch()`).
- `PatientCallContent` `call.on('custom')` handler now discriminates on `payload.type === 'recording-state-changed'` and calls `setIsRecording(payload.isRecording)`.
- `isRecordingActive={false}` is the correct hardcode at the `patient-video-page.tsx` call site — it's the initial state; live state is delivered via custom event.
- `RecordingStateEventPayload` and `CustomEventPayload` union added to `chat-types.ts`. Not exported from barrel (only used internally) — acceptable.
- Recording banner text fixed: "Esta sessão está sendo gravada" (cedilla + accent). Confirmed in unit test assertions.

### N+1 batch fetch (HIGH — FIXED)
- `fetchVideoLinksBatch(db, sessionIds, appUrl)` added to `reminders-dispatcher.ts`. Uses `inArray(videoRooms.sessionId, sessionIds)` — single DB query.
- `dispatchReminders` now pre-fetches all online session IDs before the session loop, then does `videoLinkMap.get(session.id) ?? null` inside the loop.
- `fetchVideoLink` (the single-session variant) remains exported and is still used by integration tests directly.
- Integration tests added for both `fetchVideoLink` (3 cases) and `fetchVideoLinksBatch` (4 cases) in `reminders-dispatcher.int.test.ts`. Thorough.

### Remaining open item after change 5
- `sendCustomEvent` is NOT asserted in any unit test — `vi.fn().mockResolvedValue(undefined)` is mocked but never checked. The entire real-time notification path to the patient is untested at the unit level.
- `RecordingStateEventPayload` is not exported from the module barrel (low priority — only used internally).

## Change 4 patterns (2026-05-23 — in-call features: chat, screen share, prontuario, troubleshooting, quality degradation)

### New components
- `chat-drawer.tsx` / `chat-input.tsx` / `chat-message-list.tsx` — ephemeral chat via `call.sendCustomEvent` / `call.on('custom', …)`.
- `screen-share-indicator.tsx` — `useScreenShareState().isMute === false` = sharing active.
- `troubleshooting-popover.tsx` — static popover; `psychologistName` prop changes step 4 for patient view.
- `prontuario-call-drawer.tsx` / `prontuario-call-content.tsx` — SCAFFOLDED BUT NOT WIRED (see open issue below).
- `connection-quality-indicator.tsx` — extended with Sonner `toast.warning` + `call.camera.selectTargetResolution({width:320,height:240})` on POOR quality, 30s debounce via module-level timestamp.

### medical-records/client.ts pattern
Added `client.ts` to `medical-records` module as client-safe entrypoint (mirrors `registration/edge.ts`). Exports only types from `evolution-types.ts`, Zod schemas, template types, and `'use client'` components (`EvolutionEditor`, `TemplateSelector`). Server barrel (`index.ts`) continues to export server-side code. When adding server-only code to a module that client components also need, always create a separate `client.ts` entrypoint.

### isChatOpenRef pattern
Both `InCallView` and `PatientCallContent` use `isChatOpenRef` (a ref synced in `useEffect`) to avoid stale closure in the `call.on('custom')` listener. This is the correct pattern for Stream SDK listeners — they register once but must read current state. Flag duplication: this pattern is copy-pasted in two places; a `useChatUnreadIndicator` hook would be cleaner.

### Debounce with module-level var + test reset function
`_resetDegradationDebounce()` is exported from `connection-quality-indicator.tsx` for test cleanup. It resets `lastDegradationToastTimestamp = 0`. Tests call this via `beforeEach`. Pattern is acceptable but leaks test concern into production file.

### Stream SDK: call.camera.selectTargetResolution
`call.camera.selectTargetResolution({ width: 320, height: 240 })` is the approved API for downgrading video resolution. Returns a Promise, called with `void`.

## Open issues after change 4 (per review-2.md — 2026-05-23)

### Prontuario drawer wiring FIXED (review-2 confirmed)
Full prop chain confirmed: `page.tsx` → `VideoCallLoader` → `VideoCallClient (CallStateRouter)` → `InCallView` → `CallControlBar` + `<ProntuarioCallDrawer>`. `isPsychologist={true}`, `isProntuarioOpen`, `onProntuarioToggle` are all passed. Two new Server Actions (`createEvolution`, `updateEvolution`) in `actions.ts` delegate to `createEvolutionImpl`/`updateEvolutionImpl` — both auth-checked with `getUser()`.

### Chat message length cap FIXED (review-2 confirmed)
`MAX_CHAT_MESSAGE_LENGTH = 2_000` constant in `chat-types.ts`. `maxLength={MAX_CHAT_MESSAGE_LENGTH}` on `<Input>` in `chat-input.tsx`. `.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH)` in `chat-drawer.tsx.handleSend`. Both psychologist and patient paths use same `ChatDrawer`/`ChatInput` components — both protected.

### Prontuario button visible but non-functional when patient is null (MEDIUM — open)
`InCallView` always passes `isPsychologist={true}` and `onProntuarioToggle` to `CallControlBar`, making the prontuario button always visible. But `<ProntuarioCallDrawer>` only renders when `patient !== null`. If `session.patientId` is null, the button appears but does nothing. Fix: pass `onProntuarioToggle={patient ? handleProntuarioToggle : undefined}`.

### MAX_CHAT_MESSAGE_LENGTH cap not unit-tested in chat-drawer.test.tsx (MEDIUM — open)
The `.slice()` safety cap in `handleSend` has no explicit test. The `maxLength` attribute test works for normal browser input, but the programmatic cap needs a test to prevent silent regression.

### Missing DB transactions (HIGH — from change 2, still not fixed)
`admitPatientImpl` + `endVideoSessionImpl` still do multi-write without `db.transaction()`. `createEvolutionImpl` and `updateEvolutionImpl` (added in change 4) correctly use `db.transaction()`.

### Still-open from change 1: createVideoRoom concurrent race (medium)
Concurrent calls hit unique constraint; catch block returns generic error instead of re-fetching.

### Missing DB transactions (HIGH — from change 2, still not fixed)
`admitPatientImpl` + `endVideoSessionImpl` still do multi-write without `db.transaction()`. Stream call ends before the transaction, so the race is acceptable only for the Stream call — DB writes must be atomic.

### Missing E2E negative-auth test for /sessao (now FIXED in change 4)
`app-routes-auth-gate.spec.ts:L75` added the test. No longer an open issue.

### Still-open from change 1: createVideoRoom concurrent race (medium)
Concurrent calls hit unique constraint; catch block returns generic error instead of re-fetching.

### onAdmitPatient wired to UI (now FIXED in change 4)
The "Admitir" button in `InCallView` now correctly calls `handleAdmitPatient`. No longer an open issue.

**Why:** Telepsicologia PRD 09 — Stream.io video calling, psychologist call UI.
**How to apply:** When reviewing change 5+ (recording, prontuario wiring), verify: (1) prontuario wiring is complete end-to-end; (2) chat length cap is added; (3) DB transactions in admitPatient/endVideoSession; (4) no new NEXT_PUBLIC_ secrets.
