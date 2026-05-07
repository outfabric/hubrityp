## MODIFIED Requirements

### Requirement: Patient detail page uses a tab layout

The system SHALL organize patient details into tabs. The "Visão geral" and "Anamnese" tabs are functional. Other tabs (Histórico de sessões, Prontuário, Documentos, Financeiro) SHALL be rendered as placeholders with "Em breve" message.

#### Scenario: Default tab is "Visão geral"

- **WHEN** psychologist navigates to /app/pacientes/:id
- **THEN** the "Visão geral" tab is active by default

#### Scenario: Anamnese tab is functional

- **WHEN** psychologist clicks on "Anamnese" tab
- **THEN** system displays the anamnesis editor with all standard sections (or empty form if no anamnesis exists)

#### Scenario: Remaining placeholder tabs show coming-soon message

- **WHEN** psychologist clicks on "Prontuário" tab
- **THEN** system shows the tab content area with message "Em breve"
