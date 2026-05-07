## MODIFIED Requirements

### Requirement: Psychologist can create a patient

The system SHALL allow an authenticated psychologist to create a new patient record with required fields (full_name, patient_type, phone) and optional fields (birth_date, approximate_age, gender, email, cpf, address, profession, marital_status, source, tags, photo, notes). The patient is always owned by the creating psychologist (`user_id`). **When patient_type is "child" or "adolescent", the creation form SHALL additionally collect guardian information. When patient_type is "couple", the form SHALL collect data for both partners.**

#### Scenario: Successful creation of adult patient with minimal fields

- **WHEN** psychologist submits a patient form with full_name="Maria Silva", patient_type="adult", phone="+5511999887766"
- **THEN** system creates a patient record with status="active", user_id=current psychologist, created_at=now, and returns the new patient's ID

#### Scenario: Successful creation with all optional fields

- **WHEN** psychologist submits a patient form with all required fields plus email, cpf, address, profession, marital_status, source, tags=["TCC","infantil"], and notes
- **THEN** system creates the patient record with all provided fields stored correctly

#### Scenario: Creation of child patient requires at least one guardian

- **WHEN** psychologist submits a patient form with patient_type="child" without any guardian information
- **THEN** system rejects with validation error "Paciente menor requer pelo menos um responsável legal"

#### Scenario: Creation of couple patient requires partner data

- **WHEN** psychologist submits a patient form with patient_type="couple" without partner data
- **THEN** system rejects with validation error "Paciente tipo casal requer dados do parceiro(a)"

#### Scenario: Phone validation rejects invalid format

- **WHEN** psychologist submits a patient with phone="1199988776" (missing country code/format)
- **THEN** system rejects with validation error indicating expected format "+55 DD NNNNN-NNNN"

#### Scenario: CPF validation rejects invalid CPF

- **WHEN** psychologist submits a patient with cpf="111.111.111-11" (invalid check digits)
- **THEN** system rejects with validation error "CPF inválido"

#### Scenario: Email validation rejects malformed email

- **WHEN** psychologist submits a patient with email="not-an-email"
- **THEN** system rejects with validation error for email field
