## ADDED Requirements

### Requirement: Psychologist can create a patient

The system SHALL allow an authenticated psychologist to create a new patient record with required fields (full_name, patient_type, phone) and optional fields (birth_date, approximate_age, gender, email, cpf, address, profession, marital_status, source, tags, photo, notes). The patient is always owned by the creating psychologist (`user_id`). **When patient_type is "child" or "adolescent", the creation form SHALL additionally collect guardian information. When patient_type is "couple", the form SHALL collect data for both partners.** The patient's `consent_signed_at` and `consent_revoked_at` fields are managed exclusively by the consent term workflow (not editable via patient CRUD).

#### Scenario: Successful creation of adult patient with minimal fields

- **WHEN** psychologist submits a patient form with full_name="Maria Silva", patient_type="adult", phone="+5511999887766"
- **THEN** system creates a patient record with status="active", user_id=current psychologist, created_at=now, and returns the new patient's ID

#### Scenario: Successful creation with all optional fields

- **WHEN** psychologist submits a patient form with all required fields plus email, cpf, address, profession, marital_status, source, tags=["TCC","infantil"], and notes
- **THEN** system creates the patient record with all provided fields stored correctly

#### Scenario: Creation of child patient requires at least one guardian

- **WHEN** psychologist submits a patient form with patient_type="child" without any guardian information
- **THEN** system rejects with validation error "Paciente menor requer pelo menos um responsavel legal"

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

#### Scenario: consent_signed_at is not settable via create/update

- **WHEN** psychologist submits a patient form including consent_signed_at in the payload
- **THEN** system ignores the field (it is not part of the create/update input schema)

### Requirement: Duplicate patients are prevented per psychologist

The system SHALL enforce uniqueness of phone number and email per psychologist (user_id). Two different psychologists MAY have patients with the same phone/email.

#### Scenario: Duplicate phone for same psychologist is blocked

- **WHEN** psychologist already has a patient with phone="+5511999887766" and tries to create another with the same phone
- **THEN** system rejects with error "Já existe um paciente com este telefone" and suggests the existing patient

#### Scenario: Duplicate email for same psychologist is blocked

- **WHEN** psychologist already has a patient with email="maria@email.com" and tries to create another with the same email
- **THEN** system rejects with error "Já existe um paciente com este email" and suggests the existing patient

#### Scenario: Same phone for different psychologists is allowed

- **WHEN** psychologist A has a patient with phone="+5511999887766" and psychologist B creates a patient with the same phone
- **THEN** system allows the creation (no cross-psychologist uniqueness)

#### Scenario: Null email does not trigger uniqueness constraint

- **WHEN** psychologist creates two patients both with email=null
- **THEN** system allows both creations (null is not considered a duplicate)

### Requirement: Psychologist can update a patient

The system SHALL allow the owning psychologist to update any field of their patient record. The `updated_at` timestamp MUST be set to the current time on every update.

#### Scenario: Update patient name

- **WHEN** psychologist updates patient full_name from "Maria Silva" to "Maria Santos"
- **THEN** system persists the change, sets updated_at=now

#### Scenario: Update fails for patient owned by another psychologist

- **WHEN** psychologist A attempts to update a patient owned by psychologist B
- **THEN** system returns not-found error (RLS prevents seeing other psychologists' patients)

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

### Requirement: Hard delete is restricted to patients without clinical records

The system SHALL only permit hard deletion of patients that have zero sessions, zero anamnesis records, and zero consent terms. Hard delete requires double confirmation (password + typed text "EXCLUIR DEFINITIVAMENTE").

#### Scenario: Hard delete patient with no records

- **WHEN** psychologist confirms hard delete of a patient with no sessions/anamnesis/consent and provides correct password and types "EXCLUIR DEFINITIVAMENTE"
- **THEN** patient record is permanently removed from the database

#### Scenario: Hard delete blocked for patient with sessions

- **WHEN** psychologist attempts to hard delete a patient that has at least one session record
- **THEN** system rejects with error explaining legal obligation to retain records for 20 years and suggests archiving instead

### Requirement: Patient photo upload uses private storage with signed URLs

The system SHALL store patient photos in a private Supabase Storage bucket (`patient-photos`). Photos MUST be served via signed URLs with 5-minute expiration. Maximum file size is 2MB. Accepted formats: JPEG, PNG, WebP.

#### Scenario: Upload photo within size limit

- **WHEN** psychologist uploads a 1.5MB JPEG photo for a patient
- **THEN** system stores the file in `patient-photos/{user_id}/{patient_id}.{ext}` and sets patient.photo_path

#### Scenario: Upload rejected for oversized file

- **WHEN** psychologist uploads a 3MB photo
- **THEN** system rejects with error "Foto deve ter no máximo 2MB"

#### Scenario: Signed URL expires after 5 minutes

- **WHEN** system generates a signed URL for patient photo
- **THEN** URL is valid for exactly 5 minutes; after expiration, access is denied

### Requirement: RLS enforces owner-scoped access on patients table

The system SHALL enable Row Level Security on the `patients` table. Authenticated users can only SELECT, INSERT, UPDATE, and DELETE their own patients (where `user_id = auth.uid()`).

#### Scenario: Psychologist can only see own patients

- **WHEN** psychologist A queries the patients table
- **THEN** only rows where user_id matches psychologist A's auth.uid() are returned

#### Scenario: Insert with mismatched user_id is blocked

- **WHEN** a request attempts to INSERT a patient with user_id different from auth.uid()
- **THEN** the insert is rejected by RLS policy

### Requirement: Patient create/edit form includes WhatsApp reminder controls

The system SHALL extend the patient create and edit forms with a "LEMBRETES WHATSAPP" section containing: (1) a Switch "Receber lembretes via WhatsApp" (default ON), (2) a conditional Textarea for opt-out reason (visible only when switch is OFF), and (3) an optional Input for alternative reminder phone (E.164 validated). These fields map to the `whatsapp_opt_out`, `whatsapp_opt_out_at`, and `reminder_phone` columns on the patients table.

#### Scenario: WhatsApp section visible on create form

- **WHEN** psychologist opens the new patient form
- **THEN** the "LEMBRETES WHATSAPP" section is visible with the switch defaulting to ON

#### Scenario: WhatsApp section visible on edit form with persisted state

- **WHEN** psychologist opens the edit form for a patient with whatsapp_opt_out=true
- **THEN** the switch shows OFF and the reason Textarea is visible with the stored reason

#### Scenario: Patient input schema includes opt-out fields

- **WHEN** the patient create/update input schema is validated
- **THEN** it accepts optional fields: whatsapp_opt_out (boolean), reminder_phone (string, E.164 format)

### Requirement: Patient record stores recording consent tracking

The `patients` table SHALL include `recording_consent_signed_at` (TIMESTAMPTZ, nullable) and `recording_consent_revoked_at` (TIMESTAMPTZ, nullable) columns. A patient with `recording_consent_signed_at IS NOT NULL` AND `recording_consent_revoked_at IS NULL` has active recording consent per Res. CFP 13/2022.

#### Scenario: Recording consent columns exist with correct types

- **WHEN** the migration is applied
- **THEN** the `patients` table has `recording_consent_signed_at` and `recording_consent_revoked_at` columns, both nullable TIMESTAMPTZ

#### Scenario: Active recording consent

- **WHEN** a patient has `recording_consent_signed_at = '2026-01-15'` and `recording_consent_revoked_at IS NULL`
- **THEN** the patient is considered to have active recording consent

#### Scenario: Revoked recording consent

- **WHEN** a patient has `recording_consent_signed_at = '2026-01-15'` and `recording_consent_revoked_at = '2026-03-01'`
- **THEN** the patient is NOT considered to have active recording consent

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
