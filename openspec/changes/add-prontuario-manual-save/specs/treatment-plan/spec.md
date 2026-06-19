## ADDED Requirements

### Requirement: Treatment plan provides a manual save control coexisting with auto-save

The treatment plan editor SHALL render a manual **Salvar** button that coexists with the existing 10-second auto-save (it does NOT replace it). The button MUST be disabled when the current plan content (goals, phases, resources, success criteria) is unchanged since the last successful save and enabled when it differs. Clicking the button MUST flush the current content immediately via the existing `upsertTreatmentPlan` action and reset the auto-save debounce timer. The existing auto-save indicator MUST continue to reflect status after both automatic and manual saves. When manual save is blocked by the plan's existing validation (a goal with an empty description or a phase with an empty title), the system MUST surface a user-facing toast describing the problem instead of only setting a silent error status.

#### Scenario: Save button is disabled when the plan is unchanged

- **WHEN** the treatment plan tab is opened and the content matches the last saved snapshot
- **THEN** the "Salvar" button is disabled

#### Scenario: Editing a goal enables the save button

- **WHEN** the psychologist adds or modifies a goal, phase, resource, or success criterion so the content differs from the last saved snapshot
- **THEN** the "Salvar" button becomes enabled

#### Scenario: Manual save flushes immediately and snapshots a version

- **WHEN** the psychologist edits the plan and clicks "Salvar" before the 10-second auto-save fires
- **THEN** `upsertTreatmentPlan` persists the content immediately, a new version is snapshotted as with auto-save, the indicator shows "Salvo às HH:MM", and the pending auto-save timer is reset

#### Scenario: Manual save with an invalid goal shows a toast

- **WHEN** the psychologist clicks "Salvar" while a goal has an empty description
- **THEN** the system does not persist, shows a toast explaining the goal description is required, and the content remains marked as unsaved

#### Scenario: Auto-save continues to function alongside the button

- **WHEN** the psychologist edits the plan with valid content and does not click "Salvar"
- **THEN** auto-save still fires 10 seconds after the last change, persisting the content
