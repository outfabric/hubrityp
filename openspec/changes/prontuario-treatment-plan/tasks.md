## 1. Database Schema + RLS + Migration

- [x] 1.1 Add `treatmentPlans` and `treatmentPlanVersions` Drizzle table definitions to `src/shared/db/schema/medical-records/tables.ts` (columns, indexes, unique constraints per design.md DDL)
- [x] 1.2 Add RLS policies to `src/shared/db/schema/medical-records/policies.ts`: `treatmentPlansPolicies` (SELECT/INSERT/UPDATE, `user_id = auth.uid()`), `treatmentPlanVersionsPolicies` (SELECT/INSERT/UPDATE, JOIN-scoped via `plan_id IN (SELECT id FROM treatment_plans WHERE user_id = auth.uid())`). No DELETE policies.
- [x] 1.3 Update `src/shared/db/schema/medical-records/index.ts` barrel to re-export `treatmentPlans` and `treatmentPlanVersions`
- [x] 1.4 Run `npm run db:generate`, manually append RLS SQL + FK constraints (`user_id -> auth.users`, `patient_id -> patients(id) UNIQUE`, `plan_id -> treatment_plans(id) ON DELETE CASCADE`) to the generated migration file
- [x] 1.5 Run `npm run db:migrate` locally and verify tables exist
- [x] 1.6 **Integration test:** Create `src/__tests__/integration/medical-records/treatment-plan-schema.int.test.ts` — verify both tables exist, RLS is enabled on each, expected policies exist (SELECT/INSERT/UPDATE on treatment_plans, SELECT/INSERT/UPDATE on treatment_plan_versions), no DELETE policy on either table, UNIQUE constraint on treatment_plans.patient_id, UNIQUE on (plan_id, version_number)

## 2. Zod Schemas + Helpers (Lib)

- [x] 2.1 Create `src/modules/medical-records/lib/treatment-plan-schemas.ts` — export `goalSchema`, `phaseSchema`, `upsertTreatmentPlanInputSchema`, `getTreatmentPlanInputSchema`, `listTreatmentPlanVersionsInputSchema`, `versionContentSchema`. Types: `Goal`, `Phase`, `TreatmentPlanInput`, `VersionContent` via `z.infer`
- [x] 2.2 **Unit test:** Create `src/__tests__/unit/modules/medical-records/lib/treatment-plan-schemas.test.ts` — validate: goal with empty description rejected, goal with valid ISO date accepted, goal with invalid date format rejected, phase with empty title rejected, phase with all fields valid passes, upsert input with missing patientId rejected, full valid input passes

## 3. Server Actions

- [x] 3.1 Create `src/modules/medical-records/server/treatment-plans.ts` with three actions: `upsertTreatmentPlan(input)`, `getTreatmentPlan(input)`, `listTreatmentPlanVersions(input)`. All authenticate via `supabase.auth.getUser()`, validate with Zod, derive `user_id` from session. Upsert uses atomic transaction with `SELECT ... FOR UPDATE` per design.md. All write `audit_log` rows via `logProntuarioAccess` (service-role).
- [x] 3.2 Update `src/modules/medical-records/index.ts` barrel to re-export treatment plan actions and schemas
- [x] 3.3 **Integration test:** Create `src/__tests__/integration/medical-records/treatment-plan-crud.int.test.ts` — test: (a) upsertTreatmentPlan first time creates plan + version v1 with correct content snapshot; (b) second upsert increments current_version, prior content snapshotted into versions table; (c) getTreatmentPlan returns current plan or null; (d) listTreatmentPlanVersions returns chronological history; (e) audit_log entries created on read and update
- [x] 3.4 **Integration test:** Create `src/__tests__/integration/medical-records/treatment-plan-rls.int.test.ts` — test: (a) psychologist B cannot read psychologist A's plan (RLS negative); (b) psychologist B cannot upsert plan for psychologist A's patient; (c) no user can DELETE from either table; (d) version JOIN-scoped RLS blocks cross-user access to versions
- [x] 3.5 **Integration test:** Create `src/__tests__/integration/medical-records/treatment-plan-concurrency.int.test.ts` — test: concurrent upsert race (two writers same patient) — second update sees version conflict handled by FOR UPDATE lock, both versions preserved correctly

## 4. Frontend — Components

- [x] 4.1 Create `src/modules/medical-records/components/treatment-plan/goals-list.tsx` (Client Component) — renders array of goals with: description Input (multiline/textarea), target_date DatePicker (shadcn Calendar in Popover), up/down arrow Button ghost for reorder, Trash2 Button ghost for remove (with confirmation). "Adicionar objetivo" Button ghost at bottom with Plus icon. Keyboard accessible (Tab through items, arrow keys for reorder). Label/id pairs on every field.
- [x] 4.2 Create `src/modules/medical-records/components/treatment-plan/phases-list.tsx` (Client Component) — renders array of phases with: title Input, description Textarea, completed Checkbox, up/down arrow reorder, Trash2 remove with confirmation. "Adicionar fase" Button ghost at bottom. Keyboard accessible.
- [x] 4.3 Create `src/modules/medical-records/components/treatment-plan/resources-editor.tsx` (Client Component) — single Tiptap instance for `resources` field. Reuses editor config from anamnesis/evolutions (bold, italic, headings H3/H4, bullet list, numbered list). Label "Recursos terapeuticos" with Wrench icon. bg surface-sunken, border, focus brand-500, radius md, max-width 720px.
- [x] 4.4 Create `src/modules/medical-records/components/treatment-plan/success-criteria-editor.tsx` (Client Component) — single Tiptap instance for `success_criteria` field. Same config as resources. Label "Criterios de sucesso" with CheckCircle2 icon.
- [x] 4.5 Create `src/modules/medical-records/components/treatment-plan/version-history-sheet.tsx` (Client Component) — Sheet (right side) triggered by History icon button. Lists versions chronologically (newest first) with: version number Badge, formatted date (pt-BR, America/Sao_Paulo), Eye icon button to view snapshot. View mode renders read-only goals/phases/resources/criteria.
- [x] 4.6 Create `src/modules/medical-records/components/treatment-plan/treatment-plan-tab.tsx` (Client Component) — main container. Fetches current plan via getTreatmentPlan on mount. If null: renders empty state (Target icon, h4, description, CTA). If plan exists: renders header with h2 + History button + AutoSaveIndicator, then 4 Card sections (radius xl, space-12 gap between): Objetivos (GoalsList), Fases (PhasesList), Recursos (ResourcesEditor), Criterios (SuccessCriteriaEditor). Integrates useAutoSave with 10s debounce calling upsertTreatmentPlan. Uses contentHasChanged to prevent no-op saves.
- [x] 4.7 Create `src/modules/medical-records/components/treatment-plan/index.ts` barrel re-exporting TreatmentPlanTab

## 5. Frontend — Tab Integration

- [x] 5.1 Update `src/modules/medical-records/components/prontuario-tabs.tsx` — replace the `EmptyTabPlaceholder` for the "Plano Terapeutico" tab with `<TreatmentPlanTab patientId={patientId} />`. Import from `./treatment-plan/`. Pass patientId prop from page params.
- [x] 5.2 Verify dark mode renders correctly for all new components (tokens via CSS vars handle this automatically, but confirm no hardcoded colors)

## 6. Unit Tests — Content Diff + Version Logic

- [ ] 6.1 **Unit test:** Create `src/__tests__/unit/modules/medical-records/lib/treatment-plan-version-logic.test.ts` — test: version increment logic (next_version = current_version + 1), content snapshot shape matches schema, contentHasChanged returns false when goals/phases/resources/criteria identical (including order), returns true when any field differs

## 7. End-to-End Tests

- [ ] 7.1 **E2E (Playwright, seeded):** Create `src/__tests__/e2e/seeded/prontuario/treatment-plan.spec.ts` — happy path: open prontuario → Plano tab → see empty state → click CTA → add 2 goals (with descriptions), 1 phase (with title), fill recursos text and criterios text → wait for "Salvo as" indicator → reload page → assert content persists (goals visible, phase visible, rich text content present)
- [ ] 7.2 **E2E (Playwright, seeded):** Same spec file, second test: edit a goal description → wait for auto-save → open Historico de versoes sheet → assert v1 and v2 visible with timestamps → click Eye on v1 → assert prior content visible in read-only mode
- [ ] 7.3 **E2E (Playwright, seeded):** Same spec file, negative-auth test: anonymous GET to `/pacientes/[id]/prontuario` returns redirect to login (covered by middleware gating from foundation change, but re-assert for this tab)
