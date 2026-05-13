## MODIFIED Requirements

### Requirement: Psychologist cancellation triggers WhatsApp notice to patient

When a session is cancelled with `cancelled_by = 'therapist'`, the system SHALL emit an event that triggers the `whatsapp-confirmation-flow` capability to send the `cancelamento_aviso` template to the patient. The notice is only sent if the patient has not opted out of WhatsApp (`whatsapp_opt_out = false`) and the psychologist's WhatsApp account is active.

#### Scenario: Therapist cancels session and patient receives WhatsApp notice

- **WHEN** psychologist cancels a session with patient "Marina" for 2026-05-16 at 14:00, and Marina has whatsapp_opt_out=false
- **THEN** system sends `cancelamento_aviso` template to Marina with variables: nome_paciente="Marina", data="16/05", hora="14:00", and the psychologist's cancellation message

#### Scenario: Therapist cancels but patient opted out

- **WHEN** psychologist cancels a session and the patient has whatsapp_opt_out=true
- **THEN** no WhatsApp cancellation notice is sent

#### Scenario: Therapist cancels but WhatsApp account is in error state

- **WHEN** psychologist cancels a session and their whatsapp_accounts.status='error'
- **THEN** no WhatsApp cancellation notice is sent (account is not functional)

#### Scenario: Patient-initiated cancellation does not trigger notice

- **WHEN** a session is cancelled via the WhatsApp "Nao posso comparecer" button (cancelled_by='patient')
- **THEN** no `cancelamento_aviso` template is sent to the patient (they already know)

#### Scenario: Cancellation event already exists and integrates with WhatsApp

- **WHEN** the existing `agenda/session.cancelled` Inngest event is emitted by the cancel-session Server Action
- **THEN** the new `cancellation-notice-sender` Inngest function listens to this event and sends the WhatsApp notice (no changes to the existing cancel-session Server Action are needed beyond ensuring the event payload includes `cancelledBy`)
