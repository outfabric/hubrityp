### Requirement: A single server-only Gemini client lives in the module

The system SHALL expose `getGeminiClient(): GoogleGenAI` from `src/modules/ai-transcription/server/gemini-client.ts`. The file SHALL start with `import 'server-only'`. The client SHALL be lazy-initialized (singleton) using `serverEnv.GEMINI_API_KEY`. No other file in the module SHALL import `@google/genai` directly; ESLint enforces this (rule added in `ai-transcription-foundation` is updated by this change to whitelist `server/gemini-client.ts`).

#### Scenario: Importing the client from a `'use client'` file is impossible
- **WHEN** a client component attempts to import `gemini-client.ts`
- **THEN** Next.js build fails because of `import 'server-only'`

#### Scenario: Client is reused across Inngest invocations
- **GIVEN** the Inngest function is executed twice in the same Node process
- **THEN** `getGeminiClient` returns the SAME instance both times (singleton)

#### Scenario: ESLint blocks unauthorized `@google/genai` imports
- **WHEN** a developer adds `import { GoogleGenAI } from '@google/genai'` inside `src/modules/ai-transcription/` outside the allowlisted file
- **THEN** `npm run lint` reports an error

### Requirement: `processAudioTranscription` is a multi-step Inngest function consuming `ai-transcription/audio.uploaded`

The system SHALL define `processAudioTranscription` at `src/modules/ai-transcription/inngest/process-audio-transcription.ts`, triggered by `ai-transcription/audio.uploaded`, REPLACING the stub `onAudioUploadedStub` (the stub SHALL be removed in the same change). The function SHALL execute the following steps in order, each as a discrete `step.run`:

1. **assert-consent**: call `assertAiConsentActive`. If not `ok: true`, throw `NonRetriableError('CONSENT_INACTIVE')`; pipeline aborts; the consent-revocation handler SHALL eventually mark `status='cancelled'`.
2. **transition-to-transcribing**: idempotent UPDATE `status='transcribing'` WHERE `status IN ('pending','transcribing')`.
3. **download-audio**: read bytes from our Supabase Storage bucket using service-role; comment justifies usage (system job).
4. **send-to-gemini**: if size > 20MB, `ai.files.upload` (Files API) and use `createPartFromUri`; otherwise inline base64 part. Returns the part.
5. **run-transcription**: `ai.models.generateContent` with system instruction "Transcreva o áudio em português brasileiro, preservando hesitações e silêncios entre colchetes. Não interprete." Config: `responseMimeType: 'text/plain'`, `audioTimestamp: true`, `temperature: 0.1`, custom safetySettings (relaxed for HARASSMENT/HATE_SPEECH to BLOCK_ONLY_HIGH).
6. **pseudonymize**: load `patient.firstName`, `patient.fullName` via RLS-scoped query, call `pseudonymizeTranscript`. Result is the input to the next step. RAW transcript is NEVER persisted beyond this step's transient memory.
7. **transition-to-generating**: idempotent UPDATE `status='generating'`.
8. **generate-note**: `ai.models.generateContent` with template-specific system instruction (one of `tcc`/`psicanalise`/`sistemica`/`aba`/`livre`), passing the pseudonymized transcript and the risk sensitivity. Config: `responseMimeType: 'application/json'`, `responseJsonSchema: GeminiNoteJsonSchema` (derived from `GeneratedNoteSchema` via `zod-to-json-schema`), `temperature: 0.2`, same safety settings.
9. **validate-note**: `GeneratedNoteSchema.safeParse(JSON.parse(text))`. If fails: log `invalid_response_schema` (no payload), throw retriable error (Inngest retries this step).
10. **extract-risk-alerts**: take the `palavrasRisco` from the parsed note and build a structured `riskAlerts` array. Each alert validated by `RiskAlertSchema`.
11. **delete-gemini-file**: best-effort `ai.files.delete` if step 4 used Files API. Errors here are swallowed (logged, not retried).
12. **persist-note**: UPDATE row SET `generated_note = $jsonb`, `risk_alerts = $jsonb`, `template_used = '${template}:v${PROMPT_VERSION}'`, `transcription_cost_usd`, `llm_cost_usd`, `status = 'ready'`, `completed_at = now()` WHERE `id = $tx AND status = 'generating'` (idempotent — no-op if already ready).
13. **broadcast-ready**: `supabase.channel('ai-transcription:user:' + userId).send({ type: 'broadcast', event: 'ready', payload: { transcriptionId } })`. Errors swallowed (broadcast is best-effort; UI also polls on focus).

#### Scenario: Happy path produces a ready row
- **GIVEN** a valid `pending` row with `audio_object_key` set
- **WHEN** `processAudioTranscription` runs
- **THEN** the row transitions `pending → transcribing → generating → ready`
- **AND** `generated_note` is a JSONB matching `GeneratedNoteSchema`
- **AND** `risk_alerts` is a JSONB array matching `RiskAlertSchema`
- **AND** `template_used` matches `^(tcc|psicanalise|sistemica|aba|livre):v\d+$`

#### Scenario: Idempotent re-run after partial success
- **GIVEN** the function was killed after step 7 (status='generating') and Inngest retries the function from scratch
- **WHEN** the re-run begins
- **THEN** step 2 is a no-op (UPDATE matches zero rows), step 3-6 re-execute, step 7 is no-op, etc.
- **AND** the final row has the same `generated_note` (modulo non-determinism in Gemini — accepted)

#### Scenario: Consent revoked between upload and processing
- **WHEN** step 1 finds consent inactive
- **THEN** `NonRetriableError` thrown
- **AND** Inngest run is marked failed
- **AND** the consent-revocation handler (separate listener) marks the row `cancelled` and the cron purges the audio within 1h

#### Scenario: Patient name never reaches the note prompt
- **GIVEN** the patient is named "Maria Souza Lima"
- **WHEN** the function logs `gemini_request_size` and `gemini_response_size`
- **THEN** no log line contains "Maria" or "Souza" or "Lima"
- **AND** the prompt sent in step 8 (captured via Gemini test mock) contains `"Paciente"` instead

#### Scenario: Gemini returns invalid JSON
- **GIVEN** Gemini returns malformed JSON in step 9
- **WHEN** `safeParse` fails
- **THEN** the step throws a retriable error
- **AND** Inngest retries up to 4 times
- **AND** after exhausting retries, the row's `status='failed'`, `error_code='invalid_response_schema'`
- **AND** the audio is preserved (for re-processing if the developer fixes the prompt)

#### Scenario: Safety block
- **WHEN** Gemini blocks generation with a safety reason
- **THEN** the row's `status='failed'`, `error_code='gemini_safety_block'`
- **AND** no retries (NonRetriableError)

#### Scenario: Rate limit 429
- **WHEN** Gemini returns 429
- **THEN** the step throws a retriable error
- **AND** Inngest applies exponential backoff (30s, 2min, 8min, 32min)
- **AND** after exhausting retries the row's `status='failed'`, `error_code='gemini_429'`

### Requirement: Prompts are versioned and template-specific

The system SHALL define one prompt module per template at `src/modules/ai-transcription/server/prompts/note-<template>.ts` for `tcc`, `psicanalise`, `sistemica`, `aba`, `livre`. Each module SHALL export:
- `PROMPT_VERSION: number` (starts at `1`).
- `buildSystemInstruction(sensitivity: RiskSensitivity): string`.

The transcription prompt SHALL be at `src/modules/ai-transcription/server/prompts/transcription.ts`, also versioned.

All prompts SHALL:
- Use pt-BR.
- Forbid the LLM from inventing content ("Se algo não foi mencionado, escreva [não mencionado]").
- Forbid deep clinical interpretation ("Não faça interpretações clínicas profundas — quem faz é o psicólogo").
- For TCC, instruct on identifying mood (0-10 scale), session agenda, techniques worked, homework.
- For psicanalise, instruct on free association, transference markers, dreams reported (descriptive only).
- For sistemica, instruct on family/relational dynamics referenced.
- For aba, instruct on antecedent-behavior-consequence patterns.
- For livre, instruct on plain summary.

The risk-sensitivity layer SHALL:
- `low` → "Sinalize APENAS menções diretas e literais (ex: 'pensei em me matar')."
- `medium` → "Sinalize menções diretas e fortes hipóteses."
- `high` → "Sinalize qualquer indício, mesmo tênue."

#### Scenario: Template_used includes version
- **WHEN** a row is persisted
- **THEN** `template_used` matches `^(tcc|psicanalise|sistemica|aba|livre):v\d+$`

#### Scenario: Version bump is auditable
- **WHEN** a developer changes a prompt's content and bumps `PROMPT_VERSION`
- **THEN** subsequent rows have a new `template_used` value
- **AND** older rows preserve their original version

### Requirement: `GeneratedNoteSchema` is convertible to a JSON Schema for `responseJsonSchema`

The system SHALL produce `GeminiNoteJsonSchema` at `src/modules/ai-transcription/server/json-schemas/gemini-note.ts` by running `zodToJsonSchema(GeneratedNoteSchema, { name: 'GeneratedNote', $refStrategy: 'none' })`. The result SHALL be cached at module load (top-level const). The function SHALL strip unsupported features for Gemini (e.g., `$schema` keyword) per the SDK's `responseJsonSchema` constraints.

#### Scenario: Schema is passed to Gemini
- **WHEN** step 8 invokes `generateContent`
- **THEN** the `config.responseJsonSchema` equals `GeminiNoteJsonSchema`
- **AND** the schema's required fields match `GeneratedNoteSchema`

#### Scenario: Schema conversion is verified at boot
- **WHEN** the module is imported
- **THEN** an internal sanity check (`expectJsonSchemaShape`) confirms `GeminiNoteJsonSchema.required` includes `schemaVersion`, `pauta`, etc.
- **AND** boot fails loudly if a future Zod edit breaks the shape

### Requirement: Cron `discardOldAudios` enforces the 24h retention

The system SHALL define `discardOldAudios` as an Inngest scheduled function with cron `0 * * * *` (every hour). On each tick, the function SHALL:

1. Query `ai_transcriptions` WHERE `audio_object_key IS NOT NULL AND audio_discarded_at IS NULL AND created_at < now() - INTERVAL '<keep_audio_hours> hours'` (the threshold is per-user — JOIN to `ai_transcription_settings` and use `coalesce(settings.keep_audio_hours, 24)`).
2. For each row, in `step.run('discard-<id>')`:
   - DELETE the object from Storage (service-role).
   - UPDATE the row: `audio_object_key = NULL`, `audio_discarded_at = now()`.
3. Log batch summary `{ event: 'audio_discard_batch', count, duration }` (no IDs of patients).

#### Scenario: Audio older than 24h is discarded
- **GIVEN** a row with `created_at = now() - 25h` and `audio_object_key` set
- **WHEN** the cron runs
- **THEN** the Storage object is deleted
- **AND** `audio_object_key` is NULL and `audio_discarded_at` is set

#### Scenario: Audio younger than the per-user retention is kept
- **GIVEN** a user with `keep_audio_hours = 48` and an audio at 36h old
- **WHEN** the cron runs
- **THEN** the audio is NOT discarded

#### Scenario: Storage delete failure does not block the row update for OTHER rows
- **GIVEN** 10 rows, the 3rd Storage delete returns 500
- **WHEN** the cron runs
- **THEN** rows 1, 2, 4-10 are discarded
- **AND** row 3 retains `audio_object_key` (will be retried next hour)
- **AND** the failed step is logged with `event: 'discard_storage_failed'`, `transcriptionId` (uuid), no PII

#### Scenario: Plan uses the partial index
- **WHEN** the query runs against a populated DB
- **THEN** the plan uses `idx_ai_transcriptions_audio_to_discard`

### Requirement: Cron `purgeFailedAudios` shortens retention for terminal failures

The system SHALL define `purgeFailedAudios` as an Inngest scheduled function with cron `15 * * * *` (every hour, offset from `discardOldAudios`). It SHALL discard `audio_object_key` from rows where `status IN ('failed','cancelled') AND audio_object_key IS NOT NULL AND completed_at < now() - INTERVAL '1 hour'` (or, if `completed_at` is null, use `updated_at`).

#### Scenario: Failed audio purged within 1h after terminal
- **GIVEN** a row with `status='failed'` and `updated_at = now() - 65min`
- **WHEN** the cron runs
- **THEN** the object is deleted and the row marked `audio_discarded_at`

#### Scenario: Recent failure not purged yet
- **GIVEN** a row with `status='failed'` and `updated_at = now() - 5min`
- **WHEN** the cron runs
- **THEN** the audio is NOT yet purged

### Requirement: `onConsentRevoked` replaces the stub and cancels `pending` jobs

The system SHALL define `onConsentRevoked` at `src/modules/ai-transcription/inngest/on-consent-revoked.ts`, triggered by `ai-transcription/consent.revoked`. It SHALL REPLACE the stub created in `ai-transcription-consent` (the stub is removed in the same change). On event:

1. SELECT `ai_transcriptions` WHERE `user_id = event.userId AND patient_id = event.patientId AND status IN ('pending','transcribing','generating')`.
2. For each row:
   - If `status = 'pending'`: UPDATE `status = 'cancelled'`, `error_code = 'consent_revoked'`, `updated_at = now()`. The `purgeFailedAudios` cron picks it up within the next hour.
   - If `status IN ('transcribing','generating')`: log `consent_revoked_mid_processing` with `transcriptionId` only; let it finish (RN-10.06).

#### Scenario: Pending job cancelled
- **GIVEN** a `pending` row when consent is revoked
- **WHEN** the handler runs
- **THEN** `status = 'cancelled'`
- **AND** the audio is purged within ≤2h

#### Scenario: In-flight job left alone
- **GIVEN** a `transcribing` row when consent is revoked
- **WHEN** the handler runs
- **THEN** `status` is unchanged
- **AND** a log line `consent_revoked_mid_processing` is emitted with IDs only

### Requirement: Realtime broadcast notifies the UI

The system SHALL broadcast on `ai-transcription:user:<userId>` channel with `event: 'ready'` payload `{ transcriptionId }` whenever a row transitions to `ready`. The broadcast happens in step 13. The channel name SHALL include `userId` so that Supabase Realtime RLS restricts subscription to the channel owner (configure on Supabase: channel ACL by JWT `sub`).

#### Scenario: Ready broadcast lands on the right channel
- **WHEN** step 13 runs for psychologist A
- **THEN** a broadcast hits `ai-transcription:user:<A.id>`
- **AND** psychologist B (subscribed to their own channel) does NOT receive it

#### Scenario: Broadcast failure does not flip status back
- **GIVEN** the Realtime API is down
- **WHEN** step 13 throws
- **THEN** the row remains `ready` (step 12 already persisted)
- **AND** the error is logged without PII

### Requirement: Cost tracking is opt-in but persisted when available

The system SHALL persist `transcription_cost_usd` and `llm_cost_usd` (DECIMAL(10,4), nullable) when `response.usageMetadata` is available, using `lib/pricing.ts` to map tokens → USD. If `usageMetadata` is absent, both columns remain `NULL`. The pricing module SHALL be versioned (constants per model + a `PRICING_VERSION` literal).

#### Scenario: Cost computed when metadata present
- **WHEN** Gemini returns usageMetadata
- **THEN** both columns are set to non-null positive decimals

#### Scenario: Cost is NULL when metadata absent
- **WHEN** Gemini returns no usageMetadata
- **THEN** both columns remain NULL
- **AND** the pipeline succeeds

### Requirement: `ai_transcriptions` table holds one row per audio submission

The system SHALL define an `ai_transcriptions` table under the `ai-transcription` schema domain with one row per session audio submission. The table SHALL include at minimum: `id` (uuid pk), `user_id` (uuid, NOT NULL, FK to `auth.users`), `patient_id` (uuid, NOT NULL, FK to `patients`), `session_id` (uuid, NULLABLE, FK to `sessions` with `ON DELETE SET NULL`), `evolution_id` (uuid, NULLABLE, FK to `evolutions` with `ON DELETE SET NULL`), `source` (text, enum-validated against `'video_session' | 'manual_upload'`), `audio_object_key` (text, NULLABLE — null after discard), `audio_size_bytes` (bigint, NULLABLE), `audio_duration_seconds` (integer, NULLABLE), `audio_discarded_at` (timestamptz, NULLABLE), `template_used` (text, NULLABLE), `generated_note` (jsonb, NULLABLE), `risk_alerts` (jsonb, NULLABLE), `status` (text, enum-validated against `'pending' | 'transcribing' | 'generating' | 'ready' | 'reviewed' | 'failed' | 'cancelled'`, default `'pending'`), `error_code` (text, NULLABLE), `retry_count` (integer, default 0), `reviewed_at` (timestamptz, NULLABLE), `saved_to_prontuario` (boolean, default false), `user_edits_count` (integer, default 0), `transcription_cost_usd` (numeric(10,4), NULLABLE — added by `ai-transcription-gemini-processing`), `llm_cost_usd` (numeric(10,4), NULLABLE — added by `ai-transcription-gemini-processing`), `created_at`, `updated_at` (timestamptz default now()), `completed_at` (timestamptz, NULLABLE).

The `cancelled` status SHALL be used exclusively to mark rows whose processing was aborted because patient consent was revoked while the row was still `pending`. The CHECK constraint on `status` is REPLACED to include `cancelled`.

#### Scenario: Cancelled status accepted
- **WHEN** an UPDATE sets `status = 'cancelled'`
- **THEN** the CHECK accepts it

#### Scenario: Previously rejected enum values still rejected
- **WHEN** an UPDATE attempts `status = 'archived'`
- **THEN** the CHECK rejects

#### Scenario: Cost columns nullable
- **WHEN** a row is created without cost data
- **THEN** both `transcription_cost_usd` and `llm_cost_usd` are NULL by default
