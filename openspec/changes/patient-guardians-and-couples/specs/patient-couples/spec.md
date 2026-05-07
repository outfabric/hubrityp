## ADDED Requirements

### Requirement: Psychologist can create a couple-linked pair of patients

The system SHALL support creating two patients linked via a shared `couple_id` (UUID). When patient_type is "couple", the creation form collects data for both partners and creates two patient records with the same couple_id.

#### Scenario: Create couple creates two linked patients

- **WHEN** psychologist creates a patient with type="couple" and fills data for partner A (Maria, +5511999001122) and partner B (João, +5511999003344)
- **THEN** system creates two separate patient records, both with the same couple_id and patient_type="couple"

#### Scenario: Couple patients appear individually in listing

- **WHEN** psychologist views the patient listing after creating a couple
- **THEN** both Maria and João appear as separate rows, each with a visual indicator (icon/badge) showing they are part of a couple

#### Scenario: Couple patient detail shows linked partner

- **WHEN** psychologist views Maria's detail page
- **THEN** system displays a "Parceiro(a)" section showing João's name with a link to João's detail page

### Requirement: Psychologist can unlink a couple

The system SHALL allow unlinking two coupled patients. This sets couple_id to null on both patients and changes their patient_type to "adult".

#### Scenario: Unlink couple

- **WHEN** psychologist clicks "Desvincular casal" on Maria's detail page and confirms
- **THEN** both Maria and João have couple_id set to null and patient_type changed to "adult"

#### Scenario: Unlinking preserves all other patient data

- **WHEN** couple is unlinked
- **THEN** all other fields (sessions, anamnesis, notes) remain intact on both patients
