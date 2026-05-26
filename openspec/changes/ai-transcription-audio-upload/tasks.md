## 1. Dependencies and rate limiting infra

- [x] 1.1 Add `file-type` to `dependencies` in `package.json`. Run `npm install`.
- [x] 1.2 Investigate whether the codebase already has a rate-limit helper (`grep -r "rateLimit\|ratelimit" src/shared/`). If absent, create `src/shared/lib/rate-limit/postgres.ts` exporting `enforceRateLimit({ key, max, windowSeconds }): Promise<{ allowed: boolean; remaining: number; resetAt: Date }>` backed by a new `rate_limits` table (small: `key text pk, window_start timestamptz, count int`) — INSERT with `ON CONFLICT DO UPDATE` math. Migration via Drizzle.
- [x] 1.3 Integration test `src/__tests__/integration/shared/rate-limit.int.test.ts`: (a) under the limit, returns `allowed:true`; (b) at the limit, returns `allowed:false`; (c) after the window rolls over, allows again; (d) concurrent requests do not under-count (verify atomically via real Postgres).

## 2. MIME magic-number validator

- [x] 2.1 Create `src/modules/ai-transcription/server/validators/mime.ts` exporting `validateAudioMagicNumbers(buffer, declaredContentType)`. Uses `fileTypeFromBuffer` from `file-type`. Normalize `audio/x-wav` ↔ `audio/wav` etc. Allowlist exactly the 5 MIMEs.
- [x] 2.2 Unit test `src/__tests__/unit/modules/ai-transcription/server/validators/mime.test.ts`: feed real fixture buffers (commit small ones to the repo or generate via test setup): (a) MP3 → ok; (b) WAV → ok; (c) M4A → ok; (d) WebM → ok; (e) MP3 disguised as `audio/wav` declared → mismatch; (f) PE/EXE bytes declared as `audio/mpeg` → mismatch; (g) random 64-byte buffer → undetected.

## 3. Server Action: `requestAudioUploadUrl`

- [x] 3.1 Create `src/modules/ai-transcription/lib/audio-input-schemas.ts` exporting `RequestAudioUploadUrlInputSchema = z.object({ patientId: PatientIdSchema, sessionId: SessionIdSchema.nullable(), contentType: z.enum([...]), sizeBytes: z.number().int().positive() })`.
- [x] 3.2 Create `src/modules/ai-transcription/server/request-audio-upload-url.ts`. Wrap implementation in a `'use server'`-callable function exported from the module barrel. Flow per the spec: getUser → safeParse → ownership → consent → contentType allowlist → size limit → rate limit → INSERT row → createSignedUploadUrl → return.
- [x] 3.3 Export from `src/modules/ai-transcription/server/index.ts` and from the module barrel.
- [x] 3.4 Unit test `src/__tests__/unit/modules/ai-transcription/server/request-audio-upload-url.test.ts` — mock auth, Drizzle, consent helper, Storage SDK, rate-limit. Cover: anonymous; IDOR; consent inactive; content type rejected; size exceeded; rate-limited; happy path (assert row inserted with status='pending' and URL TTL ≤ 5 min); ensure `objectKey` regex matches the spec.
- [x] 3.5 Integration test `src/__tests__/integration/ai-transcription/request-audio-upload-url.int.test.ts` (Testcontainers + Drizzle + a mocked Storage SDK at module level): assert the row exists post-call; assert calling 7 times in 60s returns RATE_LIMITED on the 7th; cross-tenant assertion (B requesting URL for A's patient → NOT_FOUND, zero rows inserted).

## 4. Server Action: `confirmAudioUpload`

- [ ] 4.1 Create `src/modules/ai-transcription/server/confirm-audio-upload.ts`. Flow per spec: getUser → safeParse → ownership → re-check consent → download first 8KB → magic-number validate → getMetadata for size → update row → dispatch event.
- [ ] 4.2 Define `audioUploadedEventSchema` in `src/modules/ai-transcription/inngest/events.ts` (extending the file created in `ai-transcription-consent`). Wrap `inngest.send` with try/catch; validate with Zod before send.
- [ ] 4.3 Update `src/modules/ai-transcription/server/index.ts` to export `confirmAudioUpload`.
- [ ] 4.4 Unit test `src/__tests__/unit/modules/ai-transcription/server/confirm-audio-upload.test.ts` — mock auth, Drizzle, Storage, consent, rate. Cover all spec scenarios: happy; magic mismatch (assert row.status='failed', error_code='invalid_mime', NO event); consent revoked between (assert error_code='consent_revoked_during_upload'); double-confirm idempotency; IDOR.
- [ ] 4.5 Integration test `src/__tests__/integration/ai-transcription/confirm-audio-upload.int.test.ts`: actual upload to a test bucket; assert real magic-number detection; assert event dispatched (capture via Inngest test mode); cross-tenant assertion.

## 5. Inngest event schemas + audio-uploaded stub

- [ ] 5.1 In `src/modules/ai-transcription/inngest/events.ts`, add `audioUploadedEventSchema` and `recordingCompletedEventSchema` per spec. Export TS types via `z.infer`.
- [ ] 5.2 Create `src/modules/ai-transcription/inngest/on-audio-uploaded-stub.ts` defining `onAudioUploadedStub` that only logs `{ event: 'ai-transcription/audio.uploaded.received', transcriptionId, userId }`.
- [ ] 5.3 Register `onAudioUploadedStub` (and the upcoming `ingestStreamRecording`) in `src/app/api/inngest/route.ts`.
- [ ] 5.4 Unit test `src/__tests__/unit/modules/ai-transcription/inngest/events.test.ts` (extends the file from the consent change): assert both new schemas accept valid payloads and reject malformed ones (missing fields, invalid URL, invalid UUID).

## 6. Inngest function: `ingestStreamRecording`

- [ ] 6.1 Create `src/modules/ai-transcription/inngest/ingest-stream-recording.ts` with steps per spec: `assert-consent`, `create-row`, `download-from-stream`, `upload-to-bucket`, `update-row`, `emit-uploaded`, `instruct-stream-delete`.
- [ ] 6.2 SSRF guard: define a constant `STREAM_HOST_ALLOWLIST = ['stream-io-cdn.com', '...']` (verify exact hostnames in Stream docs via Context7 or `gemini-api-dev`/Stream docs); the download step uses `new URL(streamRecordingUrl)` and rejects if `url.hostname` not in the allowlist OR if it resolves to a private IP (use a helper `isPublicIPv4(host)`).
- [ ] 6.3 Service-role Storage client usage for the PUT — wrap in a comment: `// service-role used here: system job, no user input controls the path (path is server-generated)`.
- [ ] 6.4 Unit test `src/__tests__/unit/modules/ai-transcription/inngest/ingest-stream-recording.test.ts` — mock fetch (the Stream download), Storage, Drizzle, consent helper. Cover: happy path; consent inactive at ingest (row NOT created, no bytes downloaded); SSRF — hostname not in allowlist; SSRF — host resolves to private IP; Stream returns 500 (retried per Inngest); corrupted file (magic-number fails) → row.status='failed'.
- [ ] 6.5 Integration test `src/__tests__/integration/ai-transcription/ingest-stream-recording.int.test.ts` — uses a local HTTP server simulating Stream's CDN; uses real Testcontainers Postgres and a test bucket; asserts the row, the bucket object, the event.

## 7. Refactor `toggle-recording.ts`

- [ ] 7.1 In `src/modules/telepsicologia/server/toggle-recording.ts`, add `assertAiConsentActive` import and a call before `call.startRecording`. Combine with the existing legacy check via AND. Both negative → return `CONSENT_INVALID` error.
- [ ] 7.2 Update the function's JSDoc to document the dual-gate behavior. Add a comment block explaining the MVP transition strategy and pointing to the OpenSpec change `ai-transcription-consent`.
- [ ] 7.3 Update existing unit tests `src/__tests__/unit/modules/telepsicologia/server/toggle-recording*.test.ts` (or create one) to cover: (a) both gates pass; (b) legacy fails; (c) ai term fails; (d) both fail.
- [ ] 7.4 Integration test `src/__tests__/integration/telepsicologia/toggle-recording-dual-gate.int.test.ts`: 4 patient × user combinations of (legacy y/n) × (ai-term y/n); assert only (y, y) calls `call.startRecording` (mocked); assert the others return `CONSENT_INVALID` without touching Stream.

## 8. Update `recording-cleanup` to emit `recording.completed`

- [ ] 8.1 Read `src/modules/telepsicologia/inngest/recording-cleanup.ts` end-to-end. Identify the point where Stream signals completion (likely after polling/`status='ready'`).
- [ ] 8.2 At that point, validate payload with `recordingCompletedEventSchema.parse`, dispatch `ai-transcription/recording.completed` via fire-and-forget. Idempotency: only dispatch when the local row transitions to a terminal state — guarded by an existing column (e.g., `processed_ingest_dispatched_at` could be added if necessary, or detect via existing state). Choose the cheapest correct approach and document in code.
- [ ] 8.3 Unit test `src/__tests__/unit/modules/telepsicologia/inngest/recording-cleanup-emit.test.ts`: dispatched once per terminal transition; not dispatched on retries after dispatch; emit failure does not break cleanup.
- [ ] 8.4 Integration test `src/__tests__/integration/telepsicologia/recording-cleanup-emit.int.test.ts` — uses local Inngest dev runtime; verifies the event reaches the queue.

## 9. UI — `AudioUploadSheet`

- [ ] 9.1 Create `src/modules/ai-transcription/components/audio-upload-sheet.tsx` per spec. Use shadcn `Sheet`, `Alert`, `Button`, `Progress`, `Input` (file). Microcopy in pt-BR per Sálvia glossary.
- [ ] 9.2 Create a small `audio-upload-button.tsx` entry component that opens the sheet — embedded in `pacientes/[id]/page.tsx` next to the consent panel, AND on the session detail page (where applicable).
- [ ] 9.3 Use TanStack Query: `useQuery(['ai-consent', patientId])` to drive the gate; `useMutation` for `requestAudioUploadUrl` and `confirmAudioUpload`. Optimistic UI for the "uploading" state. Sonner toasts for success/failure with humanized pt-BR messages.
- [ ] 9.4 Use `XMLHttpRequest` for the PUT to capture `upload.onprogress`. Wrap in a Promise. Update progress bar state. On error: call `confirmAudioUpload` is SKIPPED (no row update via this endpoint — the row's `status` remains `pending` and the discard cron will catch it; document this in code).
- [ ] 9.5 Unit test `src/__tests__/unit/modules/ai-transcription/components/audio-upload-sheet.test.tsx`: (a) consent inactive → no dropzone, warning rendered; (b) consent active → dropzone visible; (c) selecting a file shows metadata; (d) confirm calls the actions in the right order; (e) PUT failure → error toast; (f) success → success toast and sheet closes; (g) keyboard nav passes axe-core.

## 10. End-to-end and security tests

- [ ] 10.1 E2E test (Playwright seeded) `src/__tests__/e2e/seeded/ai-transcription/manual-upload-flow.spec.ts`: psychologist logs in → opens patient with active AI term → opens audio sheet → uploads a small valid MP3 fixture → assertion: toast appears, row in `ai_transcriptions` exists with `status='pending'` and `audio_object_key` set. Test in pt-BR locale.
- [ ] 10.2 E2E negative `src/__tests__/e2e/seeded/ai-transcription/manual-upload-no-consent.spec.ts`: same flow but patient has no active term → sheet shows warning, no dropzone.
- [ ] 10.3 Integration security test `src/__tests__/integration/ai-transcription/upload-security.int.test.ts`: (a) anonymous request to `requestAudioUploadUrl` rejected; (b) `objectKey` regex check on 10 generated URLs (no PII leak); (c) signed URL TTL expires within 5 minutes (assert by waiting + retrying — keep test short by stubbing time or using a short TTL fixture); (d) cross-tenant IDOR on `confirmAudioUpload` rejected with `NOT_FOUND`.
- [ ] 10.4 SSRF unit test specifically for `ingestStreamRecording`: feed payloads with `http://127.0.0.1`, `http://169.254.169.254`, `http://[::1]`, `http://10.0.0.1`, plus a malicious public hostname not in the allowlist; assert each is rejected without making a network call.

## 11. Sanity and docs

- [ ] 11.1 Run `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e:seeded`. All green.
- [ ] 11.2 Update `docs/runbooks/` (or create `docs/runbooks/ai-transcription-upload.md`) with: (a) what to do if a patient has legacy consent but no AI term (the psychologist must generate the AI term); (b) the discard policy (24h) and how to inspect via SQL; (c) error codes glossary.
- [ ] 11.3 Update the PR description checklist with the security review items: SSRF allowlist verified; rate-limit verified; signed URL TTL verified; magic-number validator covers the 5 allowed MIMEs.
