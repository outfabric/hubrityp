## ADDED Requirements

### Requirement: Psychologist can add guardians to minor patients

The system SHALL allow adding up to 2 guardians (responsáveis legais) for patients with patient_type "child" or "adolescent". Each guardian has required fields (full_name, relationship, phone) and optional fields (cpf, email). One guardian MUST be marked as `is_primary`.

#### Scenario: Add first guardian to child patient

- **WHEN** psychologist creates a child patient and fills guardian fields (full_name="Ana Silva", relationship="mãe", phone="+5511988776655")
- **THEN** system creates the patient and a linked guardian record with is_primary=true

#### Scenario: Add second guardian

- **WHEN** psychologist adds a second guardian to an existing child patient
- **THEN** system creates the guardian record with is_primary=false

#### Scenario: Attempt to add third guardian is blocked

- **WHEN** psychologist tries to add a third guardian to a patient that already has 2
- **THEN** system rejects with error "Máximo de 2 responsáveis por paciente"

#### Scenario: Guardian CPF validation

- **WHEN** psychologist fills guardian CPF with invalid value "000.000.000-00"
- **THEN** system rejects with validation error "CPF inválido"

### Requirement: Psychologist can update and remove guardians

The system SHALL allow updating any field of a guardian and removing a guardian. If the primary guardian is removed, the remaining guardian (if any) MUST be promoted to primary.

#### Scenario: Update guardian phone

- **WHEN** psychologist updates guardian phone from "+5511988776655" to "+5511977665544"
- **THEN** system persists the change

#### Scenario: Remove primary guardian with secondary existing

- **WHEN** psychologist removes the primary guardian and a secondary guardian exists
- **THEN** system removes the guardian and promotes the remaining one to is_primary=true

#### Scenario: Remove sole guardian

- **WHEN** psychologist removes the only guardian of a child patient
- **THEN** system removes the guardian and shows warning "Este paciente menor está sem responsável cadastrado"

### Requirement: Guardian information is displayed in patient detail

The system SHALL display guardian information in the patient detail page for minor patients, in a dedicated "Responsáveis" section within the header or overview tab.

#### Scenario: Minor patient detail shows guardians

- **WHEN** psychologist views detail page of a child patient with 2 guardians
- **THEN** system displays both guardians with name, relationship, phone, and a primary badge on the primary guardian

#### Scenario: Adult patient detail does not show guardians section

- **WHEN** psychologist views detail page of an adult patient
- **THEN** the "Responsáveis" section is not rendered

### Requirement: RLS enforces owner-scoped access on patient_guardians

The system SHALL enable RLS on `patient_guardians` using a JOIN-based policy: the user can access guardians only for patients they own (`patients.user_id = auth.uid()`).

#### Scenario: Psychologist can only see guardians of own patients

- **WHEN** psychologist A queries patient_guardians
- **THEN** only guardians linked to patients owned by psychologist A are returned

#### Scenario: Insert guardian for another psychologist's patient is blocked

- **WHEN** psychologist A tries to insert a guardian for a patient owned by psychologist B
- **THEN** the insert is rejected by RLS
