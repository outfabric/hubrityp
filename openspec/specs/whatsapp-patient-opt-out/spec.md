## Requirements

### Requirement: Psychologist can toggle WhatsApp opt-out for a patient

The system SHALL allow the psychologist to toggle the `whatsapp_opt_out` field on a patient record via a Switch in the patient create/edit form. When opt-out is enabled, the system records `whatsapp_opt_out_at` with the current timestamp. When opt-out is disabled (re-enabling reminders), `whatsapp_opt_out` is set to false and `whatsapp_opt_out_at` is cleared (set to null).

#### Scenario: Disable reminders for a patient

- **WHEN** psychologist turns off the "Receber lembretes via WhatsApp" switch for patient "Marina" and saves the form
- **THEN** system sets whatsapp_opt_out=true and whatsapp_opt_out_at=now on the patient record

#### Scenario: Re-enable reminders for a patient

- **WHEN** psychologist turns on the "Receber lembretes via WhatsApp" switch for patient "Marina" (previously opted out) and saves
- **THEN** system sets whatsapp_opt_out=false and whatsapp_opt_out_at=null

#### Scenario: Opt-out persists across page reload

- **WHEN** psychologist disables reminders for "Marina", saves, and reloads the patient edit page
- **THEN** the switch shows the OFF state and the opt-out reason (if provided) is displayed

#### Scenario: New patients default to opt-in

- **WHEN** psychologist creates a new patient
- **THEN** the "Receber lembretes via WhatsApp" switch is ON by default (whatsapp_opt_out=false)

### Requirement: Psychologist can record an opt-out reason

The system SHALL display a conditional Textarea labeled "Motivo (visível só para você)" when the opt-out switch is OFF. The reason is stored alongside the opt-out flag but is optional.

#### Scenario: Record opt-out reason

- **WHEN** psychologist turns off reminders and enters "Paciente pediu para não receber mensagens" in the reason field
- **THEN** the reason is stored (accessible only to the owning psychologist via RLS)

#### Scenario: Opt-out without reason

- **WHEN** psychologist turns off reminders without entering a reason
- **THEN** system accepts the opt-out with a null reason

#### Scenario: Reason field is hidden when opt-in

- **WHEN** the "Receber lembretes via WhatsApp" switch is ON
- **THEN** the reason Textarea is not rendered

### Requirement: Psychologist can set an alternative reminder phone for a patient

The system SHALL allow the psychologist to set a `reminder_phone` on the patient record. When set, WhatsApp reminders (in change 2) will be sent to this number instead of the patient's primary phone. The number MUST be validated as E.164 format. This field is useful for minors whose reminders go to a guardian.

#### Scenario: Set alternative phone for a minor

- **WHEN** psychologist enters "+5511976543210" in the "Telefone alternativo para lembretes" field for a child patient and saves
- **THEN** system stores reminder_phone="+5511976543210" on the patient record

#### Scenario: Clear alternative phone

- **WHEN** psychologist clears the reminder_phone field and saves
- **THEN** system sets reminder_phone to null (reminders will use primary phone)

#### Scenario: Invalid alternative phone rejected

- **WHEN** psychologist enters "976543210" (missing country code) in reminder_phone
- **THEN** system shows inline validation error "Telefone inválido. Use o formato +55 (DD) NNNNN-NNNN."

#### Scenario: Alternative phone accepts international numbers

- **WHEN** psychologist enters "+351912345678" (Portuguese number)
- **THEN** system accepts the number (E.164 validation allows any country code)

### Requirement: Opt-out toggle uses a dedicated Server Action

The system SHALL provide an `update-patient-whatsapp-opt-out` Server Action that accepts patient_id, whatsapp_opt_out (boolean), and optional opt_out_reason (string). The action authenticates the user, verifies patient ownership via RLS, and updates the three opt-out columns atomically.

#### Scenario: Successful opt-out toggle

- **WHEN** the Server Action is called with patient_id, whatsapp_opt_out=true
- **THEN** system updates the patient's whatsapp_opt_out, whatsapp_opt_out_at, and clears reminder_phone is NOT affected

#### Scenario: Patient owned by another psychologist

- **WHEN** psychologist A calls the action for a patient owned by psychologist B
- **THEN** the action returns not-found error (RLS prevents access)

### Requirement: Patient columns for opt-out and reminder_phone are added

The system SHALL add three columns to the `patients` table: `whatsapp_opt_out` (boolean DEFAULT false), `whatsapp_opt_out_at` (timestamptz, nullable), and `reminder_phone` (varchar(20), nullable). These columns are included in the existing RLS policies (which apply to all columns of the `patients` table).

#### Scenario: Columns have correct defaults

- **WHEN** a new patient is created without specifying opt-out fields
- **THEN** whatsapp_opt_out=false, whatsapp_opt_out_at=null, reminder_phone=null

#### Scenario: Existing patients are unaffected by migration

- **WHEN** the migration adding these columns runs on a database with existing patients
- **THEN** all existing patients have whatsapp_opt_out=false, whatsapp_opt_out_at=null, reminder_phone=null (safe defaults)
