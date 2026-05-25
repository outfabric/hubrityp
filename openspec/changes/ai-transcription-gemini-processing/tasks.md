## 1. Schema delta (cancelled + cost columns)

- [ ] 1.1 In `src/shared/db/schema/ai-transcription/tables.ts`: extend the `status` enum/CHECK to include `cancelled`. Add columns `transcriptionCostUsd: numeric('transcription_cost_usd', { precision: 10, scale: 4 })` and `llmCostUsd: numeric('llm_cost_usd', { precision: 10, scale: 4 })`. Both nullable.
- [ ] 1.2 Run `npm run db:generate`. Inspect: the migration should have an `ALTER TABLE ai_transcriptions DROP CONSTRAINT ai_transcriptions_status_check; ADD CONSTRAINT ai_transcriptions_status_check CHECK (status IN ('pending','transcribing','generating','ready','reviewed','failed','cancelled'))`, plus the two ADD COLUMN.
- [ ] 1.3 Run `npm run db:migrate` locally. Confirm idempotency.
- [ ] 1.4 Integration test `src/__tests__/integration/data-layer/ai-transcription-status-enum.int.test.ts`: (a) UPDATE to `cancelled` accepted; (b) UPDATE to `archived` rejected; (c) cost columns default NULL; (d) cost columns accept decimal values.

## 2. Dependencies and Gemini client

- [ ] 2.1 Add `zod-to-json-schema` to `dependencies`. Run `npm install`.
- [ ] 2.2 Create `src/modules/ai-transcription/server/gemini-client.ts` with `import 'server-only'` first line. Exports `getGeminiClient()` (singleton, `new GoogleGenAI({ apiKey: serverEnv.GEMINI_API_KEY })`).
- [ ] 2.3 Update `eslint.config.mjs`: in the existing `no-restricted-imports` rule for `src/modules/ai-transcription/**`, allowlist `server/gemini-client.ts` for `@google/genai`.
- [ ] 2.4 Unit test `src/__tests__/unit/modules/ai-transcription/server/gemini-client.test.ts`: assert `getGeminiClient()` is a singleton (same reference across two calls); assert importing in a test that emulates 'use client' fails (use a dynamic import with a stubbed `server-only` that throws — done via Vitest module mock).

## 3. JSON Schema for Gemini

- [ ] 3.1 Create `src/modules/ai-transcription/server/json-schemas/gemini-note.ts`: run `zodToJsonSchema(GeneratedNoteSchema, { name: 'GeneratedNote', $refStrategy: 'none' })` at module load; cache as `GeminiNoteJsonSchema`. Strip the `$schema` key (Gemini doesn't accept it). Boot-time sanity check: throws if `required` does not include `schemaVersion`, `pauta`, `conteudoTrabalhado`, `tarefaCasa`, `palavrasRisco`.
- [ ] 3.2 Unit test `src/__tests__/unit/modules/ai-transcription/server/json-schemas/gemini-note.test.ts`: shape assertions; conversion is stable across two imports (deep equal); modifying `GeneratedNoteSchema` to drop a required field causes the boot-time check to throw (use a test-only re-import with a mocked schema).

## 4. Prompts (versioned, template-specific)

- [ ] 4.1 Create `src/modules/ai-transcription/server/prompts/transcription.ts` exporting `PROMPT_VERSION = 1` and `TRANSCRIPTION_SYSTEM_INSTRUCTION` (pt-BR, literal, no interpretation).
- [ ] 4.2 Create one file per template: `note-tcc.ts`, `note-psicanalise.ts`, `note-sistemica.ts`, `note-aba.ts`, `note-livre.ts`. Each exports `PROMPT_VERSION` and `buildSystemInstruction(sensitivity)`.
- [ ] 4.3 Create `src/modules/ai-transcription/server/prompts/index.ts` exporting a `getNotePromptModule(template)` switch.
- [ ] 4.4 Unit test `src/__tests__/unit/modules/ai-transcription/server/prompts/prompts.test.ts`: (a) all 5 templates resolvable via `getNotePromptModule`; (b) each prompt includes "Não invente conteúdo" and "[não mencionado]" and "Não faça interpretações clínicas profundas"; (c) sensitivity values produce different strings; (d) `PROMPT_VERSION` is a positive integer in each file.

## 5. Pricing module

- [ ] 5.1 Create `src/modules/ai-transcription/lib/pricing.ts` exporting `PRICING_VERSION = 1`, a table mapping model name → `{ inputUsdPerMillionTokens, outputUsdPerMillionTokens }`, and `computeCost({ model, inputTokens, outputTokens }): number | null` (returns null if model unknown).
- [ ] 5.2 Unit test `src/__tests__/unit/modules/ai-transcription/lib/pricing.test.ts`: known model → correct math; unknown model → null; zero tokens → 0.

## 6. Main pipeline: `processAudioTranscription` (Inngest function)

- [ ] 6.1 Create `src/modules/ai-transcription/inngest/process-audio-transcription.ts`. Define the function via `inngest.createFunction({ id: 'process-audio-transcription', triggers: { event: 'ai-transcription/audio.uploaded' } }, async ({ event, step }) => { ... })`. Implement steps 1-13 per the spec.
- [ ] 6.2 In `src/app/api/inngest/route.ts`: register `processAudioTranscription`; REMOVE `onAudioUploadedStub` (rename file to `_obsolete-on-audio-uploaded-stub.ts` then delete in a separate commit if you want a safer rollback, OR just delete — choose whatever the dev team prefers; default: delete).
- [ ] 6.3 Helper `src/modules/ai-transcription/server/realtime/broadcast.ts` — `broadcastAiReady({ userId, transcriptionId })`. Wraps `supabase.channel().send(...)` with try/catch. Errors logged with `event: 'realtime_broadcast_failed'`.
- [ ] 6.4 Unit test `src/__tests__/unit/modules/ai-transcription/inngest/process-audio-transcription.test.ts` — mock the Gemini client, Drizzle, Storage, consent helper, realtime helper. Cover scenarios from the spec: happy path; consent inactive at start (NonRetriableError, no DB writes after); idempotent re-run; pseudonymization applied (capture the prompt argument and assert no patient name strings); invalid JSON → retriable; safety block → NonRetriable; rate limit 429 → retriable; cost computed.
- [ ] 6.5 Integration test `src/__tests__/integration/ai-transcription/process-audio-transcription.int.test.ts` — Testcontainers + real Drizzle + a mock Gemini API via MSW (fixtures for `files.upload`, `generateContent`). Cover: end-to-end happy path; consent revoked mid-pipeline (consent revoked between step 1 and step 8 — set up via a parallel setTimeout that revokes the term); invalid JSON; safety block.

## 7. Cron: `discardOldAudios`

- [ ] 7.1 Create `src/modules/ai-transcription/inngest/discard-old-audios.ts` with `inngest.createFunction({ id: 'discard-old-audios', triggers: { cron: '0 * * * *' } }, ...)`. Implement the query and the per-row deletion per spec. Use service-role for Storage delete (justify in comment).
- [ ] 7.2 Unit test `src/__tests__/unit/modules/ai-transcription/inngest/discard-old-audios.test.ts` — mock Drizzle/Storage. Cover: 24h threshold default; per-user `keep_audio_hours` honored; Storage delete failure on one row does not block others; row already discarded skipped.
- [ ] 7.3 Integration test `src/__tests__/integration/ai-transcription/discard-old-audios.int.test.ts` — real Testcontainer Postgres + a mocked Storage that records deletes. Seed rows at varying ages and per-user settings. Run the cron tick. Assert: rows older than the user's threshold are discarded; younger rows untouched; `EXPLAIN` of the query uses the partial index.

## 8. Cron: `purgeFailedAudios`

- [ ] 8.1 Create `src/modules/ai-transcription/inngest/purge-failed-audios.ts` similar to above with cron `15 * * * *`. Predicate: `status IN ('failed','cancelled') AND audio_object_key IS NOT NULL AND coalesce(completed_at, updated_at) < now() - INTERVAL '1 hour'`.
- [ ] 8.2 Unit test `src/__tests__/unit/modules/ai-transcription/inngest/purge-failed-audios.test.ts`: predicate honored; recent failures not purged.
- [ ] 8.3 Integration test `src/__tests__/integration/ai-transcription/purge-failed-audios.int.test.ts`: rows in both states, assert correct selection.

## 9. Consent revocation handler (real)

- [ ] 9.1 Create `src/modules/ai-transcription/inngest/on-consent-revoked.ts` replacing the stub from `ai-transcription-consent`. Triggered by `ai-transcription/consent.revoked`. Implementation per spec.
- [ ] 9.2 In `src/app/api/inngest/route.ts`: register the new function; REMOVE the stub registration.
- [ ] 9.3 Unit test `src/__tests__/unit/modules/ai-transcription/inngest/on-consent-revoked.test.ts`: (a) `pending` row → marked `cancelled`; (b) `transcribing` row → unchanged + log line; (c) `generating` row → unchanged + log line; (d) `ready`/`reviewed` rows → not affected.
- [ ] 9.4 Integration test `src/__tests__/integration/ai-transcription/consent-revoked-cancels-pending.int.test.ts`: seed 4 rows (one per status), dispatch the event, assert each row's outcome via real DB.

## 10. SSRF / network safety inside the pipeline

- [ ] 10.1 Confirm `download-audio` only uses internal Storage SDK (no user-controlled URL); add comment explicitly noting "URL is server-generated from `audio_object_key`, never client input".
- [ ] 10.2 Confirm `delete-gemini-file` uses the Gemini SDK with a server-owned file name (returned by `files.upload`), not user input.
- [ ] 10.3 Add a unit test that proves the pipeline does NOT execute arbitrary URLs by feeding a malformed row whose `audio_object_key` contains `../`/`%00`/etc. (Storage SDK should reject; we ASSERT it). `src/__tests__/unit/modules/ai-transcription/inngest/path-injection.test.ts`.

## 11. Pseudonymization end-to-end assertion

- [ ] 11.1 Unit test `src/__tests__/unit/modules/ai-transcription/inngest/pseudonymization-end-to-end.test.ts`: mock Gemini and capture every `generateContent` call's `contents` and `systemInstruction`. Run the pipeline with `patientFirstName='Maria'`, `patientFullName='Maria Souza Lima'`, a transcript fixture mentioning the name 3 times. Assert: (a) the transcription step's contents have nothing about the patient (transcription only sees audio); (b) the note step's contents contain `"Paciente"` and NOT `"Maria"`/`"Souza"`/`"Lima"`; (c) no log line over the whole run contains the patient name (capture pino destination).

## 12. Logging redaction integration

- [ ] 12.1 Integration test `src/__tests__/integration/ai-transcription/log-redaction.int.test.ts`: run the pipeline with a real-shaped row; capture all pino lines via a buffer; assert no line contains `transcript`, `generatedNote`, `riskAlerts`, `patientName` raw values (they appear as `[REDACTED]` if logged at all).

## 13. Realtime broadcast

- [ ] 13.1 Wire the broadcast in step 13 of the pipeline.
- [ ] 13.2 Unit test `src/__tests__/unit/modules/ai-transcription/server/realtime/broadcast.test.ts`: assert `broadcastAiReady` calls `supabase.channel('ai-transcription:user:' + userId).send(...)`; failure swallowed.
- [ ] 13.3 Integration test `src/__tests__/integration/ai-transcription/realtime-broadcast.int.test.ts` (using Supabase local stack): subscribe two test clients (A and B). Run the pipeline for A. Assert A receives the `ready` event; B does NOT.

## 14. End-to-end (seeded)

- [ ] 14.1 E2E test `src/__tests__/e2e/seeded/ai-transcription/full-pipeline-mock-gemini.spec.ts`: psychologist logs in → patient with active term + uploaded audio (seed) → trigger the Inngest function via the test harness → wait for Realtime `ready` → assert UI badge appears (the actual review UI is the next change, so for now just assert the indicator on the agenda/patient page if any minimal hint exists; OR adapt this test to a hook that polls the DB for `status='ready'` and asserts the row state).

## 15. Documentation

- [ ] 15.1 Update `docs/runbooks/ai-transcription-upload.md` (created in audio-upload change) with: (a) how to re-process a failed row; (b) error code glossary now including `gemini_429`, `gemini_safety_block`, `gemini_5xx`, `invalid_response_schema`, `consent_revoked`; (c) how to inspect the discard cron status in the Inngest dashboard.
- [ ] 15.2 Add `docs/runbooks/ai-transcription-cost.md`: how to read `transcription_cost_usd`/`llm_cost_usd` columns; how to bump pricing in `lib/pricing.ts`.

## 16. Sanity

- [ ] 16.1 Run `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e:seeded`. All green.
- [ ] 16.2 Manual smoke (local docker compose): upload a small MP3 with a real `GEMINI_API_KEY` (developer's personal); confirm `status='ready'`; inspect `generated_note` JSONB structure; confirm Realtime broadcast hits the dashboard.
- [ ] 16.3 PR description checklist: (a) Inngest dashboard alert configured for `discardOldAudios` failures; (b) cost columns reviewed; (c) prompt versions documented.
