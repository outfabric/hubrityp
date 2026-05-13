## MODIFIED Requirements

### Requirement: Sessions table includes reminders_disabled column

The `sessions` table SHALL be extended with:

- `reminders_disabled BOOLEAN DEFAULT FALSE` — per-session override that suppresses WhatsApp reminder dispatch for this session

This column is consumed by the WhatsApp dispatcher cron: sessions with `reminders_disabled = true` are excluded from reminder scanning.

#### Scenario: Migration adds reminders_disabled column

- **WHEN** the migration for this change runs
- **THEN** the `reminders_disabled` column is added to `sessions` as `BOOLEAN DEFAULT FALSE`

#### Scenario: Default value is false

- **WHEN** a new session is created without specifying reminders_disabled
- **THEN** reminders_disabled defaults to false (reminders are sent normally)

#### Scenario: Existing sessions are unaffected

- **WHEN** the migration runs against a database with existing sessions
- **THEN** all existing sessions have reminders_disabled = false (backfilled by DEFAULT)

## ADDED Requirements

### Requirement: Session form includes WhatsApp reminder suppression checkbox

The session create/edit modal SHALL include a `Checkbox` labeled "Nao enviar lembretes WhatsApp para esta sessao" that controls the `reminders_disabled` field. The checkbox is visible only when the selected patient has a phone number and `whatsapp_opt_out` is `false`.

#### Scenario: Checkbox visible for eligible patient

- **WHEN** psychologist creates a session for patient Marina who has a phone and whatsapp_opt_out=false
- **THEN** the checkbox "Nao enviar lembretes WhatsApp para esta sessao" is visible below the notes field

#### Scenario: Checkbox hidden for opted-out patient

- **WHEN** psychologist creates a session for patient Carlos who has whatsapp_opt_out=true
- **THEN** the checkbox is hidden (reminders already globally disabled for this patient)

#### Scenario: Checkbox hidden for patient without phone

- **WHEN** psychologist creates a session for a patient with no phone number
- **THEN** the checkbox is hidden (no phone to send to)

#### Scenario: Checkbox hidden for blocking events

- **WHEN** psychologist creates a blocking event (is_blocking=true)
- **THEN** the checkbox is hidden (blocks have no patient and no reminders)

#### Scenario: Checking the box disables reminders for this session

- **WHEN** psychologist checks "Nao enviar lembretes WhatsApp para esta sessao" and saves
- **THEN** session is created with reminders_disabled=true

#### Scenario: Helper text explains the purpose

- **WHEN** the checkbox is visible
- **THEN** helper text reads "Util quando o paciente avisou que nao pode receber" in body-sm text-tertiary
