## 1. Schema delta in `evolutions`

- [x] 1.1 In `src/shared/db/schema/medical-records/tables.ts`: add `aiAssisted: boolean('ai_assisted').notNull().default(false)` and `aiTranscriptionId: uuid('ai_transcription_id').references(() => aiTranscriptions.id, { onDelete: 'set null' })`. Update Drizzle relations.
- [x] 1.2 Run `npm run db:generate`. Inspect: migration adds the two columns + index `idx_evolutions_user_ai_assisted` on `(user_id, ai_assisted)`.
- [x] 1.3 Run `npm run db:migrate`. Idempotency check.
- [x] 1.4 Integration test `src/__tests__/integration/data-layer/evolutions-ai-flags.int.test.ts`: (a) defaults are `false`/`NULL`; (b) FK ON DELETE SET NULL works; (c) `EXPLAIN` of `WHERE user_id = X AND ai_assisted = true` uses the new index.

## 2. Extend `createEvolutionImpl`

- [x] 2.1 In `src/modules/medical-records/server/create-evolution.ts`: extend the input type with optional `aiAssisted?: boolean` and `aiTranscriptionId?: string | null`. Zod schema updated. INSERT statement sets the new columns from the parameters.
- [x] 2.2 Update the module barrel `src/modules/medical-records/index.ts` if needed (export types).
- [x] 2.3 Unit test `src/__tests__/unit/modules/medical-records/server/create-evolution-ai-flags.test.ts`: (a) default omits → `ai_assisted=false, ai_transcription_id=null`; (b) `aiAssisted=true, aiTranscriptionId=tx` → row has those values; (c) all existing tests on `createEvolutionImpl` still pass.

## 3. Middleware gating

- [x] 3.1 In `src/middleware.ts:classifyPath()`: add the `/dashboard/transcricoes*` prefix to the `'app'` class.
- [x] 3.2 Integration test `src/__tests__/integration/middleware/transcricoes-gating.int.test.ts`: anonymous → 307 to `/login?from=...` for both `/dashboard/transcricoes` and `/dashboard/transcricoes/abc/revisar`; Active user → pass-through; Suspended user → cleared-and-redirected per existing policy.

## 4. Server Actions in `ai-transcription/server/`

- [x] 4.1 Create `src/modules/ai-transcription/lib/review-schemas.ts` exporting Zod schemas: `GetTranscriptionForReviewInputSchema`, `UpdateTranscriptionDraftInputSchema` (incorporates `GeneratedNoteSchema`), `SaveTranscriptionToProntuarioInputSchema` (includes `reviewedChecked: z.literal(true)`), `DiscardTranscriptionInputSchema`. Output discriminated unions.
- [x] 4.2 Create `src/modules/ai-transcription/server/get-transcription-for-review.ts`. Flow per spec: getUser → safeParse → RLS-scoped SELECT JOIN → JSONB Zod validation (drift detection logs `note_schema_drift` with `transcriptionId` only) → return shape.
- [x] 4.3 Create `src/modules/ai-transcription/server/update-transcription-draft.ts`. Idempotent UPDATE with row-not-found → `NOT_EDITABLE`.
- [x] 4.4 Create `src/modules/ai-transcription/server/save-transcription-to-prontuario.ts`. Transactional: re-read → call `createEvolutionImpl({ aiAssisted: true, aiTranscriptionId })` → UPDATE `ai_transcriptions`. Idempotency via `saved_to_prontuario = false` predicate in the WHERE clause.
- [x] 4.5 Create `src/modules/ai-transcription/server/discard-transcription.ts`. UPDATE + audit log entry via existing audit helper (if absent, use the project's standard `logAuditEvent` from `audit-log` module).
- [x] 4.6 Export all four from `src/modules/ai-transcription/server/index.ts` and the module barrel.
- [x] 4.7 Unit test `src/__tests__/unit/modules/ai-transcription/server/get-transcription-for-review.test.ts`: anonymous; IDOR; happy; schema drift; PII not logged.
- [x] 4.8 Unit test `src/__tests__/unit/modules/ai-transcription/server/update-transcription-draft.test.ts`: increment counter; status='pending' → NOT_EDITABLE; IDOR.
- [x] 4.9 Unit test `src/__tests__/unit/modules/ai-transcription/server/save-transcription-to-prontuario.test.ts`: happy path creates evolution with flags; `reviewedChecked=false` → MUST_REVIEW (Zod); already saved → ALREADY_SAVED; transaction rollback if `createEvolutionImpl` throws.
- [x] 4.10 Unit test `src/__tests__/unit/modules/ai-transcription/server/discard-transcription.test.ts`: idempotency; audit row created.
- [x] 4.11 Integration test `src/__tests__/integration/ai-transcription/review-actions.int.test.ts`: all 4 actions exercised end-to-end via Testcontainers + Drizzle; cross-tenant assertions on each.

## 5. Status badge + helpers (small components)

- [x] 5.1 Create `src/modules/ai-transcription/components/transcription-status-badge.tsx`: maps statuses to Sálvia variants (`pending/transcribing/generating` → `neutral` "Processando"; `ready` → `info` "Pronta para revisão"; `reviewed` → `success` "Salva no prontuário"; `failed` → `danger` "Falhou"; `cancelled` → `warning` "Cancelada"). Includes appropriate Lucide icons.
- [x] 5.2 Unit test `src/__tests__/unit/modules/ai-transcription/components/transcription-status-badge.test.tsx`: snapshot per status; aria-label asserted.

## 6. Banners

- [x] 6.1 Create `src/modules/ai-transcription/components/draft-warning-banner.tsx`: `Alert` variant warning, sticky top, copy in pt-BR per spec.
- [x] 6.2 Create `src/modules/ai-transcription/components/risk-alert-banner.tsx`: receives `riskAlerts: RiskAlert[]`. Maps `kind` to pt-BR label via a tiny lookup table. List of trimmed excerpts (max 200 chars displayed; full text available via tooltip — or truncated with ellipsis, given the Sálvia rule that tooltips don't carry critical info, the full text should be on click → small drawer). `role="alert"`, auto-focuses on mount.
- [x] 6.3 Unit test `src/__tests__/unit/modules/ai-transcription/components/risk-alert-banner.test.tsx`: renders all 5 risk kinds with pt-BR labels; sets focus on mount; respects `prefers-reduced-motion`.

## 7. Page: list `/dashboard/transcricoes`

- [x] 7.1 Create `src/app/(app)/dashboard/transcricoes/page.tsx` (Server Component). Fetches the list via a new helper `listTranscriptionsForReview(userId, filter)` in `ai-transcription/server/`. Renders `Tabs` ("Pendentes", "Revisadas", "Falhas"), `Card` per item with name, date, template, status badge, link.
- [x] 7.2 Create `src/modules/ai-transcription/server/list-transcriptions.ts`: query with RLS-scoped client + ordering rules from the spec.
- [x] 7.3 Empty state component `src/modules/ai-transcription/components/transcriptions-empty-state.tsx`: 3-part empty state per Sálvia (what's missing, why it matters, what to do).
- [x] 7.4 Unit test `src/__tests__/unit/app/dashboard/transcricoes/page.test.tsx` (RTL with mocked Server Action): tabs filter correctly; empty state renders when none; clicking a card navigates.

## 8. Page: review `/dashboard/transcricoes/[id]/revisar`

- [ ] 8.1 Create `src/app/(app)/dashboard/transcricoes/[id]/revisar/page.tsx` (Server Component). Calls `getTranscriptionForReview`; renders header + status badge + banners + form. If `status='failed'`/`'cancelled'`: render a different layout.
- [ ] 8.2 Create `src/app/(app)/dashboard/transcricoes/[id]/revisar/_components/transcription-review-form.tsx` (Client Component). Uses `react-hook-form` + Zod resolver. Fields: TextArea per array field of the note, single inputs for `humorInicial`/`humorFinal`. Auto-save every 10s + on-blur via debounce → calls `updateTranscriptionDraft`. `"Salvo às HH:MM"` indicator. Checkbox `"Revisei a nota..."`. Three action buttons.
- [ ] 8.3 The danger button opens a `AlertDialog` with input requiring `"DESCARTAR"` to confirm; on confirm → `discardTranscription` then router push to `/dashboard/pacientes/<patientId>/evolucoes/nova?sessionId=...`.
- [ ] 8.4 Unit test `src/__tests__/unit/app/dashboard/transcricoes/review/transcription-review-form.test.tsx`: (a) all fields render with initial values; (b) checkbox unchecked → save button disabled; (c) auto-save fires after 10s (use fake timers); (d) successful save shows toast and navigates; (e) discard confirmation requires typed input; (f) failed-status branch renders retry button.
- [ ] 8.5 Accessibility test in the same file: keyboard nav covers all controls; risk banner gets focus on mount; `Esc` closes `AlertDialog`; axe-core passes.

## 9. Realtime subscriber

- [ ] 9.1 Create `src/modules/ai-transcription/hooks/use-ai-transcription-realtime.ts` (Client hook). Subscribes via `supabase.channel('ai-transcription:user:' + userId)`. On `ready`: invalidates `['ai-transcriptions','list']` and `['ai-transcriptions','ready-count']`; fires Sonner toast with `"Ver"` action.
- [ ] 9.2 Mount the hook in `src/app/(app)/layout.tsx` via a small `<AiRealtimeBoundary>` Client Component to keep the layout server-rendered.
- [ ] 9.3 Unit test `src/__tests__/unit/modules/ai-transcription/hooks/use-ai-transcription-realtime.test.ts`: mock `supabase.channel`; simulate `ready` event; assert TanStack `invalidateQueries` called with the right keys; assert Sonner toast appears (use `sonner` testing utils or capture via library mock).
- [ ] 9.4 Integration test `src/__tests__/integration/ai-transcription/realtime-subscriber.int.test.ts` (Supabase local stack): boot the layout, send a real broadcast, assert toast.

## 10. Agenda card AI badge

- [ ] 10.1 Update `src/modules/agenda/components/session-card.tsx`: query `ai_transcriptions` for the session (via a TanStack hook or via prop drilling from a parent batched query). When at least one `status='ready' AND saved_to_prontuario=false`, render `<Badge variant="brand"><Sparkles /> Nota IA</Badge>` clickable to the review page.
- [ ] 10.2 Unit test update for `src/__tests__/unit/modules/agenda/components/session-card.test.tsx` (or new file): badge appears for ready transcription; absent for reviewed; aria-label correct; keyboard activable.

## 11. Negative-auth + security tests

- [ ] 11.1 E2E test (Playwright seeded) `src/__tests__/e2e/seeded/ai-transcription/review-anonymous-blocked.spec.ts`: anonymous → `/dashboard/transcricoes` → redirect to `/login`.
- [ ] 11.2 E2E test `src/__tests__/e2e/seeded/ai-transcription/review-idor-blocked.spec.ts`: psychologist B logs in, opens A's `transcriptionId` URL → sees not-found page (no patient name leak).
- [ ] 11.3 E2E happy `src/__tests__/e2e/seeded/ai-transcription/review-and-save.spec.ts`: with a seeded ready transcription → open review page → edit → check the box → save → assert an evolution exists with `ai_assisted=true` and `ai_transcription_id` set; assert UI redirects to the evolution detail or list with success toast.
- [ ] 11.4 E2E discard `src/__tests__/e2e/seeded/ai-transcription/review-discard.spec.ts`: open → discard → confirm → redirected to new-evolution flow.

## 12. Sanity

- [ ] 12.1 Run `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e:seeded`. All green.
- [ ] 12.2 Manual smoke: full flow from agenda badge click → review → save → confirm evolution.
- [ ] 12.3 Update runbook doc with: how to retry a failed transcription from the review UI; what `ai_assisted` means in exports.
