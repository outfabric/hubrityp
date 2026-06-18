## ADDED Requirements

### Requirement: Evolution editor provides a manual save control coexisting with auto-save

The evolution editor SHALL render a manual **Salvar** button that coexists with the existing 10-second auto-save (it does NOT replace it). The button MUST be disabled when the current content is unchanged since the last successful save (clean state) and enabled when the content differs (dirty state). Clicking the button MUST flush the current content to the server immediately via the existing evolution save action and reset the auto-save debounce timer. The existing auto-save indicator ("Salvo às HH:MM" / "Salvando…" / "Erro ao salvar") MUST continue to reflect status after both automatic and manual saves. The manual save MUST reuse the `useAutoSave` hook's flush capability so the no-op and in-flight guards still apply.

#### Scenario: Save button is disabled when there are no unsaved changes

- **WHEN** the evolution editor is opened and the content matches the last saved snapshot
- **THEN** the "Salvar" button is disabled

#### Scenario: Editing enables the save button

- **WHEN** the psychologist modifies the evolution content so it differs from the last saved snapshot
- **THEN** the "Salvar" button becomes enabled

#### Scenario: Manual save flushes immediately before the 10-second window

- **WHEN** the psychologist edits content and clicks "Salvar" before the 10-second auto-save fires
- **THEN** the content is persisted immediately, the indicator shows "Salvo às HH:MM", and the pending auto-save timer is reset so no duplicate save fires

#### Scenario: Save button returns to disabled after a successful save

- **WHEN** a save (manual or automatic) completes successfully and the content is unchanged afterward
- **THEN** the "Salvar" button is disabled again

#### Scenario: Auto-save continues to function alongside the button

- **WHEN** the psychologist edits content and does not click "Salvar"
- **THEN** auto-save still fires 10 seconds after the last change, persisting the content
