## MODIFIED Requirements

### Requirement: Psychologist can create a patient

The system SHALL allow an authenticated psychologist to create a new patient record with required fields (full_name, patient_type, phone) and optional fields (birth_date, approximate_age, gender, email, cpf, address, profession, marital_status, source, tags, photo, notes). The patient is always owned by the creating psychologist (`user_id`). The patient's `consent_signed_at` and `consent_revoked_at` fields are managed exclusively by the consent term workflow (not editable via patient CRUD).

#### Scenario: consent_signed_at is not settable via create/update

- **WHEN** psychologist submits a patient form including consent_signed_at in the payload
- **THEN** system ignores the field (it is not part of the create/update input schema)
