## ADDED Requirements

### Requirement: Personal notes provide a manual save control coexisting with auto-save

The personal notes editor SHALL render a manual **Salvar** button that coexists with the existing 10-second auto-save (it does NOT replace it). The button MUST be disabled when the current note content is unchanged since the last successful save and enabled when it differs. Clicking the button MUST flush the current content immediately via the existing `upsertPersonalNotes` action and reset the auto-save debounce timer. The existing auto-save indicator MUST continue to reflect status after both automatic and manual saves. The manual save control MUST only be available when the notes are unlocked; when the notes are password-locked and not yet unlocked in the session, no editor and no save button are shown.

#### Scenario: Save button is disabled when notes are unchanged

- **WHEN** the unlocked personal notes tab is opened and the content matches the last saved snapshot
- **THEN** the "Salvar" button is disabled

#### Scenario: Editing enables the save button

- **WHEN** the psychologist edits the personal notes so the content differs from the last saved snapshot
- **THEN** the "Salvar" button becomes enabled

#### Scenario: Manual save flushes immediately before the 10-second window

- **WHEN** the psychologist edits the notes and clicks "Salvar" before the 10-second auto-save fires
- **THEN** `upsertPersonalNotes` persists the content immediately, the indicator shows "Salvo às HH:MM", and the pending auto-save timer is reset

#### Scenario: No save button is shown while notes are locked

- **WHEN** the personal notes have a password set and the session has not unlocked them
- **THEN** neither the editor nor the "Salvar" button is shown

#### Scenario: Auto-save continues to function alongside the button

- **WHEN** the psychologist edits unlocked notes and does not click "Salvar"
- **THEN** auto-save still fires 10 seconds after the last change, persisting the content
