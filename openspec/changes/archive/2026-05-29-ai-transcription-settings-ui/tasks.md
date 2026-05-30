## 1. Schemas

- [x] 1.1 Create `src/modules/ai-transcription/lib/settings-schemas.ts` exporting `UpdateTranscriptionSettingsInputSchema` (Zod object: `enabled: boolean`, `defaultTemplate: TranscriptionTemplateSchema`, `riskDetectionSensitivity: RiskSensitivitySchema`, `keepAudioHours: z.literal(24)` (MVP-locked), `keepTranscription: boolean`) and `TranscriptionSettingsViewSchema` (the same shape, used for typing the read).
- [x] 1.2 Create `src/modules/ai-transcription/lib/stats-schemas.ts` exporting `TranscriptionStatsViewSchema`: object with `totalProcessed, monthProcessed, reviewed, savedToProntuario, estimatedMinutesSaved, acceptanceRatePercent (nullable), avgCostUsd (nullable), failedCount`.
- [x] 1.3 Unit test `src/__tests__/unit/modules/ai-transcription/lib/settings-schemas.test.ts`: (a) accepts valid input; (b) rejects `keepAudioHours=48` (MVP-locked); (c) rejects unknown template; (d) rejects unknown sensitivity.

## 2. Server Actions

- [x] 2.1 Create `src/modules/ai-transcription/server/get-transcription-settings.ts`: getUser → upsert default row if missing → return current values typed by `TranscriptionSettingsViewSchema`.
- [x] 2.2 Create `src/modules/ai-transcription/server/update-transcription-settings.ts`: getUser → safeParse → SELECT old values → UPSERT new values → diff old vs new → write audit log rows per the spec mapping → return `{ ok: true }`.
- [x] 2.3 Create `src/modules/ai-transcription/server/get-transcription-stats.ts`: 4 parallel queries via `Promise.all` (counts, costs, etc.). Compute derived fields. Withhold acceptance rate when `reviewed < 5`. RLS-scoped client.
- [x] 2.4 Export from `src/modules/ai-transcription/server/index.ts` and the module barrel.
- [x] 2.5 Unit test `src/__tests__/unit/modules/ai-transcription/server/get-transcription-settings.test.ts`: (a) first call inserts defaults; (b) subsequent call reads existing row; (c) anonymous rejected.
- [x] 2.6 Unit test `src/__tests__/unit/modules/ai-transcription/server/update-transcription-settings.test.ts`: (a) anonymous rejected; (b) Zod rejects invalid; (c) enabling triggers `ai_transcription_enabled` audit; (d) disabling triggers `ai_transcription_disabled` audit; (e) idempotent re-save without change emits NO audit; (f) UPSERT is keyed by `auth.uid()` (input cannot forge user_id).
- [x] 2.7 Unit test `src/__tests__/unit/modules/ai-transcription/server/get-transcription-stats.test.ts`: (a) empty user → all zeros + nulls; (b) full user with 10 reviewed / 7 saved without edits → acceptance 70%; (c) `reviewed < 5` → acceptance null; (d) costs averaged correctly.
- [x] 2.8 Integration test `src/__tests__/integration/ai-transcription/settings-actions.int.test.ts` (Testcontainers + Drizzle): exercise the 3 actions end-to-end; cross-tenant assertion (B cannot update A's settings).

## 3. Page + components

- [x] 3.1 Create `src/app/(app)/configuracoes/transcricao-ia/page.tsx` as Server Component: getUser → `getTranscriptionSettings` + `getTranscriptionStats` (parallel `Promise.all`) → render layout with `<TranscriptionSettingsForm>` and `<TranscriptionStatsPanel>`.
- [x] 3.2 Create `src/app/(app)/configuracoes/transcricao-ia/_components/transcription-settings-form.tsx` (Client). Use `react-hook-form` + Zod resolver. Render controls per the spec. On submit: call `updateTranscriptionSettings` → toast → router refresh (revalidate stats panel).
- [x] 3.3 Add the disable-confirmation `AlertDialog`: when `enabled` changed from `true` to `false`, intercept submit, open dialog, only call the action on confirm.
- [x] 3.4 Create `src/app/(app)/configuracoes/transcricao-ia/_components/transcription-stats-panel.tsx` (Server Component). Renders 4 cards or the empty state per spec.
- [x] 3.5 Unit test `src/__tests__/unit/app/configuracoes/transcricao-ia/transcription-settings-form.test.tsx` (RTL): defaults render; toggling switch and saving calls the action with the right payload; disabling shows AlertDialog; toast appears on success/error; axe-core passes.
- [x] 3.6 Unit test `src/__tests__/unit/app/configuracoes/transcricao-ia/transcription-stats-panel.test.tsx`: empty state when `totalProcessed=0`; correct rendering for populated stats; "Dados insuficientes" appears when `acceptanceRatePercent=null`; Sálvia classes applied.

## 4. Settings shell updates

- [x] 4.1 Edit `src/app/(app)/configuracoes/settings-areas.ts`: add the new `transcricao-ia` entry per spec.
- [x] 4.2 Edit `src/app/(app)/configuracoes/breadcrumb-labels.ts`: add `'transcricao-ia': 'Transcrição IA'`.
- [x] 4.3 Unit test `src/__tests__/unit/app/configuracoes/settings-areas.test.ts` (extend if exists, else create): assert the new entry exists, icon is `Sparkles`, href matches; assert every entry in `settings-areas` has a corresponding label in `breadcrumb-labels`.
- [x] 4.4 Update the existing settings index test (`src/__tests__/unit/app/configuracoes/page.test.tsx` if present) to assert the new card renders.

## 5. E2E

- [x] 5.1 E2E test (Playwright seeded) `src/__tests__/e2e/seeded/ai-transcription/settings-flow.spec.ts`: psychologist logs in → goes to `/configuracoes` → clicks Transcrição IA card → settings form renders → enables the feature → changes the template → saves → toast appears → revisits the page → values persisted.
- [x] 5.2 E2E negative `src/__tests__/e2e/seeded/ai-transcription/settings-anonymous-blocked.spec.ts`: anonymous → `/configuracoes/transcricao-ia` → redirect to `/login`.
- [x] 5.3 E2E stats `src/__tests__/e2e/seeded/ai-transcription/settings-stats.spec.ts`: with seeded transcriptions (3 reviewed, 1 saved-without-edits) → page shows "Dados insuficientes" (since reviewed < 5). Then seed 10 more (7 saved-without-edits) → revisit → page shows ~70%.

## 6. Sanity and PR review

- [x] 6.1 Run `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e:seeded`. All green.
- [x] 6.2 Manual smoke: full settings flow + verify pipeline behavior on next transcription respects new `defaultTemplate` and `riskDetectionSensitivity`.
- [x] 6.3 Update PR description: confirm `keepAudioHours` UI is intentionally MVP-locked to 24h; future increase requires updating `AI_CONSENT_TEMPLATE_V1` + legal sign-off.
- [x] 6.4 Update runbook `docs/runbooks/ai-transcription-settings.md` (new): explain each control, audit log mapping, stats methodology.
