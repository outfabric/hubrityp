## MODIFIED Requirements

### Requirement: Patient detail page uses a tab layout

The system SHALL organize patient details into tabs. The available tabs SHALL be, in this order: "Visão geral", "Histórico de sessões", "Prontuário", "Anamnese", "Financeiro". The "Visão geral" and "Anamnese" tabs are functional content tabs. The "Prontuário" tab SHALL render a redirect panel pointing to the patient's prontuario page at `/pacientes/[id]/prontuario`. The "Histórico de sessões" and "Financeiro" tabs SHALL be rendered as placeholders with the "Em breve" message. The "Documentos" tab SHALL NOT exist in the tab layout — clinical documents are accessible exclusively via the prontuario page. The "Financeiro" tab icon SHALL be the `Receipt` icon (recibo), aligning with the Brazilian fiscal context of session receipts for IR deduction.

#### Scenario: Default tab is "Visão geral"

- **WHEN** psychologist navigates to /pacientes/:id
- **THEN** the "Visão geral" tab is active by default

#### Scenario: Visão geral shows patient overview

- **WHEN** the "Visão geral" tab is active
- **THEN** system displays: notes (observação livre), patient_type, birth_date/age, gender, profession, marital_status, source, address, cpf (masked as "***.***.***-XX"), and created_at

#### Scenario: Anamnese tab is functional

- **WHEN** psychologist clicks on "Anamnese" tab
- **THEN** system displays the anamnesis editor with all standard sections (or empty form if no anamnesis exists)

#### Scenario: Prontuário tab shows redirect panel with link to prontuario page

- **WHEN** psychologist clicks on "Prontuário" tab
- **THEN** system displays a redirect panel with title "Prontuario", a short description explaining that evolutions, diagnostic hypotheses, scales, treatment plan and clinical documents live on the dedicated page, and a button labelled "Abrir prontuario"
- **AND** the button is a link pointing to `/pacientes/[id]/prontuario`

#### Scenario: Documentos tab is no longer rendered

- **WHEN** psychologist views the patient detail page
- **THEN** no tab with the label "Documentos" is present in the tab list
- **AND** no element with `data-testid="patient-tab-documents"` is present in the DOM

#### Scenario: Financeiro tab is a placeholder with the Receipt icon

- **WHEN** psychologist clicks on "Financeiro" tab
- **THEN** system shows the tab content area with message "Em breve"
- **AND** the tab trigger displays the `Receipt` (recibo) icon, not the `Wallet` icon

#### Scenario: Histórico de sessões tab remains a placeholder

- **WHEN** psychologist clicks on "Histórico de sessões" tab
- **THEN** system shows the tab content area with message "Em breve"
