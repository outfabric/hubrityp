# whatsapp-stop-command Specification

## Purpose

Patient opt-out from WhatsApp reminders via the PARAR command, including phone matching, idempotent opt-out processing, confirmation messaging, and psychologist notification.

## Requirements

### Requirement: PARAR command opts patient out of WhatsApp reminders (RF-04.21)

The system SHALL detect the word "PARAR" (case-insensitive, trimmed) in inbound text messages. When detected, the system: (1) sets `patients.whatsapp_opt_out = true` and `patients.whatsapp_opt_out_at = NOW()`, (2) ceases all future reminders for that patient, (3) sends a confirmation message "Nao enviaremos mais lembretes. Para retomar, fale com seu psicologo.", (4) notifies the psychologist in-app.

#### Scenario: Patient sends "PARAR"

- **WHEN** webhook receives inbound text "PARAR" from patient Marina's phone
- **THEN** Marina's record is updated: whatsapp_opt_out=true, whatsapp_opt_out_at=NOW()

#### Scenario: Case-insensitive matching

- **WHEN** webhook receives inbound text "parar" (lowercase)
- **THEN** opt-out is processed identically to "PARAR"

#### Scenario: Whitespace-tolerant matching

- **WHEN** webhook receives inbound text " PARAR " (with leading/trailing spaces)
- **THEN** opt-out is processed (trimmed comparison)

#### Scenario: Confirmation message sent to patient

- **WHEN** PARAR command is processed
- **THEN** system sends "Nao enviaremos mais lembretes. Para retomar, fale com seu psicologo." to the patient

#### Scenario: Psychologist notified of opt-out

- **WHEN** PARAR command is processed for patient Marina
- **THEN** psychologist receives in-app notification: title "Paciente optou por nao receber lembretes", body "Marina solicitou parar de receber lembretes via WhatsApp. Lembretes foram desativados."

#### Scenario: Future reminders are not sent after opt-out

- **WHEN** dispatcher cron runs and patient Marina has whatsapp_opt_out=true
- **THEN** no reminder events are emitted for Marina's sessions

#### Scenario: PARAR from unrecognized phone

- **WHEN** webhook receives "PARAR" from a phone number not matching any patient
- **THEN** the message is persisted as inbound with patient_id=NULL; no opt-out action is taken (no patient to opt out)

#### Scenario: PARAR when already opted out

- **WHEN** webhook receives "PARAR" from a patient who already has whatsapp_opt_out=true
- **THEN** the command is idempotent — no error, confirmation is still sent, no duplicate notification

#### Scenario: Text containing PARAR among other words is NOT treated as opt-out

- **WHEN** webhook receives "quero parar de ir na quarta" from a patient
- **THEN** the message is treated as regular inbound text (not an opt-out command) because the trimmed body is not exactly "PARAR"
