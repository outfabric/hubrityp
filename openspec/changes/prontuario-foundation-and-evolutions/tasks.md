## 1. Middleware Defensive Sweep

- [x] 1.1 Update `classifyPath()` in `src/middleware.ts` to classify `/pacientes`, `/agenda`, `/caixa-de-entrada`, `/configuracoes` as `'app'` (using the same strict prefix+separator pattern as `/dashboard`)
- [x] 1.2 **Integration tests:** Create `src/__tests__/integration/middleware/app-route-gating.int.test.ts` — test that unauthenticated GET to `/pacientes`, `/pacientes/abc/prontuario`, `/agenda`, `/caixa-de-entrada`, `/configuracoes` all redirect to `/login?redirectTo=...`. Test that `/dashboardnews` remains public (boundary). Test that existing `/dashboard` behavior is unchanged

## 2. Database Schema — Medical Records Domain

- [x] 2.1 Create `src/shared/db/schema/medical-records/tables.ts` with Drizzle definitions for `evolutions`, `evolution_versions`, and `audit_log` (columns, indexes, unique constraints per design.md)
- [x] 2.2 Create `src/shared/db/schema/medical-records/policies.ts` with RLS SQL arrays: `evolutionsPolicies` (SELECT/INSERT/UPDATE only, user_id scoped), `evolutionVersionsPolicies` (JOIN-scoped via evolutions.user_id), `auditLogPolicies` (SELECT only for authenticated, no INSERT/UPDATE/DELETE)
- [x] 2.3 Create `src/shared/db/schema/medical-records/index.ts` barrel re-exporting tables and policies
- [x] 2.4 Update `src/shared/db/schema/index.ts` to add `export * from './medical-records/tables';`
- [x] 2.5 Run `npm run db:generate`, manually append RLS policies + FK constraints (user_id -> auth.users, patient_id -> patients, session_id -> sessions with UNIQUE, evolution_id -> evolutions ON DELETE CASCADE) to the generated migration file
- [x] 2.6 Run `npm run db:migrate` locally and verify tables exist
- [x] 2.7 **Integration tests:** Create `src/__tests__/integration/medical-records/schema.int.test.ts` — verify all three tables exist, RLS is enabled on each, expected policies exist (SELECT/INSERT/UPDATE on evolutions, SELECT/INSERT/UPDATE on evolution_versions, SELECT-only on audit_log), no DELETE policy on any table, UNIQUE constraint on evolutions.session_id, UNIQUE on (evolution_id, version_number)

## 3. Module Foundation — Lib (Zod Schemas + Helpers)

- [x] 3.1 Create `src/modules/medical-records/lib/template-types.ts` — export `TemplateType` union type ('tcc'|'psicanalise'|'sistemica'|'aba'|'livre'|'custom'), `TEMPLATE_OPTIONS` array for Select UI
- [x] 3.2 Create `src/modules/medical-records/lib/evolution-schemas.ts` — Zod schemas: `tccContentSchema`, `psicanaliseContentSchema`, `sistemicaContentSchema`, `abaContentSchema`, `livreContentSchema`, `customContentSchema`, `createEvolutionInputSchema`, `updateEvolutionInputSchema` (with conditional reason required when isAddendum)
- [x] 3.3 Create `src/modules/medical-records/lib/immutability-helpers.ts` — `isWithinEditWindow(createdAt: Date, now?: Date): boolean` (true if <30 days), `shouldForceAddendum(createdAt: Date, now?: Date): boolean` (true if >=30 days)
- [x] 3.4 Create `src/modules/medical-records/lib/content-diff.ts` — `contentHasChanged(prev: unknown, next: unknown): boolean` using JSON.stringify comparison
- [x] 3.5 **Unit tests:** Create `src/__tests__/unit/modules/medical-records/lib/evolution-schemas.test.ts` — validate each template schema (TCC rejects missing humor_inicial, livre accepts freeform, custom rejects empty object, etc.)
- [x] 3.6 **Unit tests:** Create `src/__tests__/unit/modules/medical-records/lib/immutability-helpers.test.ts` — test isWithinEditWindow returns true at 29 days, false at 30 days; shouldForceAddendum inverse; edge case at exact 30-day boundary
- [x] 3.7 **Unit tests:** Create `src/__tests__/unit/modules/medical-records/lib/content-diff.test.ts` — test identical content returns false, different content returns true, handles null/undefined

## 4. Server Actions — Evolution CRUD

- [x] 4.1 Create `src/modules/medical-records/server/create-evolution.ts` — validates input with Zod, authenticates via getUser(), enforces user_id from session, creates evolution row + initial evolution_versions v1 row, writes audit_log 'evolution.create'
- [x] 4.2 Create `src/modules/medical-records/server/update-evolution.ts` — validates input, authenticates, checks ownership via RLS query, uses shouldForceAddendum() to decide path: (a) within window -> update content + create version; (b) past window -> create addendum version only, set finalized_at if null, require reason
- [x] 4.3 Create `src/modules/medical-records/server/get-evolutions-by-patient.ts` — validates patientId, authenticates, returns paginated list (cursor-based, ordered by created_at DESC), writes audit_log 'prontuario.read'
- [x] 4.4 Create `src/modules/medical-records/server/get-evolution-detail.ts` — validates evolutionId, authenticates, returns full evolution content, writes audit_log 'evolution.read'
- [x] 4.5 Create `src/modules/medical-records/server/list-evolution-versions.ts` — validates evolutionId, authenticates, returns all versions ordered by version_number DESC
- [x] 4.6 Create `src/modules/medical-records/server/log-prontuario-access.ts` — validates input via Zod, authenticates caller, writes to audit_log using service-role client (justified comment), extracts IP from headers
- [x] 4.7 **Integration tests:** Create `src/__tests__/integration/medical-records/evolution-crud.int.test.ts` — test createEvolution persists row + version, updateEvolution within 30d creates version (is_addendum=false), updateEvolution after 30d creates addendum (is_addendum=true, original content untouched), duplicate session_id rejected, RLS negative (psychologist B cannot read psychologist A's evolutions), audit_log row created on read
- [x] 4.8 **Integration tests:** Create `src/__tests__/integration/medical-records/audit-log.int.test.ts` — test logProntuarioAccess writes row, user can SELECT own audit rows, user cannot INSERT directly (RLS blocks), evolution_versions JOIN-scoped RLS enforced

## 5. Module Barrel + Inngest Cron

- [x] 5.1 Create `src/modules/medical-records/index.ts` barrel re-exporting: createEvolution, updateEvolution, getEvolutionsByPatient, getEvolutionDetail, listEvolutionVersions, logProntuarioAccess, template types, Zod schemas, immutability helpers
- [x] 5.2 Create `src/modules/medical-records/inngest/remind-missing-evolution.ts` — daily cron that queries sessions with status='done' AND created_at < now()-7days AND no linked evolution row, emits in-app notification per match
- [x] 5.3 **Unit test:** Create `src/__tests__/unit/modules/medical-records/inngest/remind-missing-evolution.test.ts` — test the query logic (mock DB): sessions >7d without evolution are flagged, sessions with evolution are skipped, sessions <7d are skipped

## 6. Frontend — Components

- [ ] 6.1 Create `src/modules/medical-records/components/auto-save-indicator.tsx` (Client Component) — renders status from useAutoSave: "Salvo as HH:MM" in text-tertiary caption, "Salvando..." with spinner, "Erro ao salvar" in danger-700 with AlertCircle. Container has `aria-live="polite"`. Respects prefers-reduced-motion
- [ ] 6.2 Create `src/modules/medical-records/components/template-selector.tsx` (Client Component) — shadcn Select with TEMPLATE_OPTIONS, emits onChange with selected TemplateType. Label "Abordagem" associated via for/id
- [ ] 6.3 Create `src/modules/medical-records/components/evolution-editor.tsx` (Client Component) — Tiptap editor with template-aware field layout (renders different fields per template type). Imports useAutoSave from patients module. Toolbar with Button ghost (bold, italic, lists, headings). Editor area: bg surface-sunken, border, focus brand-500 + shadow-focus, radius md. Max-width 720px. body-lg for content
- [ ] 6.4 Create `src/modules/medical-records/components/version-history-panel.tsx` (Client Component) — Sheet (right side) listing evolution_versions with version number, date, is_addendum Badge, modified_by. Click shows read-only content
- [ ] 6.5 Create `src/modules/medical-records/components/empty-tab-placeholder.tsx` — Salvia empty state pattern: Lucide icon in text-tertiary, h4 "Em breve", description in text-secondary, no CTA
- [ ] 6.6 Create `src/modules/medical-records/components/prontuario-tabs.tsx` (Client Component) — shadcn Tabs (underline style, active border-bottom 2px brand-500). 7 tabs: Evolucoes (functional), Hipoteses/Plano/Escalas/Documentos/Anexos/Notas (each renders EmptyTabPlaceholder with contextual description)

## 7. Frontend — Routes

- [ ] 7.1 Create `src/app/(app)/pacientes/[id]/prontuario/page.tsx` (RSC) — fetches patient (confirms ownership), calls logProntuarioAccess, renders ProntuarioTabs shell. Redirects to evolucoes sub-route or renders inline depending on tab routing strategy
- [ ] 7.2 Create `src/app/(app)/pacientes/[id]/prontuario/evolucoes/page.tsx` (RSC) — fetches evolutions list via getEvolutionsByPatient, renders chronological list with EvolutionCard items or empty state with CTA "Registrar evolucao"
- [ ] 7.3 Create `src/app/(app)/pacientes/[id]/prontuario/evolucoes/nova/page.tsx` (RSC) — renders TemplateSelector + EvolutionEditor for creation. Accepts optional ?sessionId query param
- [ ] 7.4 Create `src/app/(app)/pacientes/[id]/prontuario/evolucoes/[evolutionId]/page.tsx` (RSC) — fetches evolution detail, renders EvolutionEditor (pre-filled), shows "Salvar" or "Adicionar addendum" button based on immutability window, "Historico" button opens VersionHistoryPanel

## 8. End-to-End Tests

- [ ] 8.1 **E2E (Playwright, seeded):** Create `src/__tests__/e2e/seeded/prontuario/evolution-crud.spec.ts` — happy path: navigate to done session, click "Registrar evolucao", select TCC template, fill humor_inicial/final + conteudo, wait for "Salvo as" indicator, finalize, verify version history shows v1
- [ ] 8.2 **E2E (Playwright, seeded):** Create `src/__tests__/e2e/seeded/prontuario/evolution-addendum.spec.ts` — seed evolution with finalized_at in past (>30 days), navigate to it, edit, verify addendum modal appears requiring reason, submit, verify is_addendum badge in version history
- [ ] 8.3 **E2E (Playwright, seeded):** Create `src/__tests__/e2e/seeded/middleware/app-routes-auth-gate.spec.ts` — unauthenticated navigation to `/pacientes/[id]/prontuario` redirects to login (negative-auth test covering the defensive sweep)
