# ai-transcription-audio-upload Specification

## Purpose

Audio upload and ingestion pipeline for the AI transcription module. Provides two intake paths: (1) manual upload by the psychologist via a signed-URL flow (request → PUT → confirm), and (2) automatic ingestion of video-session recordings from Stream via an Inngest function. Both paths gate on active AI consent, validate audio MIME via magic-number inspection, and emit the `ai-transcription/audio.uploaded` event for downstream processing.

## Requirements

### Requirement: `requestAudioUploadUrl` Server Action produces a server-controlled signed URL

The system SHALL expose `requestAudioUploadUrl({ patientId, sessionId, contentType, sizeBytes }): Promise<RequestAudioUploadUrlResult>` from `@/modules/ai-transcription`, where:

```ts
type RequestAudioUploadUrlResult =
  | { ok: true; transcriptionId: TranscriptionId; uploadUrl: string; expiresAt: Date; objectKey: string }
  | { ok: false; code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'CONSENT_INACTIVE' | 'CONTENT_TYPE_NOT_ALLOWED' | 'SIZE_EXCEEDED' | 'RATE_LIMITED' };
```

The action SHALL:

1. Authenticate via `supabase.auth.getUser()`.
2. Run `RequestAudioUploadUrlInputSchema.safeParse(input)`.
3. Confirm `patientId` belongs to caller (RLS-scoped Drizzle SELECT); `sessionId` (if not null) belongs to the same caller AND the same patient.
4. Call `assertAiConsentActive({ userId, patientId })`; if not `ok: true`, return `CONSENT_INACTIVE` (no DB write).
5. Reject `contentType` not in the allowlist `['audio/mpeg','audio/mp4','audio/wav','audio/webm','audio/x-m4a']`.
6. Reject `sizeBytes > AI_TRANSCRIPTION_MAX_AUDIO_MB * 1024 * 1024`.
7. Check rate limit (6 requests / minute / user); if exceeded, return `RATE_LIMITED`.
8. INSERT a row in `ai_transcriptions` with `status='pending'`, `source='manual_upload'`, `user_id`, `patient_id`, `session_id` (nullable), `audio_size_bytes` (declared), `audio_object_key=NULL` (set on confirm).
9. Generate signed upload URL for `<userId>/<transcriptionId>.<ext>` where `ext` is derived from the allowlisted `contentType` (e.g., `audio/mpeg → mp3`); TTL = 5 minutes; `upsert=false`.
10. Return URL + metadata.

#### Scenario: Happy path
- **WHEN** the authenticated psychologist requests an upload URL for their own patient with valid declared `contentType` and `sizeBytes`
- **THEN** a row is INSERTed with `status='pending'`
- **AND** a signed URL is returned with TTL ≤ 5 minutes
- **AND** the `objectKey` starts with the caller's `userId`

#### Scenario: Anonymous
- **GIVEN** no session cookie
- **WHEN** the action is invoked
- **THEN** returns `{ ok: false, code: 'UNAUTHORIZED' }`
- **AND** no row is inserted

#### Scenario: IDOR — patient of another tenant
- **WHEN** psychologist B requests an URL with `patientId` belonging to A
- **THEN** returns `{ ok: false, code: 'NOT_FOUND' }`
- **AND** no row is inserted

#### Scenario: No active AI consent
- **GIVEN** the patient has no signed `ai_recording` term (or it's revoked)
- **WHEN** the action runs
- **THEN** returns `{ ok: false, code: 'CONSENT_INACTIVE' }`
- **AND** no row is inserted
- **AND** no signed URL is generated

#### Scenario: Content type not allowed
- **WHEN** `contentType = 'application/x-msdownload'`
- **THEN** returns `{ ok: false, code: 'CONTENT_TYPE_NOT_ALLOWED' }`
- **AND** Zod validation logged WITHOUT including the raw input

#### Scenario: Size too large
- **GIVEN** `AI_TRANSCRIPTION_MAX_AUDIO_MB = 200`
- **WHEN** `sizeBytes = 210 * 1024 * 1024`
- **THEN** returns `{ ok: false, code: 'SIZE_EXCEEDED' }`

#### Scenario: Rate limit
- **GIVEN** the same user made 6 successful calls in the last minute
- **WHEN** the 7th call happens
- **THEN** returns `{ ok: false, code: 'RATE_LIMITED' }`

#### Scenario: Object key never includes PII
- **WHEN** the URL is generated
- **THEN** the `objectKey` matches `^[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp3|m4a|wav|webm)$` (UUIDs and an allowlisted extension; no name, no email)

### Requirement: `confirmAudioUpload` validates the real MIME and finalizes the row

The system SHALL expose `confirmAudioUpload({ transcriptionId, audioDurationSeconds }): Promise<ConfirmAudioUploadResult>`. The action SHALL:

1. Authenticate; `safeParse` input.
2. SELECT the `ai_transcriptions` row via RLS-scoped client; require `status='pending'` and `user_id = caller`.
3. Re-validate `assertAiConsentActive` for the row's `patientId` (consent might have been revoked between request and confirm); if inactive, set `status='failed'`, `error_code='consent_revoked_during_upload'`, schedule object deletion, return `{ ok: false, code: 'CONSENT_INACTIVE' }`.
4. Read the first 8KB of the object via Storage `download` with `Range: bytes=0-8191`.
5. Run `fileTypeFromBuffer(buffer)` (the `file-type` library). If undefined OR not in the allowlist OR not matching the declared `contentType`, set `status='failed'`, `error_code='invalid_mime'`, schedule object deletion, return `{ ok: false, code: 'INVALID_MIME' }`.
6. Confirm object size via Storage `getMetadata`. If size mismatches declared by >5% or > MAX, mark failed.
7. UPDATE the row: `audio_object_key=<key>`, `audio_size_bytes=<actual>`, `audio_duration_seconds=<best-effort>`.
8. Dispatch `inngest.send({ name: 'ai-transcription/audio.uploaded', data: { transcriptionId, userId, patientId, source: 'manual_upload' } })` with Zod validation; fire-and-forget.
9. Return `{ ok: true, transcriptionId }`.

#### Scenario: Happy path
- **WHEN** the upload succeeded and `confirmAudioUpload` is called
- **THEN** the row is updated and the event is dispatched
- **AND** `status` remains `pending` (the event consumer will transition to `transcribing`)

#### Scenario: Magic number mismatch
- **GIVEN** the uploaded object's first bytes do not match the declared MIME
- **WHEN** confirm runs
- **THEN** `status='failed'`, `error_code='invalid_mime'`
- **AND** the object is enqueued for deletion (job scheduled in `audio_discarded_at` plan)
- **AND** the dispatcher event is NOT sent
- **AND** the return is `{ ok: false, code: 'INVALID_MIME' }`

#### Scenario: Consent revoked between request and confirm
- **GIVEN** the user revoked the AI term while the upload was in flight
- **WHEN** confirm runs
- **THEN** `status='failed'`, `error_code='consent_revoked_during_upload'`
- **AND** object deletion is scheduled
- **AND** no event is dispatched

#### Scenario: Replaying confirm is idempotent
- **WHEN** `confirmAudioUpload` is called twice with the same `transcriptionId`
- **THEN** the second call returns `{ ok: false, code: 'ALREADY_CONFIRMED' }`
- **AND** does NOT dispatch a second event
- **AND** does NOT re-check magic numbers

#### Scenario: Confirm on someone else's row (IDOR)
- **WHEN** psychologist B calls confirm with the `transcriptionId` of A's row
- **THEN** returns `{ ok: false, code: 'NOT_FOUND' }`
- **AND** no row changes

### Requirement: Magic-number MIME validator is centralized

The system SHALL expose `validateAudioMagicNumbers(buffer: Buffer | Uint8Array, declaredContentType: string): { ok: true; detected: string } | { ok: false; reason: 'undetected' | 'mismatch' | 'not_allowed' }` from `src/modules/ai-transcription/server/validators/mime.ts`. The validator SHALL use the `file-type` library (server-only) and SHALL accept ONLY: `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/webm`, `audio/x-m4a` (with normalization — e.g., `file-type` may return `audio/x-wav` for `.wav`).

#### Scenario: Allowlisted format detected
- **GIVEN** a real `.mp3` file's first 8KB
- **WHEN** `validateAudioMagicNumbers(buf, 'audio/mpeg')` runs
- **THEN** returns `{ ok: true, detected: 'audio/mpeg' }`

#### Scenario: Disguised executable
- **GIVEN** a buffer starting with `MZ` (Windows PE header) but `declaredContentType = 'audio/mpeg'`
- **WHEN** the validator runs
- **THEN** returns `{ ok: false, reason: 'mismatch' }` (or `'not_allowed'` — both are acceptable; the test asserts not `ok: true`)

#### Scenario: Truncated buffer
- **GIVEN** a buffer of 64 bytes (less than typical MP3 header)
- **WHEN** the validator runs
- **THEN** returns `{ ok: false, reason: 'undetected' }`

### Requirement: `ingestStreamRecording` Inngest function brings video-session audio into the system

The system SHALL define `ingestStreamRecording` at `src/modules/ai-transcription/inngest/ingest-stream-recording.ts`, triggered by the Inngest event `telepsicologia/recording.completed` (payload schema: `{ userId, patientId, sessionId, streamRecordingUrl, streamCallId }`). The function SHALL:

1. Step `assert-consent`: call `assertAiConsentActive`. If not active: log `consent_inactive_at_ingest` (with IDs only), attempt to instruct Stream to delete the recording (best-effort), `return { skipped: 'consent_inactive' }`.
2. Step `create-row`: INSERT into `ai_transcriptions` with `status='pending'`, `source='video_session'`, IDs. Returns the new `transcriptionId`.
3. Step `download-from-stream`: fetch the Stream URL (SSRF-safe — only the allowed Stream host). Streaming, not buffering.
4. Step `upload-to-bucket`: PUT the bytes into `<userId>/<transcriptionId>.webm` via service-role Storage client (justified by comment — system job).
5. Step `update-row`: set `audio_object_key`, `audio_size_bytes`, `audio_duration_seconds` if extractable.
6. Step `emit-uploaded`: `inngest.send({ name: 'ai-transcription/audio.uploaded', data: { transcriptionId, userId, patientId, source: 'video_session' } })`.
7. Step `instruct-stream-delete`: best-effort delete of the Stream-side recording.

Each step has its own retry counter (Inngest default 4). If any step fails after retries, the row's `status='failed'` with `error_code='stream_ingest_failed'`.

#### Scenario: Happy path
- **WHEN** the function runs for a valid event
- **THEN** the audio is in our bucket
- **AND** the row is `pending` (the next change will pick it up)
- **AND** the `audio.uploaded` event is dispatched

#### Scenario: Consent revoked between session end and ingest
- **WHEN** consent is inactive at ingest time
- **THEN** no row is created in `ai_transcriptions`
- **AND** no bytes are downloaded
- **AND** Stream is instructed to delete the recording
- **AND** a single log line `consent_inactive_at_ingest` (IDs only) is emitted

#### Scenario: SSRF protection
- **GIVEN** an attacker forges the `streamRecordingUrl` to a private IP (`http://169.254.169.254/...`)
- **WHEN** the function attempts to fetch
- **THEN** the URL host is rejected by the allowlist (Stream's known hosts only)
- **AND** the function fails with `error_code='invalid_recording_url'` without performing the request

#### Scenario: Stream delivers a corrupted file
- **WHEN** the bytes are downloaded but `validateAudioMagicNumbers` on first 8KB fails
- **THEN** the row is `failed`, `error_code='invalid_mime'`
- **AND** the object (if already uploaded) is scheduled for deletion

### Requirement: Inngest events `audio.uploaded` and `recording.completed` are defined

The system SHALL extend `src/modules/ai-transcription/inngest/events.ts` with:

```ts
audioUploadedEventSchema = z.object({
  transcriptionId: TranscriptionIdSchema,
  userId: z.string().uuid(),
  patientId: z.string().uuid(),
  source: z.enum(['manual_upload','video_session']),
});

recordingCompletedEventSchema = z.object({
  userId: z.string().uuid(),
  patientId: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  streamRecordingUrl: z.string().url(),
  streamCallId: z.string().min(1),
});
```

And SHALL define a stub function `onAudioUploadedStub` (`triggers: { event: 'ai-transcription/audio.uploaded' }`) that logs `{ event: 'ai-transcription/audio.uploaded.received', transcriptionId, userId }` and nothing else. This stub will be REPLACED by the real processing function in the next change.

#### Scenario: Both schemas reject malformed payloads
- **WHEN** Zod parsing runs on payloads missing required fields
- **THEN** the parse throws and `inngest.send` is never called

#### Scenario: Stub logs are PII-free
- **WHEN** the stub runs
- **THEN** the log line contains only `transcriptionId` and `userId`
- **AND** does NOT include `patientId`, `source`, or any other field

### Requirement: `toggle-recording.ts` uses `assertAiConsentActive` alongside the legacy check

The system SHALL update `src/modules/telepsicologia/server/toggle-recording.ts` so that starting a recording requires BOTH:

- the legacy `patients.recording_consent_signed_at IS NOT NULL AND recording_consent_revoked_at IS NULL` (existing predicate);
- AND `assertAiConsentActive({ userId, patientId })` returns `ok: true`.

If EITHER fails, the action returns the existing error code (`CONSENT_INVALID`) without starting the recording.

#### Scenario: Both gates pass
- **WHEN** both checks return positive
- **THEN** recording starts (existing behavior preserved)

#### Scenario: Legacy fails
- **WHEN** the legacy field shows no consent
- **THEN** the recording does NOT start

#### Scenario: New gate fails
- **GIVEN** the legacy field is set (legacy migrated patient) BUT no `ai_recording` term exists
- **WHEN** the action is invoked
- **THEN** the recording does NOT start
- **AND** a log line indicates `legacy_present_but_ai_term_missing` (no PII)

#### Scenario: Telepsicologia integration test exercises both gates
- **GIVEN** two test psychologists, each with one patient in each combination of (legacy yes/no) × (ai term yes/no)
- **WHEN** `toggle-recording` is invoked for each
- **THEN** only the (yes, yes) case starts recording

### Requirement: `recording-cleanup` emits `ai-transcription/recording.completed` on Stream confirmation

The system SHALL update `src/modules/telepsicologia/inngest/recording-cleanup.ts` (or the equivalent point where Stream confirms recording is ready) so that, in addition to its current behavior, it fires `ai-transcription/recording.completed` with Zod-validated payload `{ userId, patientId, sessionId, streamRecordingUrl, streamCallId }`. Fire-and-forget: try/catch wrapping `inngest.send`, log error without payload.

#### Scenario: Stream completes recording
- **WHEN** the cleanup function processes a finished Stream recording
- **THEN** `ai-transcription/recording.completed` is dispatched exactly once
- **AND** subsequent retries of the cleanup do NOT double-dispatch (idempotency via the `video_recordings.status` transition)

#### Scenario: Emit failure does not crash cleanup
- **GIVEN** `inngest.send` throws
- **WHEN** cleanup runs
- **THEN** the existing cleanup logic completes
- **AND** the error is logged with `event: 'inngest_send_failed'`

### Requirement: `AudioUploadSheet` UI gates on consent and follows Sálvia DS

The system SHALL provide `AudioUploadSheet` at `src/modules/ai-transcription/components/audio-upload-sheet.tsx`. It SHALL:

- Be a `Sheet` (right-drawer on desktop, bottom-up on mobile).
- Open from a `Button` (variant `secondary`) labeled `"Enviar áudio para transcrição"` (visible on the patient page and on the session detail page).
- BEFORE rendering the dropzone, fetch `getAiConsentStatus`. If status is NOT `active`, render an `Alert` (variant warning) with copy: `"O paciente ainda não assinou o termo de transcrição por IA. Gere o termo antes de enviar o áudio."` plus a link to the `AiConsentPanel`. No dropzone is shown.
- When consent is `active`: render a dropzone accepting `audio/*` (UI hint only — server allowlist is authoritative). Drop OR click to choose. Show file metadata (name, size) before confirming.
- On confirm: call `requestAudioUploadUrl` → on `ok:true` execute the PUT via `XMLHttpRequest` (for `upload.onprogress`) → show progress bar (Sálvia `info-500` for fill) → on PUT 200, call `confirmAudioUpload` → on `ok:true` close the sheet and `Sonner` toast `"Áudio enviado. A nota ficará pronta em alguns minutos."`.
- Error handling: each Server Action error code maps to a humanized pt-BR message ("Tamanho excedido (máx. 200MB)", "Tipo de arquivo não suportado", etc.). Never expose internal error strings.

#### Scenario: Consent inactive blocks the dropzone
- **GIVEN** the patient has no active AI term
- **WHEN** the user opens the sheet
- **THEN** no dropzone is shown
- **AND** the warning + link to the consent panel are visible

#### Scenario: WCAG contrast on progress bar
- **WHEN** the progress bar is rendered in light and dark mode
- **THEN** fill vs track contrast is ≥ 3:1

#### Scenario: Upload progress updates the bar
- **WHEN** a 50MB file uploads
- **THEN** the bar advances proportionally to bytes sent
- **AND** the UI does NOT freeze (the PUT is non-blocking)

#### Scenario: Network error reverts and shows toast
- **WHEN** the PUT fails (simulated network error)
- **THEN** the sheet remains open, the row's `status` becomes `failed` via `confirmAudioUpload` rejection, and a `Sonner` toast (variant error) appears with `"Falha ao enviar áudio. Verifique sua conexão e tente novamente."`

#### Scenario: Microcopy uses glossary
- **WHEN** the sheet is rendered
- **THEN** labels use `"Sessão"`, `"Paciente"`, `"Enviar áudio"`, never `"Consulta"`, `"Submeter arquivo"`
