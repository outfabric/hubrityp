## ADDED Requirements

### Requirement: Psychologist can create a treatment plan for a patient

The system SHALL allow one treatment plan per patient (1:1 relationship enforced by UNIQUE constraint on `patient_id`). A treatment plan contains four sections: goals (JSONB array), phases (JSONB array), resources (rich text), and success_criteria (rich text). The plan is created via upsert — if no plan exists for the patient, a new plan row and version v1 are created atomically in a transaction.

#### Scenario: Create treatment plan for patient without one

- **WHEN** psychologist clicks "Criar plano terapeutico" CTA in the empty state of the Plano Terapeutico tab
- **THEN** system displays the treatment plan editor with empty sections ready for input

#### Scenario: First save creates plan and version v1

- **WHEN** psychologist fills in goals/phases/resources/criteria and the auto-save triggers (or explicit save)
- **THEN** system creates a `treatment_plans` row with `current_version=1` AND a `treatment_plan_versions` row with `version_number=1` containing a full content snapshot, in a single transaction

#### Scenario: Duplicate creation attempt for same patient

- **WHEN** two concurrent requests attempt to create a plan for the same patient
- **THEN** the UNIQUE constraint on `patient_id` prevents the second INSERT; the second request falls through to the update path (upsert semantics)

### Requirement: Psychologist can edit a treatment plan (living document)

The system SHALL allow unrestricted editing of the treatment plan at any time (RF-05.13 — no 30-day immutability rule; plans are explicitly living documents). Every save increments `current_version` and creates a new `treatment_plan_versions` row with a full content snapshot of the prior state.

#### Scenario: Edit existing plan creates new version

- **WHEN** psychologist modifies a goal description and auto-save triggers
- **THEN** system snapshots the prior state into `treatment_plan_versions` (version_number = previous current_version), increments `current_version` on the plan row, and updates the plan content

#### Scenario: No save when content is unchanged

- **WHEN** psychologist opens the plan editor and does not change anything for 10 seconds
- **THEN** no save request is made (content diff comparison prevents unnecessary writes)

#### Scenario: Auto-save debounce at 10 seconds

- **WHEN** psychologist is actively typing
- **THEN** auto-save timer resets on each change and only fires 10 seconds after the last modification

### Requirement: Treatment plan goals follow a structured JSONB schema

The system SHALL validate goals as an array of objects with shape: `{ id: string (uuid), description: string, target_date: string | null (ISO date YYYY-MM-DD), order: number }`. Goals are reorderable. New goals are appended with the next available order value.

#### Scenario: Add a goal

- **WHEN** psychologist clicks "Adicionar objetivo"
- **THEN** a new goal item appears at the bottom of the list with empty description, null target_date, and order = max(existing orders) + 1

#### Scenario: Remove a goal

- **WHEN** psychologist clicks the remove button on a goal
- **THEN** system shows a confirmation (inline or popover), and upon confirmation removes the goal from the JSONB array (no separate row deletion — it is an array element)

#### Scenario: Set target date on a goal

- **WHEN** psychologist clicks the date picker on a goal and selects a date
- **THEN** the goal's `target_date` is set to the selected ISO date string

#### Scenario: Reorder goals

- **WHEN** psychologist uses the up/down arrow buttons to change goal order
- **THEN** the `order` values are recalculated and the list re-renders in new order

#### Scenario: Invalid goal rejected by Zod

- **WHEN** a goal has an empty description (empty string after trim)
- **THEN** validation fails and the save is blocked with a field-level error indicator

### Requirement: Treatment plan phases follow a structured JSONB schema

The system SHALL validate phases as an array of objects with shape: `{ id: string (uuid), title: string, description: string, order: number, completed: boolean }`. Phases are reorderable and can be marked as completed.

#### Scenario: Add a phase

- **WHEN** psychologist clicks "Adicionar fase"
- **THEN** a new phase item appears at the bottom with empty title/description, completed=false, and order = max(existing orders) + 1

#### Scenario: Mark phase as completed

- **WHEN** psychologist clicks the completed checkbox on a phase
- **THEN** the phase's `completed` field is set to true and the checkbox shows checked state

#### Scenario: Remove a phase

- **WHEN** psychologist clicks the remove button on a phase and confirms
- **THEN** the phase is removed from the JSONB array

### Requirement: Treatment plan resources and success criteria use rich text editor

The system SHALL render the `resources` and `success_criteria` fields as Tiptap editor instances supporting: bold, italic, headings (H3, H4), bullet lists, numbered lists. The editors reuse the same Tiptap configuration as the anamnesis/evolutions editors.

#### Scenario: Format text as bold in resources

- **WHEN** psychologist selects text in the resources editor and presses Ctrl+B
- **THEN** the selected text is rendered bold

#### Scenario: Create a numbered list in success criteria

- **WHEN** psychologist clicks the numbered list toolbar button in success criteria
- **THEN** a new numbered list is started at the cursor position

### Requirement: Treatment plan version history is viewable

The system SHALL provide a version history interface showing all prior versions of the plan in chronological order (newest first). Each version entry displays: version number, timestamp (formatted pt-BR), and a button to view the full snapshot.

#### Scenario: Open version history

- **WHEN** psychologist clicks the "Historico de versoes" button (History icon)
- **THEN** a Sheet opens on the right side showing a chronological list of all versions

#### Scenario: View a specific version

- **WHEN** psychologist clicks "Visualizar" on a version entry
- **THEN** system displays the full content snapshot of that version in read-only mode (goals, phases, resources, criteria)

#### Scenario: First version exists after creation

- **WHEN** psychologist creates a plan and then opens version history
- **THEN** version v1 is visible with the creation timestamp

### Requirement: Treatment plan auto-saves with visual indicator

The system SHALL auto-save the treatment plan every 10 seconds after the last change, using the same debounce pattern as anamnesis. A visual indicator MUST show: "Salvo as HH:MM" (saved), "Salvando..." (in progress), or "Erro ao salvar — tentar novamente" (error). The indicator uses `aria-live="polite"` for screen reader accessibility.

#### Scenario: Auto-save success shows timestamp

- **WHEN** auto-save completes successfully
- **THEN** indicator displays "Salvo as HH:MM" in text-tertiary caption style

#### Scenario: Auto-save error shows retry option

- **WHEN** auto-save fails (network error, server error)
- **THEN** indicator displays "Erro ao salvar — tentar novamente" in danger-700 with AlertCircle icon

#### Scenario: Manual retry after error

- **WHEN** psychologist clicks "tentar novamente" link
- **THEN** system immediately attempts to save current content

### Requirement: Treatment plan displays empty state when no plan exists

The system SHALL display an empty state when the patient has no treatment plan. The empty state follows the Salvia pattern: Target icon in text-tertiary, h4 "Plano terapeutico ainda nao criado", description "Comece definindo objetivos para guiar o trabalho terapeutico.", primary CTA "Criar plano terapeutico".

#### Scenario: Empty state displayed for patient without plan

- **WHEN** psychologist opens the Plano Terapeutico tab for a patient that has no plan
- **THEN** system displays the empty state with Target icon, heading, description, and CTA button

#### Scenario: CTA transitions to editor

- **WHEN** psychologist clicks "Criar plano terapeutico" CTA
- **THEN** system renders the plan editor with empty sections (no page navigation — inline transition)

### Requirement: RLS enforces owner-scoped access on treatment plan tables

The system SHALL enable RLS on `treatment_plans` and `treatment_plan_versions`. Policies enforce that only the owning psychologist (`user_id = auth.uid()`) can SELECT/INSERT/UPDATE plans. No DELETE policy exists (Lei 13.787/2018 retention mandate). Versions are JOIN-scoped: access requires `plan_id IN (SELECT id FROM treatment_plans WHERE user_id = auth.uid())`.

#### Scenario: Psychologist can only read own patients' plans

- **WHEN** psychologist A queries the treatment_plans table
- **THEN** only plans where `user_id = auth.uid()` are returned

#### Scenario: Cross-psychologist access blocked

- **WHEN** psychologist B tries to read/update a plan belonging to psychologist A
- **THEN** query returns empty result (RLS blocks access)

#### Scenario: No deletion possible

- **WHEN** any user attempts to DELETE from treatment_plans or treatment_plan_versions
- **THEN** the operation is denied (no DELETE policy exists)

### Requirement: Audit log records treatment plan access

The system SHALL write an `audit_log` entry on every treatment plan read (`action='treatment-plan.read'`) and every upsert (`action='treatment-plan.update'`). Audit writes use service-role (same pattern as foundation change) to prevent user manipulation of the audit trail. The audit entry includes `resource_type='treatment_plan'`, `resource_id=plan.id`, and metadata with `patient_id`.

#### Scenario: Reading plan writes audit entry

- **WHEN** psychologist opens the Plano Terapeutico tab (triggering getTreatmentPlan)
- **THEN** an audit_log row is created with action='treatment-plan.read'

#### Scenario: Saving plan writes audit entry

- **WHEN** auto-save or explicit save triggers upsertTreatmentPlan
- **THEN** an audit_log row is created with action='treatment-plan.update'

#### Scenario: Audit entries are immutable

- **WHEN** any user attempts to UPDATE or DELETE audit_log rows
- **THEN** the operation is denied (no UPDATE/DELETE policies on audit_log)

### Requirement: Server Actions validate input and authorize from session

Every Server Action (upsertTreatmentPlan, getTreatmentPlan, listTreatmentPlanVersions) SHALL validate input with Zod at the boundary, authenticate via `supabase.auth.getUser()`, and derive `user_id` from the session (never from client input). The `patient_id` parameter is verified via a query that includes `WHERE user_id = session.uid` (ownership check).

#### Scenario: Invalid input rejected

- **WHEN** client sends malformed goals (e.g., goal without description)
- **THEN** server action returns `{ ok: false, code: 'VALIDATION_ERROR' }` without touching the database

#### Scenario: Unauthenticated request rejected

- **WHEN** request has no valid session (expired or missing token)
- **THEN** server action returns `{ ok: false, code: 'UNAUTHORIZED' }`

#### Scenario: Patient not owned by session user rejected

- **WHEN** psychologist A tries to upsert a plan for a patient owned by psychologist B
- **THEN** server action returns `{ ok: false, code: 'NOT_FOUND' }` (does not leak existence)
