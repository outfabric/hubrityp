## 1. Schema extension

- [x] 1.1 Edit `src/shared/db/schema/patients/tables.ts` to add the four columns on `consentTerms`: `kind` (`text`, nullable at first), `revocationTakesEffectImmediately` (`boolean`, nullable at first), `revocationReason` (`text` nullable), `templateVersion` (`integer` default 1).
- [x] 1.2 Run `npm run db:generate`. Open the generated migration; reorder/append SQL so it executes in this order: (a) ADD COLUMN nullable; (b) `UPDATE consent_terms SET kind = 'general', revocation_takes_effect_immediately = false WHERE kind IS NULL`; (c) `ALTER COLUMN kind SET NOT NULL`; (d) `ALTER COLUMN revocation_takes_effect_immediately SET NOT NULL`; (e) `ALTER TABLE consent_terms ADD CONSTRAINT consent_terms_kind_check CHECK (kind IN ('general','ai_recording'))`; (f) `CREATE INDEX idx_consent_terms_user_patient_kind_revoked ON consent_terms (user_id, patient_id, kind, revoked_at)`.
- [x] 1.3 Re-tighten `tables.ts` to mark `kind` and `revocationTakesEffectImmediately` as `notNull()` to match DB; ensure Drizzle types are synced.
- [x] 1.4 Run `npm run db:migrate` against local Postgres. Confirm idempotency: revert and re-apply via Drizzle CLI.
- [x] 1.5 Integration test `src/__tests__/integration/data-layer/consent-terms-kind.int.test.ts`: (a) backfill produced `kind = 'general'` on a row inserted before the migration ran (use Testcontainer migration helpers); (b) CHECK rejects `kind = 'foo'`; (c) `EXPLAIN` of the lookup uses the new index; (d) inserting a row with `kind = 'ai_recording'` and `revocation_takes_effect_immediately = false` succeeds (no constraint coupling the two — the coupling is enforced in app code).

## 2. AI consent template

- [x] 2.1 Create `src/modules/ai-transcription/lib/consent-template.ts` exporting `AI_CONSENT_TEMPLATE_V1` with all 8 sections required by the spec, in pt-BR, plain text (no HTML in fields — render-time component handles markup safely). Each section is `{ heading: string; body: string }`.
- [x] 2.2 Unit test `src/__tests__/unit/modules/ai-transcription/lib/consent-template.test.ts`: (a) all 8 section headings exist; (b) body of "Bases legais" mentions LGPD art. 7, art. 11; (c) body of "Retenção" mentions 24h; (d) body of "Revogação" mentions efeito imediato; (e) snapshot test pinning the exact text (to detect accidental edits) — store JSON of the structure as `.snap` and require deliberate update.
- [x] 2.3 Add a PR description checklist item: "Texto de `AI_CONSENT_TEMPLATE_V1` revisado por responsável legal antes do merge." (No code change; documented in the change PR template.)

## 3. Consent helper (single authority)

- [x] 3.1 Create `src/modules/ai-transcription/lib/consent.ts` exporting `assertAiConsentActive`. Signature: `({ userId: UserId; patientId: PatientId }) => Promise<AssertAiConsentResult>` (discriminated union per the spec). Implementation: SELECT the most recent `ai_recording` row for the patient via Drizzle, computing the four outcomes (`never_signed`, `pending_signature`, `revoked`, `ok`).
- [x] 3.2 Update the module barrel `src/modules/ai-transcription/index.ts` to re-export `assertAiConsentActive` and the `AssertAiConsentResult` type. Edge-safe? The helper uses Drizzle (Node-only), so it MUST NOT be added to `edge.ts` — only to `index.ts`.
- [x] 3.3 Unit test `src/__tests__/unit/modules/ai-transcription/lib/consent.test.ts` — mock the Drizzle client. Cover: (a) no row → `never_signed`; (b) row with `signed_at IS NULL` → `pending_signature`; (c) row signed → `ok` with returned `termId`, `signedAt`, `templateVersion`; (d) row signed then revoked → `revoked`; (e) row expired (token_expires_at < now AND signed_at IS NULL) → `expired`; (f) only the most recent row is considered (insert two rows; assert helper returns the latest).
- [x] 3.4 Integration test `src/__tests__/integration/ai-transcription/consent-helper.int.test.ts` (real Postgres + Drizzle migrations): seed three patients with each of the relevant states; assert the helper returns the right outcome via real DB; assert the helper logs no PII (Pino test transport captures and asserts no `name`/`token`/`reason` keys appear).

## 4. Server Actions in `patients/` module

- [x] 4.1 Create `src/modules/patients/lib/ai-consent-schemas.ts` exporting Zod schemas: `GenerateAiConsentInputSchema = z.object({ patientId: PatientIdSchema })`, `RevokeAiConsentInputSchema = z.object({ patientId: PatientIdSchema, reason: z.string().max(500).nullable() })`, `GetAiConsentStatusInputSchema = z.object({ patientId: PatientIdSchema })`. Output discriminated unions per the spec.
- [x] 4.2 Create `src/modules/patients/server/generate-ai-consent.ts` — Server Action wrapping `generateAiConsentTermImpl`. Flow: `getUser()` → `safeParse(input)` → RLS-scoped Drizzle SELECT to confirm patient ownership → query existing `ai_recording` term (pending or active) → if exists, return `ALREADY_ACTIVE` → generate token (`crypto.randomBytes(32).toString('base64url')`) → INSERT row with `kind='ai_recording'`, `template_version=1`, `template_snapshot=jsonb(AI_CONSENT_TEMPLATE_V1)`, `revocation_takes_effect_immediately=true`, `token_expires_at=now()+7d` → return `{ ok: true, publicUrl, expiresAt }`.
- [x] 4.3 Create `src/modules/patients/server/revoke-ai-consent.ts` — Server Action `revokeAiConsentTermImpl`. Flow: `getUser()` → `safeParse(input)` → query active term → if none, `NOT_FOUND` → UPDATE `revoked_at = now()`, `revocation_reason = reason` → fire-and-forget `inngest.send({ name: 'ai-transcription/consent.revoked', data: { termId, userId, patientId, revokedAt, reason } })` wrapped in try/catch (validate payload first with `consentRevokedEventSchema.parse`) → return `{ ok: true }`.
- [x] 4.4 Create `src/modules/patients/server/get-ai-consent-status.ts` — read-only Server Action returning `AiConsentStatusView`. Uses RLS-scoped client. Maps DB row to UI states.
- [x] 4.5 Update `src/modules/patients/server/index.ts` and the module barrel `src/modules/patients/index.ts` to export the three new Server Actions.
- [x] 4.6 Unit test `src/__tests__/unit/modules/patients/server/generate-ai-consent.test.ts`: (a) anonymous → `UNAUTHORIZED`; (b) patient of another user → `NOT_FOUND` (assert the message DOES NOT leak existence); (c) pending term already exists → `ALREADY_ACTIVE`; (d) signed active term → `ALREADY_ACTIVE`; (e) revoked → allows new generation; (f) success → returned token matches the DB row's token; (g) Zod parse rejects malformed `patientId`.
- [x] 4.7 Unit test `src/__tests__/unit/modules/patients/server/revoke-ai-consent.test.ts`: (a) anonymous → `UNAUTHORIZED`; (b) no active term → `NOT_FOUND`; (c) success path updates `revoked_at` and dispatches event; (d) `inngest.send` throws → DB update still completes; user receives `ok:true`; log line contains `event: 'inngest_send_failed'` and NO PII; (e) `reason` over 500 chars → Zod rejects.
- [x] 4.8 Unit test `src/__tests__/unit/modules/patients/server/get-ai-consent-status.test.ts`: cover all four states (`none`, `pending`, `active`, `revoked`); assert another user's patient yields `none`.

## 5. Integration tests — Server Actions end-to-end

- [x] 5.1 Create `src/__tests__/integration/ai-transcription/generate-ai-consent.int.test.ts` (Testcontainers + real Drizzle). Cover the same scenarios as the unit test but against real DB. Negative auth test: invoke the Server Action with `auth.uid()` of psychologist B against a patient of A; assert `NOT_FOUND` and ZERO new rows in `consent_terms`.
- [x] 5.2 Create `src/__tests__/integration/ai-transcription/revoke-ai-consent.int.test.ts`: revoke a real term; assert subsequent `assertAiConsentActive` returns `revoked`; assert Inngest event was dispatched (mock the Inngest client at module level and verify call args). Cross-tenant: B cannot revoke A's term.
- [x] 5.3 Create `src/__tests__/integration/ai-transcription/get-ai-consent-status.int.test.ts`: seed all four states; assert returned views match DB; cross-tenant assertion.

## 6. Public `/termo/[token]` route extension

- [x] 6.1 Read the current `src/app/termo/[token]/page.tsx` and identify the dispatch point where the term `kind` should branch. Add: lookup the row by token (already done); read `kind`; render either the existing general view or a new `AiConsentView` component for `ai_recording`.
- [x] 6.2 Create `src/app/termo/[token]/_components/ai-consent-view.tsx` (note: `_components` underscore folder to keep it route-private). Renders sections from `template_snapshot` (Zod-validated against `AiConsentTemplateSchema` on read). Includes a checkbox `"Eu li e concordo"`, a text input for the patient's full name (matching for confidence — informational, NOT used for auth), and a submit button. NO `dangerouslySetInnerHTML`.
- [x] 6.3 Add a Route Handler `POST` for sign submission: `src/app/termo/[token]/route.ts` (or rely on Server Action — choose one and document). Validate token; reject if expired; reject if already signed; UPDATE row with `signed_at`, `signed_ip = sha256(remoteIp + SIGNATURE_HASH_SALT)`, `signed_user_agent = sha256(uaHeader + SIGNATURE_HASH_SALT)`. `SIGNATURE_HASH_SALT` is a new server env var (add to `src/shared/env/schemas.ts` — server-only, min 32 chars, REQUIRED). 
- [x] 6.4 Add per-route header `Referrer-Policy: no-referrer` for `/termo/[token]` (extend `next.config.ts` headers function with a route-specific entry).
- [x] 6.5 Unit test `src/__tests__/unit/app/termo/ai-consent-view.test.tsx` (RTL): renders all 8 sections from a snapshot fixture; submit button is disabled until checkbox is checked; clicking submit calls the action; expired state shows "Link expirado" message.
- [x] 6.6 Integration test `src/__tests__/integration/ai-transcription/termo-public-sign.int.test.ts` (Testcontainers): (a) valid unsigned token → POST succeeds, row updates with sha256 hashes (assert length 64, hex); (b) expired token → 410 Gone or equivalent error; (c) already signed → returns "already signed" view; (d) the `Referrer-Policy: no-referrer` header is present on the response; (e) bruteforce: 20 wrong tokens in a row trigger rate limiting (use the existing public-route rate limiter; if absent in this codebase, add a TODO and document).
- [x] 6.7 E2E test (Playwright seeded) `src/__tests__/e2e/seeded/ai-transcription/termo-ai-flow.spec.ts`: psychologist signs in → opens patient → generates AI term → copies link → in a second browser context (anonymous) opens link → reads template (assertion on heading "Bases legais") → checks box → submits → reloads link → sees "já assinado" → back in psychologist UI: `AiConsentPanel` reflects `active`.

## 7. `AiConsentPanel` UI

- [x] 7.1 Create `src/modules/patients/components/ai-consent-panel.tsx`. Use `Card`, `Badge`, `Button` (variants per spec), `AlertDialog` (for destructive revoke). Icons via `lucide-react` (`Sparkles`, `Copy`, `Mail`, `Lock`). State driven by `getAiConsentStatus` via TanStack Query (`useQuery` keyed by `['ai-consent', patientId]`). Mutations (`generate`, `revoke`) via `useMutation` with optimistic update + revert on error + `Sonner` toast.
- [x] 7.2 Use Sálvia tokens only (`brand-500`, `success-500`, `warning-500`, `danger-500`). No hardcoded hex. Dark mode tested in parallel. Spacing per design rules (`Card` padding `space-6` desktop / `space-4` mobile). Microcopy follows the glossary ("Termo", "Vigente", "Revogar", "Paciente").
- [x] 7.3 Embed `<AiConsentPanel patientId={patient.id} />` in `src/app/(app)/pacientes/[id]/page.tsx`, in a logical section near other patient documents.
- [x] 7.4 Unit test `src/__tests__/unit/modules/patients/components/ai-consent-panel.test.tsx` (RTL + MSW for Server Action mocking): one test per state (`none`, `pending`, `active`, `revoked`); assert badges, copy, buttons; assert revoke confirmation requires typing `"REVOGAR"`; assert TanStack Query revalidates after mutation; assert toast appears.
- [x] 7.5 Accessibility test in the same file: keyboard nav (Tab traverses panel; Enter triggers primary button; Escape closes AlertDialog); `aria-label` on icon-only buttons; contrast assertion via axe-core (already in test setup).

## 8. Inngest event + stub consumer

- [x] 8.1 Create `src/modules/ai-transcription/inngest/events.ts` exporting `consentRevokedEventSchema` (Zod) and a TypeScript type `ConsentRevokedEvent = z.infer<typeof consentRevokedEventSchema>`.
- [x] 8.2 Create `src/modules/ai-transcription/inngest/client.ts` exporting `inngest = new Inngest({ id: 'ai-transcription' })`. Mirror the pattern of `src/modules/agenda/inngest/client.ts`.
- [x] 8.3 Create `src/modules/ai-transcription/inngest/on-consent-revoked-stub.ts`: defines `onConsentRevokedStub` via `inngest.createFunction({ id: 'on-consent-revoked-stub', triggers: { event: 'ai-transcription/consent.revoked' } }, async ({ event, step }) => { logger.info({ event: 'ai-transcription/consent.revoked.received', termId, userId, patientId }, 'received'); })`. NO `reason` in the log line.
- [x] 8.4 Register the function in `src/app/api/inngest/route.ts` — add to the `functions` array.
- [x] 8.5 Unit test `src/__tests__/unit/modules/ai-transcription/inngest/events.test.ts`: (a) `consentRevokedEventSchema.parse` accepts a valid payload; (b) rejects missing `termId`; (c) rejects `reason` > 500 chars; (d) coerces ISO string to Date.
- [x] 8.6 Integration test `src/__tests__/integration/ai-transcription/consent-revoked-event.int.test.ts`: dispatch a valid event via the Inngest dev server; assert `onConsentRevokedStub` runs; capture log; assert log contains the three IDs and does NOT contain `reason`.

## 9. ESLint guardrail for future server code

- [ ] 9.1 Add to `eslint.config.mjs` a `no-restricted-imports` rule scoped to `src/modules/ai-transcription/server/**` and `src/modules/ai-transcription/inngest/**`: forbid importing `aiTranscriptions` (the Drizzle table) unless the SAME file also imports `assertAiConsentActive`. Implement via a custom rule under `eslint-rules/require-assert-ai-consent.cjs` or, if simpler, a `forbid-import-without-pair` pattern with an explanatory error message. (If a custom rule is overkill, fall back to: a `// @consent-gated` comment that a unit test scans for.) Document the chosen mechanism in this change's PR description.
- [ ] 9.2 Unit test `src/__tests__/unit/eslint-rules/require-assert-ai-consent.test.ts`: feed two fixture files (one with both imports, one missing `assertAiConsentActive`) and assert the lint passes/fails appropriately.

## 10. Sanity

- [ ] 10.1 Run `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e:seeded` end-to-end. All green.
- [ ] 10.2 Manually verify in the running app: create a patient, click "Gerar termo", copy the link, open in incognito, sign, return to psychologist view and confirm `active` state. Then revoke and confirm `revoked` state.
- [ ] 10.3 Update the change-folder PR description with: (a) summary of new env var `SIGNATURE_HASH_SALT`; (b) note that legal sign-off on `AI_CONSENT_TEMPLATE_V1` is required.
