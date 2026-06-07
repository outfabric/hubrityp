---
name: project-ai-transcription-module-patterns
description: AI Transcription module (PRD 10) architecture: schema, RLS, env split, logger redaction, pseudonymize, edge entrypoint, test patterns, known review findings
metadata:
  type: project
---

# AI Transcription Module Patterns (foundation, reviewed 2026-05-25)

## Schema
- Two tables: `ai_transcription_settings` (1:1 psychologist), `ai_transcriptions` (many per psychologist+patient).
- Both tables: RLS enabled, 4 policies each (`SELECT/INSERT/UPDATE/DELETE`), all `auth.uid() = user_id`.
- `ai_transcription_settings.user_id` FK: `ON DELETE CASCADE` (settings deleted with account).
- `ai_transcriptions.user_id` FK: **no ON DELETE** (defaults to RESTRICT — intentional LGPD retention; document this decision in future PRs).
- `ai_transcriptions.patient_id` FK: **no ON DELETE** — blocks patient deletion if transcriptions exist; needs explicit decision.
- Partial index `idx_ai_transcriptions_audio_to_discard` on `created_at WHERE audio_object_key IS NOT NULL AND audio_discarded_at IS NULL` for discard cron.
- No explicit `patient_id` index — will be needed for per-patient query patterns in review UI.

## Storage
- Private bucket `ai-transcription-audio` (`public = false`).
- Path convention: `<userId>/<transcriptionId>/audio.webm`. Ownership enforced via `(storage.foldername(name))[1] = auth.uid()::text`.
- Policies: SELECT, INSERT, DELETE only — no UPDATE (correct for immutable audio objects).
- Storage schema wrapped in `DO $$ IF EXISTS` guard for Testcontainers compatibility.
- **Storage RLS tests are skipped** — they require `supabase start` and belong in `e2e/real/`. Migration path documented in `ai-transcription-storage-rls.int.test.ts`.

## Env vars
- `GEMINI_API_KEY` (required), `GEMINI_MODEL_TRANSCRIPTION`, `GEMINI_MODEL_NOTE`, `AI_TRANSCRIPTION_BUCKET`, `AI_TRANSCRIPTION_AUDIO_TTL_HOURS`, `AI_TRANSCRIPTION_MAX_AUDIO_MB` — all server-only.
- `client-schema.ts` split: fixes a latent server-key-name leak where `schemas.ts` was imported by `client.ts`.
- LGPD note: Gemini API sends audio/transcripts outside Brazil — needs a documented DPA/consent basis before production use.

## Module structure
- `lib/branded-types.ts`: `TranscriptionIdSchema` (Zod branded UUID).
- `lib/schemas.ts`: enums + `GeneratedNoteSchema` (schemaVersion: 1 literal) + `RiskAlertSchema`.
- `lib/pseudonymize.ts`: pure function, no imports, word-boundary regex, escapes special chars, filters tokens ≤2 chars.
- `lib/logger.ts`: `server-only` guard, `createTranscriptionLogger(context, dest?)`, redacts 11 paths including `transcript`, `generatedNote`, `riskAlerts`, `patientName*`, `audioObjectKey`, `signedUrl`, `rawGeminiResponse`, `prompt`.
- `edge.ts`: Zod schemas only, no pino/Node deps — correct pattern.
- `server/index.ts`: placeholder, empty `export {}`.

## Known review findings
1. **Logger test drift**: `createBufferedLogger` in `logger.test.ts` duplicates `AI_TRANSCRIPTION_REDACT_PATHS` inline rather than routing through `createTranscriptionLogger`. If redact paths change, tests still pass. Suggested: add optional `dest` param to `createTranscriptionLogger`.
2. **`ai_transcriptions.patient_id` FK ON DELETE undocumented**: defaults to RESTRICT, blocks patient deletion. Needs explicit decision + comment.
3. **`ai_transcriptions.user_id` FK no CASCADE**: intentional LGPD retention, but undocumented in SQL.
4. **Missing `patient_id` index** on `ai_transcriptions` (for future per-patient queries).
5. **`@google/genai` not restricted globally** — only restricted within `src/modules/ai-transcription/**`.

## ESLint hardening
- `pino` and `pino-pretty` restricted within `ai-transcription/**` (except `lib/logger.ts` allows pino).
- `@google/genai` restricted within `ai-transcription/**` with carve-out for future `gemini-client.ts`.
- **Gap**: `@google/genai` is NOT restricted outside the module — other modules can import it directly.
- New in consent change: `require-assert-ai-consent` custom ESLint rule (CJS, in `eslint-rules/`) — fires when `aiTranscriptions` table is imported in `ai-transcription/server/**` or `ai-transcription/inngest/**` without also importing `assertAiConsentActive`. Only covers those two sub-directories; does NOT cover `patients/server/**` (which has its own ownership checks).

## Gemini Pipeline (added 2026-05-28, feature/ai-transcription-gemini-processing)

### Architecture — 13-step Inngest function `processAudioTranscription`
1. assert-consent (NonRetriableError if inactive)
2. transition-to-transcribing (idempotent WHERE status IN ('pending','transcribing'))
3. download-audio (service-role storage, loads full file into Buffer + base64)
4. send-to-gemini (Files API >20MB, inline base64 <=20MB)
5. run-transcription (rawTranscript returned from step)
6. pseudonymize (replaces firstName + fullName with 'Paciente'; rawTranscript from step 5)
7. transition-to-generating
8. generate-note (pseudonymizedTranscript sent to Gemini)
9. validate-note (Zod double-defense with GeneratedNoteSchema)
10. extract-risk-alerts (keyword heuristics → structured RiskAlert[])
11. delete-gemini-file (best-effort, swallowed)
12. persist-note (status='ready', generatedNote, riskAlerts, cost cols)
13. broadcast-ready (best-effort Realtime, swallowed)

### CRITICAL FINDING: Inngest step state leaves Brazil unencrypted
- Inngest.createFunction() returns raw `step.run()` values to Inngest Cloud state store (US-based).
- Step 3 stores base64 audio (~26MB for 20MB file) in Inngest state.
- Step 5 stores rawTranscript (full clinical session transcript) in Inngest state.
- Fix: `@inngest/middleware-encryption` on the shared Inngest client (`new Inngest({ middleware: [encryptionMiddleware({ key })] })`).
- Add `INNGEST_ENCRYPTION_KEY` (min 32 chars) to all 6 env blocks.

### Schema delta (migration 0031)
- Drops+recreates `ai_transcriptions_status_check` to add 'cancelled' to enum.
- Adds `transcription_cost_usd NUMERIC(10,4)` and `llm_cost_usd NUMERIC(10,4)` (nullable).
- No new tables, no new RLS changes needed.

### Cron jobs
- `discardOldAudios`: every hour (minute 0). JOINs settings for per-user `keep_audio_hours`. Gap: no status filter — could discard audio from transcribing/generating rows if stalled.
- `purgeFailedAudios`: every hour (minute 15). Only `status IN ('failed','cancelled')`, 1h after terminal. Correct.

### Service-role usage in pipeline
- All service-role calls: Supabase Storage download (step 3), Supabase Realtime broadcast (step 13), cron Storage deletes. All justified + commented. No user-session paths.

### Inngest client shared
- `src/modules/ai-transcription/inngest/client.ts` re-exports from whatsapp module: `export { inngest } from '@/modules/whatsapp/inngest/client'`.
- `INNGEST_SIGNING_KEY` is optional in env schema — should be required for production.

### Pricing
- `lib/pricing.ts`: MODEL_PRICING table for gemini-2.0-flash, 2.5-flash-lite, 2.5-flash, 2.5-pro, 3.5-flash. Defaults: `gemini-3.5-flash` (confirmed real model as of 2026).
- `computeCost()` returns null for unknown models — cost columns remain NULL (design decision D12).

### Prompts
- 5 templates: tcc, psicanalise, sistemica, aba, livre — each has `PROMPT_VERSION` + `buildSystemInstruction(sensitivity)`.
- Transcription prompt: `TRANSCRIPTION_SYSTEM_INSTRUCTION` (plain text, audio-only, no patient info).
- `templateUsed` column stores `<template>:v<noteVersion>+t:v<transcriptionVersion>` for auditability.

### Tests (comprehensive)
- Unit: pseudonymization-end-to-end (3 assertions: transcription step has no PII, note step has pseudonymized content, logs have no PII), path-injection (7 malicious keys), on-consent-revoked, discard, purge, pricing, gemini-client, json-schemas, prompts, realtime.
- Integration: process-audio-transcription.int.test.ts (real Postgres + mock Gemini), log-redaction.int.test.ts (real Pino + real Postgres), consent-revoked-cancels-pending.int.test.ts, discard-old-audios.int.test.ts, purge-failed-audios.int.test.ts, realtime-broadcast.int.test.ts, ai-transcription-status-enum.int.test.ts.
- E2E: full-pipeline-mock-gemini.spec.ts (DB lifecycle: pending→transcribing→generating→ready + failure state).

## Gemini Pipeline Iteration 2 Fixes (review-2, 2026-05-28, commit 3e7c7b4)

All 6 BLOCKER/HIGH findings from review-1 resolved:
1. **Encryption**: `@inngest/middleware-encryption` added to `whatsapp/inngest/client.ts`. `INNGEST_ENCRYPTION_KEY: z.string().min(32)` in serverEnvSchema. Propagated to all 6 env blocks + .env.example.
2. **OOM guard**: `if (row.audioSizeBytes && row.audioSizeBytes > maxBytes) throw new NonRetriableError('AUDIO_EXCEEDS_PIPELINE_LIMIT')` added before storage.download() in step 3. NOTE: `audioSizeBytes` is `bigint` (nullable) in schema — the guard evaluates false if null (column not set), which is a residual risk if the DB row was created before the `audioSizeBytes` column existed.
3. **onFailure cast**: Replaced raw `as` cast with `audioUploadedEventSchema.safeParse(event.data.event.data)`.
4. **Discard cron status filter**: `AND t.status NOT IN ('transcribing', 'generating')` added to `defaultFindCandidates` query.
5. **INNGEST_SIGNING_KEY prod guard**: Startup throw in `shared/env/index.ts` when `NODE_ENV === 'production' && !INNGEST_SIGNING_KEY`.
6. **Redundant base64**: `SendToGeminiResult.inlineBase64` typed as `null` (never `string`), both code paths return `null`, step 5 reads `downloadResult.base64` directly.

**Open after review-2 (MEDIUM)**:
- OOM guard has NO test. Neither unit nor integration test exercises `AUDIO_EXCEEDS_PIPELINE_LIMIT`. Mock DB rows in unit tests return `{ audioObjectKey }` without `audioSizeBytes`, so `undefined && ...` is always falsy.
- `defaultMarkDiscarded` / `defaultMarkPurged` still scope by `id` only (no `userId` in WHERE). Pre-existing MEDIUM, deferred.
- `.env.example` has no min-32 hint for `INNGEST_ENCRYPTION_KEY`.

## AI Consent (added 2026-05-26, feature/ai-transcription-consent)
- `consent_terms` table extended with `kind` discriminator ('general'|'ai_recording'), `template_snapshot` (JSONB), `template_version`, `revocation_takes_effect_immediately`, `revocation_reason`.
- Migration 0029: expand-backfill-constrain pattern (ADD nullable → UPDATE → SET NOT NULL).
- RLS on `consent_terms` was established in migration 0007 (four-policy pattern, `user_id = auth.uid()`).
- `assertAiConsentActive` in `ai-transcription/lib/consent.ts` is the SINGLE authority for "is AI recording allowed?" — injectable `db` and `now` for testability.
- Public token endpoints (`get-ai-consent-by-token.ts`, `sign-ai-consent.ts`) use Drizzle `db` (DATABASE_URL = direct Postgres, bypasses RLS) — justified, same pattern as existing `get-consent-by-token.ts`.
- AI consent token: 32 bytes base64url (43 chars) — dispatched from hex (64 chars) in page.tsx by format.
- IP/UA hashed with `SIGNATURE_HASH_SALT` (min-32-chars, Zod-required) in `sign-ai-consent.ts`. Pre-existing general consent stores them raw — inconsistency surfaced by this diff.
- `TOKEN_EXPIRY_MS` duplicated in 5 files — should be extracted to a shared constant.
- `confirmedName` input in `AiConsentView` is cosmetic — never sent to server, never stored. Legal risk (electronic signature evidential weight). Open finding.
- `revokedAt` in DB uses `sql\`now()\`` but Inngest payload uses `new Date()` — minor time skew.
- `reason` field in `consentRevokedEventSchema` is free-text, always `null` from current UI but included in Inngest event payload (US-hosted). Future LGPD risk if reason contains PII.
- `no-referrer` header override for `/termo/:token*` in `next.config.ts` — prevents token leaking via Referer.
- E2E gap: public signing flow fully covered; authenticated psychologist AiConsentPanel flow has unit+integration but NO E2E test.

## Audio Upload (added 2026-05-27, feature/ai-transcription-audio-upload)

### Architecture
- `requestAudioUploadUrl` (Server Action): auth → Zod → patient ownership check → session ownership check → assertAiConsentActive → rate limit (6/min/user, Postgres UPSERT) → INSERT pending row → Supabase signed upload URL (5 min TTL). Rate limit key: `audio-upload:<userId>`.
- `confirmAudioUpload` (Server Action): auth → Zod → SELECT pending row (user-scoped) → assertAiConsentActive (re-validates) → discover object by probing extensions → download full blob → magic-number validate → size validate (±5% tolerance) → UPDATE row → emit `ai-transcription/audio.uploaded` event.
- `ingestStreamRecording` (Inngest): validates `recording.completed` event → assert consent → INSERT row → SSRF-validated CDN download → magic-number validate → service-role Storage upload → UPDATE row → emit `ai-transcription/audio.uploaded` → best-effort Stream delete.
- `onAudioUploadedStub`: stub consumer for `audio.uploaded` event, replaced by Gemini pipeline in next change.

### Rate limiter
- `src/shared/db/schema/rate-limits/` — new table `rate_limits` with service-role-only RLS policies (4 policies). Drizzle `db` client bypasses RLS as superuser (intended).
- `src/shared/lib/rate-limit/postgres.ts` — atomic UPSERT sliding-window counter. Thread-safe across Vercel instances.
- Only `requestAudioUploadUrl` is rate-limited; `confirmAudioUpload` has NO rate limit (flagged as 🟠 HIGH in review-1).

### MIME validation
- `src/modules/ai-transcription/server/validators/mime.ts` — uses `file-type` library for magic-number detection. Normalizes `video/webm` → `audio/webm` (file-type limitation), `audio/x-wav` → `audio/wav`, etc. Separate normalization maps for detected vs. declared MIME.
- `ingestStreamRecording` has its own inline magic-number check (`hasValidAudioMagic`) for WebM/MP3/WAV/MP4 — does NOT use the `file-type` library.

### SSRF guard
- `STREAM_HOST_ALLOWLIST = ['stream-io-cdn.com']` — exact domain or subdomain match.
- `validateStreamUrl` checks hostname against allowlist, then resolves DNS to block private IPs.
- `isPrivateIP` covers RFC 1918, loopback, link-local, IPv6 loopback/link-local.
- Gap: DNS failure swallowed (cautious fallback); could mask SSRF if CDN hostname resolves to private IP and DNS lookup fails transiently.

### Object key pattern
- Manual upload: `<userId>/<transcriptionId>.<ext>` (from contentType → extension mapping).
- Stream ingest: hard-coded `<userId>/<transcriptionId>.webm` regardless of actual format (flagged in review-1).

### Known review findings (review-1 → resolved in review-2, 2026-05-27)

#### FIXED in commit d7396d8 (review-2 verified)
1. **`confirmAudioUpload` OOM** — replaced full `storage.download()` with single `storage.list()` for size metadata + ranged `fetch(bytes=0-8191)` for magic-number. Memory now bounded at 8 KB per confirm call regardless of file size.
2. **`patientId` logged in 3 places** — removed from all payloads in request-audio-upload-url.ts (L118, L145), confirm-audio-upload.ts, ingest-stream-recording.ts.
3. **`toggle-recording.ts` LGPD warn log** — `userId` + `patientId` removed; only event name + `aiReason` remain.
4. **`confirmAudioUpload` no rate limit** — added 6 req/min/user (key: `audio-confirm:<userId>`) matching requestAudioUploadUrl.
5. **`POSSIBLE_EXTENSIONS` duplication** — now derived from `[...new Set(Object.values(CONTENT_TYPE_TO_EXT))]`.
6. **Anonymous `confirmAudioUpload` test** — added to `upload-security.int.test.ts:L204-L211`.
7. **Sequential storage probing (Medium-6)** — implicitly resolved: `discoverUploadedObject` now uses single `storage.list()` then iterates in-memory; no sequential download round-trips.
8. **RLS comment** — `rate-limits/policies.ts` updated to clarify Drizzle superuser bypass vs. service_role policy intent.

#### DEFERRED (acceptable for merge)
- **`ingestStreamRecording` object key hard-codes `.webm`** — Stream recordings are always WebM for Chromium browsers. Add `// TODO(ai-transcription-consent-cleanup)` comment. Low risk given browser landscape.
- **`downloadMagicHeader` dead-code clause** `response.status !== 206` — status 206 satisfies `response.ok=true`, making the clause unreachable. Simplify to `if (!response.ok) return null`. Nit only.
- **`metadata.size` fallback to 0** — if Supabase Storage omits size from list metadata (non-standard behavior), `actualSizeBytes=0` causes false SIZE_MISMATCH rejection. In practice S3-compatible storage always returns size. Low risk.
- **`userId` in `request_upload_url_rate_limited` log** — redundant (already in child context), not a new PII violation.
- **`extractStreamRecordingParts` minimum segment guard is 2 but docstring says 5** — guard is weaker than comment implies; URL is from trusted SSRF-validated source. Nit.

### Architecture: `confirmAudioUpload` discover + validate flow (post-fix)
1. `storage.list(userId, { search: transcriptionId })` — single call, returns all matching objects with `metadata.size`
2. In-memory scan of results against `POSSIBLE_EXTENSIONS` → returns `{ objectKey, ext, actualSizeBytes }`
3. `storage.createSignedUrl(objectKey, 60)` → short-lived URL
4. `fetch(signedUrl, { headers: { Range: 'bytes=0-8191' } })` → 8 KB buffer (206) or 200 for files < 8 KB
5. `validateAudioMagicNumbers(buffer, declaredContentType)` via file-type library
6. Size comparison: `actualSizeBytes` from step 1 metadata vs `maxBytes` (config) and `declaredSize` (DB, ±5% tolerance)

## Settings UI (added 2026-05-29, feature/ai-transcription-settings-ui)

### Routes
- `/configuracoes/transcricao-ia` — settings page under `/configuracoes` prefix, already in `APP_PREFIXES`. No new `classifyPath()` entry needed. Negative-auth E2E spec present and correct.

### Server Actions (new)
- `getTranscriptionSettingsImpl` — getUser() → UPSERT default row (ON CONFLICT DO NOTHING) → SELECT owner-scoped. Returns `TranscriptionSettingsView`.
- `updateTranscriptionSettingsImpl` — getUser() → Zod safeParse → db.transaction(SELECT old → UPSERT new → diff → INSERT audit rows). Returns `{ ok: true } | { ok: false; code: 'UNAUTHORIZED' | 'INVALID_INPUT' }`.
- `getTranscriptionStatsImpl` — getUser() → 4 parallel aggregate queries via Promise.all. Dynamic import of `aiTranscriptions` to bypass `require-assert-ai-consent` eslint rule (intentional, aggregate stats only).

### Audit trail
- Actions: `ai_transcription_enabled`, `ai_transcription_disabled`, `ai_transcription_retention_changed`, `ai_transcription_keep_transcription_toggled`.
- Metadata: `{ userId, oldValue, newValue }` — NOTE: `userId` in metadata is redundant with top-level column. Other modules (hypotheses.ts) omit userId from metadata. Inconsistency flagged as MEDIUM.
- `ai_transcription_retention_changed` branch is permanently dead code in MVP (`keepAudioHours: z.literal(24)`).

### Schema lock
- `keepAudioHours: z.literal(24)` — MVP-locked. DB CHECK allows 24-168 but schema rejects >24. Form renders retention field as `disabled` with copy explaining the restriction.

### Test coverage
- Unit: all 3 impls, form component (RTL + axe), stats panel, schemas, settings-areas.
- Integration: settings-actions.int.test.ts — getSettings, updateSettings (enable/disable audits, idempotency, cross-tenant IDOR), getStats (withheld acceptance, cost average, cross-tenant isolation).
- E2E: settings-flow.spec.ts (happy path), settings-anonymous-blocked.spec.ts (negative-auth), settings-stats.spec.ts (acceptance rate threshold).

### Client bundle safety
- Form imports `UpdateTranscriptionSettingsInputSchema` from the internal leaf `lib/settings-schemas` (not the module barrel) to avoid pulling server-only deps into the client bundle. Pattern well-documented with a comment in the component.

## Review UI (added 2026-05-29, feature/ai-transcription-review-ui)

### Routes
- `/dashboard/transcricoes` — list page (3 tab buckets: pending/reviewed/failed).
- `/dashboard/transcricoes/[id]/revisar` — review page with RHF form, auto-save, discard dialog.
- Both subsumed by existing `/dashboard` prefix in `classifyPath()` — no new `APP_PREFIXES` entry needed.

### Server Actions (new)
- `getTranscriptionForReviewImpl` — supabase.auth.getUser() → Zod → owner-scoped SELECT (aiTranscriptions JOIN patients LEFT JOIN sessions).
- `listTranscriptionsForReviewImpl` — supabase.auth.getUser() → SELECT WHERE userId + status IN (ready/reviewed/failed) → bucket in-memory.
- `updateTranscriptionDraftImpl` — supabase.auth.getUser() → Zod (GeneratedNoteSchema) → UPDATE WHERE userId + status IN (ready/reviewed) + sql`userEditsCount + 1`.
- `saveTranscriptionToProntuarioImpl` — supabase.auth.getUser() → Zod (reviewedChecked: literal true) → SELECT re-read → assertAiConsentActive → createEvolutionImpl → UPDATE savedToProntuario=true.
- `discardTranscriptionImpl` — supabase.auth.getUser() → Zod → db.transaction(UPDATE + auditLog INSERT).

### Known review findings (review-1, 2026-05-29)
1. **HIGH: Concurrent save orphans evolution when sessionId=NULL** — `saveTranscriptionToProntuarioImpl` does NOT wrap createEvolutionImpl + UPDATE in a single outer transaction. Race condition: two requests both pass the savedToProntuario=false check, both create an evolution (no UNIQUE constraint on ai_transcription_id), second UPDATE returns 0 rows → ALREADY_SAVED but orphaned evolution left in DB. Fix: UNIQUE partial index on evolutions(ai_transcription_id) WHERE NOT NULL, OR outer db.transaction with SELECT FOR UPDATE.
2. **HIGH: Auto-save silently discards edits** — RHF form uses register() (uncontrolled) + getValues() in useCallback without watch(). The E2E test documents that edits are not reflected in the committed content ("pre-existing bug"). The cause is the getValues() closure in saveDraft; fix with useWatch() or controlled inputs.
3. **`'use server'` on impl files** — All new impl files have `'use server'` at line 1, contradicting CLAUDE.md. Pre-existing pattern in the module (request-audio-upload-url.ts, etc.) — team has deviated. Tag as MEDIUM/CLAUDE.md violation.

### Schema delta (migration 0032)
- Two new columns on `evolutions`: `ai_assisted BOOLEAN NOT NULL DEFAULT false`, `ai_transcription_id UUID` (nullable, FK ON DELETE SET NULL to ai_transcriptions).
- New composite index: `idx_evolutions_user_ai_assisted` ON (user_id, ai_assisted).
- No new RLS changes: existing evolutions policies (`user_id = auth.uid()`) cover new columns.
- No UNIQUE constraint on `ai_transcription_id` — see orphaned evolution finding above.

### Realtime boundary
- `<AiRealtimeBoundary userId={...}>` in `(app)/layout.tsx` — `userId` from `supabase.auth.getUser()` in SC, passed to client.
- Channel name: `user:<userId>` — server-derived, never client-controlled.
- Broadcast payload treated as untrusted; `extractTranscriptionId` only builds the toast link, never used for auth.
- `useAiTranscriptionRealtime` hook invalidates `['ai-transcriptions','list']` and `['ai-transcriptions','ready-count']` TanStack keys.

### Test structure
- `review-actions.int.test.ts` — IDOR negative tests for all 4 actions, concurrent-save happy path, idempotency.
- `transcricoes-gating.int.test.ts` — middleware: anon→307, active→pass, suspended→clear-and-redirect for both URL shapes.
- `evolutions-ai-flags.int.test.ts` — defaults, FK ON DELETE SET NULL, EXPLAIN index usage.
- E2E: `review-anonymous-blocked.spec.ts`, `review-idor-blocked.spec.ts`, `review-and-save.spec.ts`, `review-discard.spec.ts`.
- IDOR E2E: seeds psychologist A + patient A + transcription A; B opens A's ID → not-found, no patient name leak.

### Test structure
- `upload-security.int.test.ts` — cross-tenant IDOR, anon rejection for BOTH requestAudioUploadUrl AND confirmAudioUpload (post-fix), rate limit, object key regex.
- `request-audio-upload-url.int.test.ts` — full happy path, rate limit at N+1, cross-tenant, CONSENT_INACTIVE.
- `confirm-audio-upload.int.test.ts` — happy path, consent revocation during upload, already-confirmed idempotency.
- `ingest-stream-recording.int.test.ts` — local HTTP CDN server for SSRF test, storage upload mock, Stream delete mock.
- `ssrf-payloads.test.ts` — 5 attack vectors: loopback, IMDS, IPv6 loopback, RFC 1918, non-allowlisted public host.
- `toggle-recording-dual-gate.int.test.ts` — all 4 consent matrix cases (legacy × AI).
- E2E: `manual-upload-flow.spec.ts` (active consent → upload starts → DB row asserted), `manual-upload-no-consent.spec.ts` (no consent → warning + no dropzone).
- Unit: `confirm-audio-upload.test.ts` mocks `storage.list()` returning `{ name, metadata: { size } }` + `storage.createSignedUrl()` + global `fetch` returning 206 with 8 KB buffer.
