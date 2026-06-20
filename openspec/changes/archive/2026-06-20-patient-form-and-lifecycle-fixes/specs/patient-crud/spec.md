## ADDED Requirements

### Requirement: Patient form phone fields use an idempotent masked input

Every phone field in the patient create and edit forms — the patient phone, the alternative reminder phone, each guardian phone (for minors), and each partner phone (for couples) — SHALL use a single shared masked phone input that renders the `+55` country code as a **fixed, non-editable visual prefix** and keeps only the national portion (2-digit DDD + 8/9-digit number) in the editable text. The input SHALL be idempotent: re-applying the mask to already-masked text MUST NOT alter the captured digits, so the displayed value never accumulates spurious `55` digits as the user types. The field's value exposed to validation and submission SHALL remain the canonical `+55 DD NNNNN-NNNN` string, leaving validators, schemas, stored format, and `wa.me` links unchanged. Each field MUST preserve its existing `data-testid` on the editable `<input>` element.

#### Scenario: Typing a full mobile number produces the canonical value

- **WHEN** the psychologist focuses an empty patient phone field and types the digits `11912345678`
- **THEN** the editable text shows `11 91234-5678` behind a fixed `+55` prefix
- **AND** the field value submitted for validation is `+55 11 91234-5678` (no repeated `55`)

#### Scenario: Mask is idempotent across keystrokes

- **WHEN** the psychologist types digits one at a time into any patient-form phone field
- **THEN** each intermediate masked value contains exactly one country code, and the previously rendered prefix is never re-interpreted as DDD/number digits

#### Scenario: DDD 55 (Rio Grande do Sul) is preserved

- **WHEN** the psychologist enters a number whose DDD is `55` (e.g. national digits `55999887766`)
- **THEN** the field value is `+55 55 99988-7766`, with the DDD `55` intact and not stripped as a country code

#### Scenario: Guardian phone on a child registration accepts input correctly

- **WHEN** registering a `child` patient and entering the patient phone, the reminder phone, and the guardian phone
- **THEN** each field independently captures its typed number without injecting `55`, and all submit in canonical `+55 DD NNNNN-NNNN` format

#### Scenario: Editing a patient pre-fills phone fields from stored values

- **WHEN** the edit form loads a patient whose stored phone is `+55 11 91234-5678`
- **THEN** the editable text shows `11 91234-5678` behind the `+55` prefix, and saving without changes preserves the canonical stored value

## MODIFIED Requirements

### Requirement: Psychologist can archive and unarchive patients

The system SHALL allow the owning psychologist to archive a patient (soft delete) by setting status="archived" and archived_at=now. Archived patients do not appear in the default listing. Unarchiving sets status="active" and clears archived_at. After an archive or unarchive mutation, the system SHALL invalidate the server-side cache for the patient listing (`/pacientes`) and the patient detail route (`/pacientes/[id]`) so that, on any subsequent navigation, both the listing and the detail page reflect the patient's new persisted status (e.g. the actions menu offers the correct Arquivar/Desarquivar action) without a manual reload.

#### Scenario: Archive a patient

- **WHEN** psychologist archives patient "Maria Silva"
- **THEN** patient.status becomes "archived", patient.archived_at is set to current timestamp

#### Scenario: Unarchive a patient

- **WHEN** psychologist unarchives patient "Maria Silva"
- **THEN** patient.status becomes "active", patient.archived_at is set to null

#### Scenario: Archived patient retains all historical data

- **WHEN** psychologist archives a patient who has sessions and anamnesis
- **THEN** all associated records remain intact and accessible when patient is unarchived

#### Scenario: Listing and detail reflect the new status after navigation

- **WHEN** psychologist archives a patient and then navigates to the listing and re-opens the patient detail page
- **THEN** the listing no longer shows the patient under the default active filter and the detail actions menu offers "Desarquivar" (never a stale "Arquivar")
