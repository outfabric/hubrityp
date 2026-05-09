## Requirements

### Requirement: Psychologist can create and edit an anamnesis for a patient

The system SHALL allow one anamnesis per patient (1:1 relationship). The anamnesis has standard sections: chief_complaint, history_present_illness, family_history, educational_professional, physical_health, prior_therapy, initial_hypothesis, treatment_plan. Each section is a rich-text field (Tiptap editor). A JSONB column `custom_sections` allows psychologist-defined additional sections.

#### Scenario: Create anamnesis for patient without one

- **WHEN** psychologist opens the "Anamnese" tab for a patient that has no anamnesis
- **THEN** system displays an empty form with all standard sections ready for input

#### Scenario: Edit existing anamnesis

- **WHEN** psychologist opens the "Anamnese" tab for a patient with an existing anamnesis
- **THEN** system loads the existing content into all section fields, ready for editing

#### Scenario: Save anamnesis explicitly

- **WHEN** psychologist clicks "Salvar" after editing sections
- **THEN** system persists all section content, sets updated_at=now, and shows success toast

### Requirement: Anamnesis auto-saves every 10 seconds

The system SHALL auto-save anamnesis content every 10 seconds while the psychologist is editing. Auto-save MUST only trigger if content has changed since the last save (diff comparison). A visual indicator MUST show save status (saving, saved, error).

#### Scenario: Auto-save triggers after content change

- **WHEN** psychologist types in a section and waits 10 seconds without further edits
- **THEN** system automatically saves the current content and displays "Salvo" indicator

#### Scenario: No auto-save when content unchanged

- **WHEN** psychologist opens anamnesis and does not change anything for 10 seconds
- **THEN** no save request is made

#### Scenario: Auto-save error shows indicator

- **WHEN** auto-save fails (network error, server error)
- **THEN** system displays "Erro ao salvar" indicator with retry option

#### Scenario: Rapid typing delays auto-save (debounce)

- **WHEN** psychologist is actively typing continuously
- **THEN** auto-save timer resets on each keystroke and only fires 10 seconds after the last keystroke

### Requirement: Anamnesis sections use rich text editor

The system SHALL render each anamnesis section as a Tiptap editor instance supporting: bold, italic, underline, headings (H3, H4), bullet lists, numbered lists. No image support required.

#### Scenario: Format text as bold

- **WHEN** psychologist selects text in a section and clicks bold button (or Ctrl+B)
- **THEN** the selected text is rendered bold

#### Scenario: Create a bullet list

- **WHEN** psychologist clicks the bullet list button
- **THEN** a new bullet list is started at the cursor position

### Requirement: Anamnesis is treated as sensitive health data

The system SHALL treat anamnesis data with the same protections as clinical records (LGPD art. 11 — sensitive data). Anamnesis MUST be retained as long as the patient record exists (minimum 20 years per Lei 13.787/2018). RLS MUST restrict access to the owning psychologist only.

#### Scenario: RLS prevents cross-psychologist access

- **WHEN** psychologist A tries to read anamnesis of a patient owned by psychologist B
- **THEN** query returns empty result (RLS blocks access)

#### Scenario: Anamnesis persists after patient is archived

- **WHEN** patient is archived
- **THEN** the anamnesis record remains intact and accessible when the patient detail is viewed

### Requirement: RLS enforces owner-scoped access on anamnesis table

The system SHALL enable RLS on `anamnesis` using a JOIN-based policy: the user can access anamnesis only for patients they own (`patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid())`).

#### Scenario: Psychologist can only read own patients' anamnesis

- **WHEN** psychologist queries the anamnesis table
- **THEN** only anamnesis records for their own patients are returned
