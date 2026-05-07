## MODIFIED Requirements

### Requirement: Patient detail page displays a header with key information

The system SHALL render a patient detail page at `/app/pacientes/:id` with a header showing: photo (or initials), full_name, calculated age, phone (with "Abrir no WhatsApp" button), email (with "Copiar" button), tags as chips, status badge, **and consent status indicator (pendente/assinado/revogado)**.

#### Scenario: Header shows consent signed status

- **WHEN** patient has consent_signed_at set
- **THEN** header displays a green badge "Consentimento assinado"

#### Scenario: Header shows consent pending status

- **WHEN** patient has no consent_signed_at and no consent_terms record
- **THEN** header displays a yellow badge "Consentimento pendente"

#### Scenario: Header shows consent revoked status

- **WHEN** patient has consent_signed_at cleared and a consent_terms record with revoked_at
- **THEN** header displays a red badge "Consentimento revogado" with warning styling
