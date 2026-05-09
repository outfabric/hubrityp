## ADDED Requirements

### Requirement: Psychologist can import patients via CSV upload

The system SHALL provide an import page at `/app/pacientes/importar` where the psychologist uploads a CSV file. The system parses the CSV and maps columns to patient fields: nome, telefone, email, data_nascimento, tags, observacao.

#### Scenario: Upload valid CSV

- **WHEN** psychologist uploads a CSV with headers "nome,telefone,email,data_nascimento,tags,observacao" and 10 valid rows
- **THEN** system parses the file and shows a preview table with all 10 rows marked as valid

#### Scenario: Upload CSV with unmapped columns

- **WHEN** CSV has headers that don't match expected names (e.g., "name" instead of "nome")
- **THEN** system shows a column mapping UI where psychologist can manually map columns

### Requirement: CSV import validates each row before importing

The system SHALL validate each row individually: phone format, email format, and check for duplicates against existing patients (same phone OR same email for the same psychologist). Invalid rows are flagged with specific error messages.

#### Scenario: Row with invalid phone is flagged

- **WHEN** a CSV row has phone="123456" (invalid format)
- **THEN** the preview shows that row highlighted in red with error "Telefone inválido"

#### Scenario: Row with duplicate phone is flagged

- **WHEN** a CSV row has a phone that already exists for this psychologist
- **THEN** the preview shows that row highlighted in yellow with warning "Paciente com este telefone já existe"

#### Scenario: Row with valid data is marked green

- **WHEN** a CSV row passes all validations
- **THEN** the preview shows that row highlighted in green with checkmark

### Requirement: Import preview shows summary before confirmation

The system SHALL display a summary after validation: total rows, valid rows, rows with errors, rows with duplicate warnings. Only valid rows are imported. Psychologist MUST confirm before import proceeds.

#### Scenario: Preview with mixed results

- **WHEN** CSV has 50 rows: 45 valid, 3 with errors, 2 with duplicate warnings
- **THEN** preview shows summary "50 linhas | 45 válidas | 3 com erros | 2 duplicadas" with "Importar 45 pacientes" button

#### Scenario: Confirm import

- **WHEN** psychologist clicks "Importar 45 pacientes"
- **THEN** system imports the 45 valid rows as new patients (status="active", patient_type="adult"), shows progress, and redirects to listing with success toast "45 pacientes importados"

#### Scenario: All rows invalid

- **WHEN** all CSV rows have validation errors
- **THEN** the import button is disabled and message shows "Nenhuma linha válida para importar"

### Requirement: CSV import handles up to 200 rows

The system SHALL support importing CSV files with up to 200 rows. Files exceeding 200 rows are rejected with error "Máximo de 200 linhas por importação".

#### Scenario: CSV with 201 rows is rejected

- **WHEN** psychologist uploads a CSV with 201 data rows
- **THEN** system shows error "Máximo de 200 linhas por importação. Seu arquivo tem 201."

### Requirement: Import creates patients in batch with error handling

The system SHALL insert valid rows in a single database transaction. If any individual insert fails (unexpected DB error), the entire batch is rolled back and the error is reported.

#### Scenario: Batch insert succeeds

- **WHEN** 45 valid rows are confirmed for import
- **THEN** all 45 patients are created in a single transaction with patient_type="adult" and status="active"

#### Scenario: Batch insert fails (DB error)

- **WHEN** a DB error occurs during batch insert
- **THEN** entire transaction is rolled back and psychologist sees error "Erro ao importar. Nenhum paciente foi criado. Tente novamente."
