## ADDED Requirements

### Requirement: Patient confirmation via WhatsApp button updates session status (RF-04.15)

The system SHALL process Quick Reply "Confirmar" button presses received via Twilio webhook. When a patient presses "Confirmar", the system sets `sessions.status = 'confirmed'` and `sessions.confirmed_at = NOW()`, emits an `agenda/session.confirmed` event, sends the `confirmacao_recebida` template, and notifies the psychologist in-app.

#### Scenario: Patient confirms a scheduled session

- **WHEN** webhook receives a Quick Reply with payload "Confirmar" for a session with status "scheduled"
- **THEN** session status changes to "confirmed", confirmed_at is set, `confirmacao_recebida` template is sent, and psychologist receives in-app notification "Marina confirmou a sessao de amanha as 14:00"

#### Scenario: Patient confirms an already confirmed session (duplicate)

- **WHEN** webhook receives a "Confirmar" reply for a session already in status "confirmed"
- **THEN** the duplicate is ignored (no status change, no duplicate notification)

#### Scenario: Patient confirms a session that is already done or no_show

- **WHEN** webhook receives a "Confirmar" reply for a session with status "done" or "no_show"
- **THEN** the reply is ignored (session has passed its lifecycle, per PRD edge case)

#### Scenario: Confirmation acknowledgment template is sent

- **WHEN** patient confirms and session status is updated
- **THEN** system enqueues `whatsapp.confirmation.ack` event which triggers sending `confirmacao_recebida` template with patient name, date, and time

#### Scenario: Confirmation after 24h since session start is ignored

- **WHEN** webhook receives a "Confirmar" reply for a session whose start_at was more than 24 hours ago
- **THEN** the reply is ignored (stale confirmation per PRD edge case "Paciente responde a botao depois de 24h")

### Requirement: Patient cancellation via WhatsApp button cancels session (RF-04.16)

The system SHALL process Quick Reply "Nao posso comparecer" button presses. When a patient presses this button, the system cancels the session (`status = 'cancelled'`, `cancelled_by = 'patient'`, `cancellation_reason = 'patient_cancelled'`), auto-calculates `cancellation_notice`, applies the cancellation charge rule from PRD 03 RF-03.15, emits `agenda/session.cancelled`, and notifies the psychologist immediately.

#### Scenario: Patient cancels a scheduled session

- **WHEN** webhook receives "Nao posso comparecer" for a session with status "scheduled"
- **THEN** session status changes to "cancelled", cancelled_by="patient", cancellation_reason="patient_cancelled", cancelled_at=NOW(), cancellation_notice is calculated based on time until session start

#### Scenario: Cancellation with less than 24h notice

- **WHEN** patient cancels a session starting in 5 hours via WhatsApp button
- **THEN** cancellation_notice is set to "less_24h" and charge_cancellation flag is evaluated per psychologist's cancellation policy

#### Scenario: Psychologist notified immediately on patient cancellation

- **WHEN** patient cancels via WhatsApp button
- **THEN** psychologist receives in-app notification "Marina cancelou a sessao de amanha as 14:00 via WhatsApp" with action link to the session

#### Scenario: Cancellation of already cancelled session is ignored

- **WHEN** webhook receives "Nao posso comparecer" for a session already cancelled
- **THEN** the duplicate is ignored

### Requirement: Cancellation notice sent when psychologist cancels a session

The system SHALL listen for `agenda/session.cancelled` events and, when `cancelled_by = 'therapist'`, send the `cancelamento_aviso` template to the patient via WhatsApp. The template includes patient name, date, time, and an optional reason message.

#### Scenario: Psychologist cancels session triggers WhatsApp notice

- **WHEN** psychologist cancels a session with patient "Marina" for 2026-05-16 14:00
- **THEN** system sends `cancelamento_aviso` template to Marina's phone with variables filled

#### Scenario: Cancellation notice not sent if patient opted out

- **WHEN** psychologist cancels a session but the patient has `whatsapp_opt_out = true`
- **THEN** no WhatsApp message is sent

#### Scenario: Cancellation notice not sent if patient cancelled (they know)

- **WHEN** session is cancelled with `cancelled_by = 'patient'`
- **THEN** no `cancelamento_aviso` is sent (the patient initiated the cancellation)

### Requirement: Psychologist receives in-app notification on WhatsApp interactions

The system SHALL notify the psychologist via in-app notification when: (a) patient confirms via WhatsApp, (b) patient cancels via WhatsApp, (c) patient opts out via PARAR, (d) a reminder fails after all retries. Notifications include a title (PT-BR), body, and an action URL linking to the relevant session or patient.

#### Scenario: Confirmation notification

- **WHEN** patient confirms session via WhatsApp button
- **THEN** notification: title "Sessao confirmada", body "[Nome] confirmou a sessao de [data] as [hora]", actionUrl "/app/agenda?session=[id]"

#### Scenario: Cancellation notification

- **WHEN** patient cancels session via WhatsApp button
- **THEN** notification: title "Sessao cancelada pelo paciente", body "[Nome] cancelou a sessao de [data] as [hora] via WhatsApp", actionUrl "/app/agenda?session=[id]"

#### Scenario: Failure notification

- **WHEN** reminder send fails after all retries
- **THEN** notification: title "Falha no envio de lembrete", body "Nao foi possivel enviar lembrete para [Nome]. Verifique a conexao WhatsApp.", actionUrl "/app/configuracoes/integracoes/whatsapp"
