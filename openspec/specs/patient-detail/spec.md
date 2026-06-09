## ADDED Requirements

### Requirement: Patient detail page displays a header with key information

The system SHALL render a patient detail page at `/app/pacientes/:id` with a header showing: photo (or initials), full_name, calculated age (from birth_date), phone (with "Abrir no WhatsApp" button), email (with "Copiar" button), tags as chips, status badge, **and consent status indicator (pendente/assinado/revogado)**.

#### Scenario: Header renders all available fields

- **WHEN** psychologist navigates to /app/pacientes/:id for a patient with photo, birth_date, phone, email, and tags
- **THEN** system displays the photo, name, calculated age (e.g., "34 anos"), phone with WhatsApp link, email with copy button, tags, and status

#### Scenario: Header without photo shows initials

- **WHEN** patient has no photo uploaded
- **THEN** system displays a circle with the patient's initials (first letter of first and last name)

#### Scenario: Header without birth_date shows approximate age

- **WHEN** patient has approximate_age=30 but no birth_date
- **THEN** system displays "~30 anos" in the age position

#### Scenario: WhatsApp button opens correct URL

- **WHEN** psychologist clicks "Abrir no WhatsApp" for patient with phone="+5511999887766"
- **THEN** system opens `https://wa.me/5511999887766` in a new tab

#### Scenario: Header shows consent signed status

- **WHEN** patient has consent_signed_at set
- **THEN** header displays a green badge "Consentimento assinado"

#### Scenario: Header shows consent pending status

- **WHEN** patient has no consent_signed_at and no consent_terms record
- **THEN** header displays a yellow badge "Consentimento pendente"

#### Scenario: Header shows consent revoked status

- **WHEN** patient has consent_signed_at cleared and a consent_terms record with revoked_at
- **THEN** header displays a red badge "Consentimento revogado" with warning styling

### Requirement: Patient detail page uses a tab layout

The system SHALL organize patient details into tabs. The available tabs SHALL be, in this order: "Visão geral", "Histórico de sessões", "Prontuário", "Anamnese", "Financeiro". The "Visão geral" and "Anamnese" tabs are functional content tabs. The "Prontuário" tab SHALL render a redirect panel pointing to the patient's prontuario page at `/pacientes/[id]/prontuario`. The "Histórico de sessões" tab SHALL render the patient session history (see the `patient-session-history` capability), no longer a placeholder. The "Financeiro" tab SHALL be rendered as a placeholder with the "Em breve" message. The "Documentos" tab SHALL NOT exist in the tab layout — clinical documents are accessible exclusively via the prontuario page. The "Financeiro" tab icon SHALL be the `Receipt` icon (recibo), aligning with the Brazilian fiscal context of session receipts for IR deduction. The "Histórico de sessões" tab icon SHALL be the `Calendar` icon.

#### Scenario: Default tab is "Visão geral"

- **WHEN** psychologist navigates to /pacientes/:id
- **THEN** the "Visão geral" tab is active by default

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

#### Scenario: Histórico de sessões tab renders the session history

- **WHEN** psychologist clicks on "Histórico de sessões" tab
- **THEN** system renders the session history view (summary strip + session list, or the appropriate empty/loading/error state) inside `data-testid="patient-tab-content-sessions"`
- **AND** the "Em breve" placeholder is NOT shown for this tab

### Requirement: Visão geral shows patient overview

The system SHALL display the address in the "Visão geral" tab as a formatted human-readable string following the Brazilian address convention: `street, number, complement - neighborhood - city, state zipCode`. Missing parts SHALL be omitted without leaving dangling separators. If all address fields are empty or the stored value is unparseable, the field SHALL display `'-'`.

#### Scenario: Overview lists patient fields

- **WHEN** the "Visão geral" tab is active
- **THEN** system displays: notes (observação livre), patient_type, birth_date/age, gender, profession, marital_status, source, address, cpf (masked as "***.***.***-XX"), and created_at

#### Scenario: Full address renders formatted

- **WHEN** patient has address `{"street":"Rua Exemplo","number":"123","complement":"Apto 4","neighborhood":"Centro","city":"São Paulo","state":"SP","zipCode":"01001-000"}`
- **THEN** the "Endereço" field displays "Rua Exemplo, 123, Apto 4 - Centro - São Paulo, SP 01001-000"

#### Scenario: Partial address omits missing parts

- **WHEN** patient has address `{"street":"Av. Brasil","number":"500","city":"Campinas","state":"SP"}`
- **THEN** the "Endereço" field displays "Av. Brasil, 500 - Campinas, SP"

#### Scenario: Empty or null address shows dash

- **WHEN** patient has address as `null` or `"{}"`
- **THEN** the "Endereço" field displays "-"

#### Scenario: Corrupted JSON shows dash

- **WHEN** patient has address as an unparseable string
- **THEN** the "Endereço" field displays "-"

#### Scenario: PDF export uses same formatted address

- **WHEN** psychologist exports a patient PDF for a patient with a stored address
- **THEN** the PDF "Endereço" field displays the same formatted string as the overview tab

### Requirement: Patient detail page has an actions menu

The system SHALL provide an actions menu (three-dot or dropdown) with options: Editar, Arquivar/Desarquivar (based on current status), **Exportar PDF**, and Excluir (only for patients without clinical records).

#### Scenario: Actions menu for active patient

- **WHEN** psychologist opens the actions menu for an active patient
- **THEN** menu shows: "Editar", "Arquivar", and conditionally "Excluir" (only if patient has no sessions/anamnesis/consent)

#### Scenario: Actions menu for archived patient

- **WHEN** psychologist opens the actions menu for an archived patient
- **THEN** menu shows: "Editar", "Desarquivar", and conditionally "Excluir"

#### Scenario: Archive action shows confirmation modal

- **WHEN** psychologist clicks "Arquivar" in the actions menu
- **THEN** system displays a confirmation modal explaining legal retention obligation (CFP 5 anos / Lei 13.787/2018 20 anos) with "Confirmar" and "Cancelar" buttons

#### Scenario: Actions menu includes export option

- **WHEN** psychologist opens the actions menu for any patient
- **THEN** menu includes "Exportar PDF" option

#### Scenario: Export PDF from actions menu

- **WHEN** psychologist clicks "Exportar PDF" in the actions menu
- **THEN** system shows the secrecy confirmation dialog before generating PDF

### Requirement: Patient creation form has two steps

The system SHALL render the patient creation form at `/app/pacientes/novo` in two steps: Step 1 (required fields: full_name, patient_type, birth_date or approximate_age, phone) and Step 2 (optional fields: gender, email, cpf, address, profession, marital_status, source, tags, photo, notes).

#### Scenario: Step 1 validation prevents advancing with missing required fields

- **WHEN** psychologist tries to advance to step 2 without filling full_name
- **THEN** system shows validation error on full_name field and does not advance

#### Scenario: Step 2 is skippable

- **WHEN** psychologist completes step 1 and clicks "Pular" on step 2
- **THEN** system creates the patient with only step 1 fields and redirects to patient detail page

#### Scenario: After creation, quick action buttons are shown

- **WHEN** patient is successfully created and psychologist is redirected to detail page
- **THEN** system displays quick action buttons: "Agendar primeira sessão" (disabled/placeholder), "Enviar termo de consentimento" (disabled/placeholder), "Adicionar à anamnese" (disabled/placeholder)

### Requirement: Patient edit form pre-fills all current values

The system SHALL render the edit form at `/app/pacientes/:id/editar` with all current patient field values pre-filled. Saving navigates back to the detail page with a success toast.

#### Scenario: Edit form loads with current data

- **WHEN** psychologist navigates to edit form for patient "Maria Silva"
- **THEN** all fields are pre-filled with Maria's current data (name, phone, email, etc.)

#### Scenario: Successful edit shows confirmation

- **WHEN** psychologist changes full_name and submits the edit form
- **THEN** system updates the patient, redirects to detail page, and shows success toast "Paciente atualizado"
