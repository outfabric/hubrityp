## Context

This is change #3 of the 7-change PRD 05 decomposition. The foundation change (`prontuario-foundation-and-evolutions`) has already shipped:
- `audit_log` table (generic, reusable)
- `src/modules/medical-records/` module structure with barrel, lib, server, components
- Prontuario shell page with Tabs at `/pacientes/[id]/prontuario` — the "Plano" tab currently renders `EmptyTabPlaceholder`
- `AutoSaveIndicator` component
- Tiptap editor setup (extensions, toolbar) reusable across tabs
- `useAutoSave` hook (imported from patients module)
- Middleware defensive sweep (all `/pacientes/*` routes gated)

The treatment plan is defined by PRD 05 §5.4 (RF-05.12, RF-05.13) as a "living document" — unlike evolutions which have a 30-day immutability window, plans can be freely edited at any time. Every save creates a new version snapshot for audit purposes, but no restriction exists on when edits happen.

**Constraints:**
- Lei 13.787/2018: no deletion allowed (20-year retention)
- LGPD art. 11: sensitive health data
- RN-05.04: strict `user_id` isolation
- 1:1 relationship: one plan per patient (UNIQUE on `patient_id`)
- Foundation dependency: audit_log table, AutoSaveIndicator, Tiptap config already exist

## Goals / Non-Goals

**Goals:**
- Drizzle schema + migration for `treatment_plans` and `treatment_plan_versions` with RLS
- Server Actions for upsert (atomic transaction), get, list-versions — all with Zod, auth, audit
- Treatment plan tab UI replacing the placeholder in the prontuario shell
- Goals/phases as structured JSONB with Zod validation
- Resources/success_criteria as Tiptap rich-text fields
- Version history sheet showing full snapshots
- Auto-save with 10s debounce and indicator
- Audit log writes on every read/write

**Non-Goals:**
- AI-assisted goal generation (PRD 10 — future)
- Goal completion tracking with notifications
- Multi-patient plan templates
- Drag-to-reorder via @dnd-kit (using simple up/down arrow buttons — see Decision 5)
- PDF export of treatment plan (future export change)
- Custom template system for plans (plans have a fixed structure per RF-05.12)

## Decisions

### 1. JSONB snapshot for versioning (not delta/diff)

Each `treatment_plan_versions` row stores a full content snapshot `{ goals, phases, resources, success_criteria }` of the plan at that point in time.

**Alternative considered:** Delta versioning (store only the diff from previous version).
**Rejected because:** Deltas require reconstruction (apply N diffs to get version K), are complex to implement correctly for JSONB arrays (goal reordering, removals), and storage is cheap. A full snapshot means any version can be displayed instantly without computation. At typical usage (1 plan per patient, ~50 versions over years), storage per plan is negligible (<500KB total).

### 2. Upsert semantics (not separate create/update actions)

A single `upsertTreatmentPlan` Server Action handles both creation and updates. On first call it INSERTs plan + version v1. On subsequent calls it snapshots prior state into versions, increments `current_version`, and UPDATEs the plan row.

**Alternative considered:** Separate `createTreatmentPlan` and `updateTreatmentPlan` actions.
**Rejected because:** The 1:1 constraint means the client would need to know whether a plan exists before calling the correct action — introducing a race condition and extra round-trip. Upsert encapsulates this logic server-side in a single atomic transaction.

**Transaction strategy:**
```sql
BEGIN;
  -- Check if plan exists for this patient + user
  SELECT id, current_version, goals, phases, resources, success_criteria
    FROM treatment_plans
    WHERE patient_id = $1 AND user_id = $2
    FOR UPDATE;  -- row-level lock prevents concurrent version conflicts

  IF found THEN
    -- Snapshot prior state into versions
    INSERT INTO treatment_plan_versions (plan_id, version_number, content, modified_by)
    VALUES ($plan_id, $current_version, $prior_snapshot, $user_id);
    -- Update plan
    UPDATE treatment_plans SET goals=$3, phases=$4, resources=$5, success_criteria=$6,
      current_version = current_version + 1, updated_at = now()
    WHERE id = $plan_id;
  ELSE
    -- Create new plan
    INSERT INTO treatment_plans (user_id, patient_id, goals, phases, resources, success_criteria, current_version)
    VALUES ($user_id, $1, $3, $4, $5, $6, 1);
    -- Create version v1
    INSERT INTO treatment_plan_versions (plan_id, version_number, content, modified_by)
    VALUES ($new_plan_id, 1, $content_snapshot, $user_id);
  END IF;
COMMIT;
```

The `FOR UPDATE` lock on the plan row ensures that concurrent auto-saves from different tabs/devices serialize correctly — the second writer sees the incremented version and does not overwrite.

### 3. user_id on treatment_plans (direct scope, not JOIN-through-patients)

The `treatment_plans` table has its own `user_id` column even though `patient_id` already implies ownership (patients have `user_id`). This simplifies RLS policies to a direct `user_id = auth.uid()` check without requiring a JOIN to patients.

**Alternative considered:** RLS via `patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid())` (same pattern as anamnesis).
**Rejected because:** The foundation change's `evolution_versions` already uses JOIN-scoped RLS and noted the performance concern of subqueries on every row access. For `treatment_plans` — a table with direct user access on every tab open — a direct `user_id` column is simpler and faster. The minor denormalization is acceptable given the 1:1 constraint (if `patient_id` exists, `user_id` is always the same as the patient's owner). Consistency is enforced at the application layer in the upsert action.

### 4. treatment_plan_versions JOIN-scoped RLS (consistent with evolution_versions)

The `treatment_plan_versions` table does NOT have a `user_id` column. RLS is enforced via: `plan_id IN (SELECT id FROM treatment_plans WHERE user_id = auth.uid())`. This is consistent with the `evolution_versions` pattern from the foundation change and avoids denormalization at the version level.

**Alternative considered:** Adding `user_id` to versions.
**Rejected because:** Same reasoning as the foundation change — denormalization creates consistency risk. The subquery is efficient because `treatment_plans` is indexed on `user_id` and the result set per user is small.

### 5. Up/down arrow buttons for goal/phase reorder (not drag-and-drop)

Goal and phase reordering uses simple up/down arrow buttons rather than drag-and-drop.

**Alternative considered:** @dnd-kit for drag-to-reorder.
**Rejected because:** (1) @dnd-kit is not currently installed and adding a dependency for a single use case violates YAGNI; (2) up/down buttons are fully keyboard-accessible out of the box without additional ARIA work; (3) the typical plan has 3-8 goals — drag provides minimal UX benefit at this scale; (4) simpler implementation = fewer bugs in a regulated module. If user feedback demands drag, it can be added later without changing the data model (only the `order` field values change).

### 6. No soft-delete on goals/phases (array element removal)

Goals and phases are JSONB array elements — removing one simply filters it out of the array on the next save. The prior state (including the removed goal) is preserved in the version snapshot.

**Alternative considered:** Soft-delete with a `deleted: boolean` field on each goal/phase object.
**Rejected because:** Soft-delete in a JSONB array complicates every query/render (must filter `deleted=false` everywhere), bloats the array over time, and is unnecessary because the version history already preserves every prior state immutably. The version snapshot IS the audit trail for removed goals.

### 7. Inline tab content (not sub-route)

The treatment plan tab renders its content inline within the prontuario shell page (same RSC render), not as a separate sub-route like `/prontuario/plano`.

**Alternative considered:** Dedicated sub-route `/pacientes/[id]/prontuario/plano`.
**Rejected because:** The prontuario shell already uses client-side Tabs component. Routing to a sub-page would require a full page navigation on tab switch, losing the snappy feel. The treatment plan data is lightweight (single row) and can be fetched in parallel with evolution data in the parent RSC via `Promise.all`. This is consistent with how the "Plano" tab placeholder already works.

## Drizzle Table DDL

```typescript
// Added to src/shared/db/schema/medical-records/tables.ts

export const treatmentPlans = pgTable('treatment_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),          // FK auth.users
  patientId: uuid('patient_id').notNull(),    // FK patients(id), UNIQUE
  goals: jsonb('goals').notNull().default(sql`'[]'::jsonb`),
  phases: jsonb('phases').notNull().default(sql`'[]'::jsonb`),
  resources: text('resources'),               // Tiptap HTML string
  successCriteria: text('success_criteria'),  // Tiptap HTML string
  currentVersion: integer('current_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  unique('treatment_plans_patient_id_unique').on(table.patientId),
  index('idx_treatment_plans_user_id').on(table.userId),
]);

export const treatmentPlanVersions = pgTable('treatment_plan_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull(),          // FK treatment_plans(id) ON DELETE CASCADE
  versionNumber: integer('version_number').notNull(),
  content: jsonb('content').notNull(),        // Full snapshot {goals, phases, resources, success_criteria}
  modifiedBy: uuid('modified_by').notNull(),  // FK auth.users
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  unique('treatment_plan_versions_plan_version_unique').on(table.planId, table.versionNumber),
  index('idx_treatment_plan_versions_plan_desc').on(table.planId, table.versionNumber),
]);
```

## RLS Policies (SQL appended to migration)

```sql
-- treatment_plans: owner-scoped, no DELETE
ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner can select treatment_plans" ON treatment_plans
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "owner can insert treatment_plans" ON treatment_plans
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner can update treatment_plans" ON treatment_plans
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- treatment_plan_versions: JOIN-scoped via treatment_plans.user_id, no DELETE
ALTER TABLE treatment_plan_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner can select treatment_plan_versions" ON treatment_plan_versions
  FOR SELECT TO authenticated
  USING (plan_id IN (SELECT id FROM treatment_plans WHERE user_id = auth.uid()));
CREATE POLICY "owner can insert treatment_plan_versions" ON treatment_plan_versions
  FOR INSERT TO authenticated
  WITH CHECK (plan_id IN (SELECT id FROM treatment_plans WHERE user_id = auth.uid()));
CREATE POLICY "owner can update treatment_plan_versions" ON treatment_plan_versions
  FOR UPDATE TO authenticated
  USING (plan_id IN (SELECT id FROM treatment_plans WHERE user_id = auth.uid()))
  WITH CHECK (plan_id IN (SELECT id FROM treatment_plans WHERE user_id = auth.uid()));
```

## JSONB Schemas (Zod)

```typescript
// src/modules/medical-records/lib/treatment-plan-schemas.ts

const goalSchema = z.object({
  id: z.string().uuid(),
  description: z.string().min(1, 'Descricao obrigatoria'),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  order: z.number().int().nonnegative(),
});

const phaseSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, 'Titulo obrigatorio'),
  description: z.string(),
  order: z.number().int().nonnegative(),
  completed: z.boolean(),
});

const upsertTreatmentPlanInputSchema = z.object({
  patientId: z.string().uuid(),
  goals: z.array(goalSchema),
  phases: z.array(phaseSchema),
  resources: z.string().nullable(),         // Tiptap HTML or null
  successCriteria: z.string().nullable(),   // Tiptap HTML or null
});

// Version content snapshot shape
const versionContentSchema = z.object({
  goals: z.array(goalSchema),
  phases: z.array(phaseSchema),
  resources: z.string().nullable(),
  successCriteria: z.string().nullable(),
});
```

## Server Action Signatures

```typescript
// upsertTreatmentPlan
input: { patientId: string; goals: Goal[]; phases: Phase[]; resources: string | null; successCriteria: string | null }
output: { ok: true; planId: string; version: number } | { ok: false; code: 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'NOT_FOUND' }
// NOT_FOUND = patient doesn't exist or not owned by session user

// getTreatmentPlan
input: { patientId: string }
output: { ok: true; plan: TreatmentPlan | null } | { ok: false; code: 'UNAUTHORIZED' | 'NOT_FOUND' }
// Side-effect: writes audit_log row (action='treatment-plan.read') only if plan exists

// listTreatmentPlanVersions
input: { planId: string }
output: { ok: true; versions: TreatmentPlanVersion[] } | { ok: false; code: 'UNAUTHORIZED' | 'NOT_FOUND' }
```

## Component Tree (Treatment Plan Tab)

```
ProntuarioTabs (existing)
  └─ Tab "Plano Terapeutico" (was EmptyTabPlaceholder, now functional)
       └─ TreatmentPlanTab (Client Component — container)
            ├─ [if no plan] EmptyState (Target icon, h4, desc, CTA)
            ├─ [if plan exists]
            │    ├─ Header: h2 "Plano terapeutico" + Button ghost (History icon) → opens VersionHistorySheet
            │    ├─ AutoSaveIndicator (reuse from foundation)
            │    ├─ Card (radius xl) "Objetivos"
            │    │    └─ GoalsList
            │    │         ├─ GoalItem[] (Input multiline + DatePicker + up/down + remove)
            │    │         └─ Button ghost "Adicionar objetivo" (Plus icon)
            │    ├─ Card (radius xl) "Fases"
            │    │    └─ PhasesList
            │    │         ├─ PhaseItem[] (Input title + Textarea desc + Checkbox completed + up/down + remove)
            │    │         └─ Button ghost "Adicionar fase" (Plus icon)
            │    ├─ Card (radius xl) "Recursos terapeuticos"
            │    │    └─ ResourcesEditor (Tiptap instance)
            │    └─ Card (radius xl) "Criterios de sucesso"
            │         └─ SuccessCriteriaEditor (Tiptap instance)
            └─ VersionHistorySheet (Sheet right)
                 └─ VersionItem[] (version number, date, Eye icon to view)
                      └─ [on view] ReadOnlyPlanSnapshot (goals, phases, resources, criteria — non-editable)
```

## Reuse from Foundation Change

| Artifact | Source | Usage |
|---|---|---|
| `audit_log` table | `src/shared/db/schema/medical-records/tables.ts` | Write entries on read/upsert |
| `logProntuarioAccess` | `src/modules/medical-records/server/log-prontuario-access.ts` | Called from getTreatmentPlan and upsertTreatmentPlan |
| `AutoSaveIndicator` | `src/modules/medical-records/components/auto-save-indicator.tsx` | Rendered in TreatmentPlanTab |
| `useAutoSave` hook | `src/modules/patients/lib/use-auto-save.ts` | Drives auto-save logic in TreatmentPlanTab |
| `contentHasChanged` | `src/modules/medical-records/lib/content-diff.ts` | Prevents unnecessary saves |
| Tiptap editor config | From anamnesis/evolutions setup | ResourcesEditor + SuccessCriteriaEditor |
| Prontuario shell Tabs | `src/modules/medical-records/components/prontuario-tabs.tsx` | Tab "Plano" becomes functional |

## Risks / Trade-offs

- **[Concurrent auto-save from multiple tabs]** Two browser tabs open on the same plan could race. Mitigation: `SELECT ... FOR UPDATE` in the upsert transaction serializes concurrent writes. The second writer gets the correct `current_version` and does not overwrite. Worst case: last-write-wins semantics on the plan content, but both versions are preserved in history.
- **[JSONB goals array growing unbounded]** A psychologist could add hundreds of goals over years. Mitigation: unlikely in practice (typical plans have 3-10 goals); version snapshots keep history, so old completed goals can be removed from the active array. No hard limit enforced initially.
- **[Rich text stored as HTML string]** Tiptap outputs HTML. If Tiptap extensions change, old HTML might render differently. Mitigation: same risk accepted for anamnesis/evolutions; Tiptap's HTML output is stable across minor versions. Version snapshots preserve the exact HTML.
- **[user_id denormalization on treatment_plans vs patient ownership]** If a patient is somehow transferred to another psychologist (future feature), the `user_id` on the plan would be stale. Mitigation: patient transfer is out of scope and would require explicit migration logic for all related tables. The foundation change has the same pattern on evolutions.

## Migration Plan

1. Add Drizzle table definitions to `src/shared/db/schema/medical-records/tables.ts`
2. Run `npm run db:generate` to create migration file
3. Manually append RLS SQL + FK constraints (`user_id -> auth.users`, `patient_id -> patients(id) UNIQUE`, `plan_id -> treatment_plans(id) ON DELETE CASCADE`) to the migration
4. Run `npm run db:migrate` locally and verify
5. Deploy: migration runs automatically via CI
6. Rollback: additive change (new tables only); rollback = `DROP TABLE treatment_plan_versions; DROP TABLE treatment_plans;`

## Open Questions

(none — all decisions locked per user direction)
