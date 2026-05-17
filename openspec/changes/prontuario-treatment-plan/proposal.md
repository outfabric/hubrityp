## Why

PRD 05 §5.4 defines the treatment plan (plano terapeutico) as a "living document" with goals, phases, resources, and success criteria (RF-05.12, RF-05.13). The prontuario shell page shipped in the foundation change currently shows an "Em breve" placeholder for the "Plano" tab. This change delivers the full treatment plan CRUD with versioning, replacing that placeholder with a functional editor that auto-saves and preserves complete history of every modification — fulfilling the regulatory requirement that clinical records maintain an immutable audit trail (Lei 13.787/2018).

## What Changes

- New tables `treatment_plans` and `treatment_plan_versions` added to the `medical-records` schema domain
- RLS enabled on both tables with per-operation policies (SELECT/INSERT/UPDATE, no DELETE) scoped via `user_id = auth.uid()` (versions JOIN-scoped through plan)
- New Server Actions: `upsertTreatmentPlan`, `getTreatmentPlan`, `listTreatmentPlanVersions` — all with Zod validation, session auth, and audit_log writes
- New UI components under `src/modules/medical-records/components/treatment-plan/`: `TreatmentPlanTab`, `GoalsList`, `PhasesList`, `ResourcesEditor`, `SuccessCriteriaEditor`, `VersionHistorySheet`
- The "Plano Terapeutico" tab in the prontuario shell becomes functional (replaces `EmptyTabPlaceholder`)
- Auto-save with 10-second debounce reusing the foundation change's pattern and `AutoSaveIndicator` component
- Tiptap editor reuse for `resources` and `success_criteria` rich-text fields

## Capabilities

### New Capabilities
- `treatment-plan`: Treatment plan CRUD (1:1 with patient), JSONB goals/phases, rich-text resources/criteria, versioning (every save creates a new version snapshot, current_version always points at latest), audit logging on read/write, empty state with CTA, version history sheet

### Modified Capabilities
(none — no existing spec requirements change; the prontuario shell tab system is unchanged, only the placeholder content is replaced)

## Impact

- **Database:** 2 new tables + migration with RLS + indexes in `src/shared/db/schema/medical-records/`
- **Module:** New files in `src/modules/medical-records/` — `lib/treatment-plan-schemas.ts`, `server/treatment-plans.ts`, `components/treatment-plan/` (6 components)
- **Routes:** No new routes — the treatment plan tab renders inline within the existing `/pacientes/[id]/prontuario` page
- **Dependencies:** No new npm packages (Tiptap, shadcn Calendar/Sheet, AutoSaveIndicator already available from foundation change)
- **Regulatory:** LGPD art. 11 (sensitive health data), Lei 13.787/2018 (retention — no DELETE), RN-05.04 (strict user_id isolation), RF-05.12/RF-05.13 (living document with version history)
- **Security:** RLS on both tables, audit_log on every read/write, no DELETE policies, ownership enforced server-side via session
- **Dependency on:** `prontuario-foundation-and-evolutions` (audit_log table, prontuario shell tabs, AutoSaveIndicator component, Tiptap setup)
