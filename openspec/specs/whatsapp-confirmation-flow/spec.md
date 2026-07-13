# whatsapp-confirmation-flow Specification

## Purpose

Patient confirmation and cancellation via WhatsApp interactive buttons, cancellation notices from psychologist-initiated cancellations, and in-app notifications for WhatsApp interactions.

## Requirements

### Requirement: Patient confirmation via WhatsApp button updates session status (RF-04.15)

The system SHALL process quick-reply button presses identified by `ButtonPayload = 'confirm'` (the button ID registered in the `lembrete_24h` Content template) received via Twilio webhook. When a patient presses the confirm button, the system sets `sessions.status = 'confirmed'` and `sessions.confirmed_at = NOW()`, emits an `agenda/session.confirmed` event, sends the free-form confirmation acknowledgment, and notifies the psychologist in-app.

#### Scenario: Patient confirms a scheduled session

- **WHEN** webhook receives a quick-reply with `ButtonPayload = 'confirm'` for a session with status "scheduled"
- **THEN** session status changes to "confirmed", confirmed_at is set, the free-form acknowledgment is sent, and psychologist receives in-app notification "Marina confirmou a sessao de amanha as 14:00"

#### Scenario: Patient confirms an already confirmed session (duplicate)

- **WHEN** webhook receives a `ButtonPayload = 'confirm'` reply for a session already in status "confirmed"
- **THEN** the duplicate is ignored (no status change, no duplicate notification) — the first click acts, subsequent clicks are no-ops

#### Scenario: Patient confirms a session that is already done or no_show

- **WHEN** webhook receives a `ButtonPayload = 'confirm'` reply for a session with status "done" or "no_show"
- **THEN** the reply is ignored (session has passed its lifecycle, per PRD edge case)

#### Scenario: Confirmation acknowledgment is enqueued

- **WHEN** patient confirms and session status is updated
- **THEN** system enqueues the `whatsapp.confirmation.ack` event which triggers the free-form acknowledgment message

#### Scenario: Confirmation after 24h since session start is ignored

- **WHEN** webhook receives a `ButtonPayload = 'confirm'` reply for a session whose start_at was more than 24 hours ago
- **THEN** the reply is ignored (stale confirmation per PRD edge case "Paciente responde a botao depois de 24h")

### Requirement: Patient cancellation via WhatsApp button cancels session (RF-04.16)

The system SHALL process quick-reply button presses identified by `ButtonPayload = 'cancel'` (the button ID registered in the `lembrete_24h` Content template). When a patient presses the cancel button, the system cancels the session (`status = 'cancelled'`, `cancelled_by = 'patient'`, `cancellation_reason = 'patient_cancelled'`), auto-calculates `cancellation_notice`, applies the cancellation charge rule from PRD 03 RF-03.15, emits `agenda/session.cancelled`, and notifies the psychologist immediately.

#### Scenario: Patient cancels a scheduled session

- **WHEN** webhook receives `ButtonPayload = 'cancel'` for a session with status "scheduled"
- **THEN** session status changes to "cancelled", cancelled_by="patient", cancellation_reason="patient_cancelled", cancelled_at=NOW(), cancellation_notice is calculated based on time until session start

#### Scenario: Cancellation with less than 24h notice

- **WHEN** patient cancels a session starting in 5 hours via the WhatsApp cancel button
- **THEN** cancellation_notice is set to "less_24h" and charge_cancellation flag is evaluated per psychologist's cancellation policy

#### Scenario: Psychologist notified immediately on patient cancellation

- **WHEN** patient cancels via the WhatsApp cancel button
- **THEN** psychologist receives in-app notification "Marina cancelou a sessao de amanha as 14:00 via WhatsApp" with action link to the session

#### Scenario: Cancellation of already cancelled session is ignored

- **WHEN** webhook receives `ButtonPayload = 'cancel'` for a session already cancelled
- **THEN** the duplicate is ignored — the first click acts, subsequent clicks are no-ops

### Requirement: Cancellation notice sent when psychologist cancels a session

The system SHALL listen for `agenda/session.cancelled` events and, when `cancelled_by = 'therapist'`, send the `cancelamento_aviso` platform Content template to the patient via WhatsApp, with named variables `first_name`, `professional_name`, `date` (dd/MM/yyyy), `time` (HH:mm, America/Sao_Paulo) built by the platform template contract. The Content SID comes from `serverEnv.TWILIO_CONTENT_SID_CANCELAMENTO_AVISO`; the persisted `whatsapp_messages` row has `body = NULL` and `template_key = 'cancelamento_aviso'`. The template carries no free-text reason field.

#### Scenario: Psychologist cancels session triggers WhatsApp notice

- **WHEN** psychologist cancels a session with patient "Marina" for 2026-07-16 14:00
- **THEN** system sends the `cancelamento_aviso` template with `{ first_name: "Marina", professional_name: <display name>, date: "16/07/2026", time: "14:00" }` and records the message with body=NULL

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

### Requirement: Confirmation acknowledgment is sent as a free-form message

The system SHALL send the confirmation acknowledgment as a free-form WhatsApp message via the `sendFreeText` adapter — never as a paid Meta template. The ack only fires after an inbound quick-reply from the patient, so the 24h customer-service window is guaranteed open. The body is a fixed code constant (PT-BR): `Obrigado, {first_name}! Sua presença na sessão com {professional_name} está confirmada.` rendered with the patient's first name and the psychologist's display name. The LGPD consent footer is appended when this is the first outbound message to the patient. The persisted `whatsapp_messages` row keeps `body` = the actual sent text (free-form → faithful record), `template_key = NULL`, and the idempotency key `sha256(sessionId + ":confirmed_ack")`.

#### Scenario: Ack sent free-form after confirmation

- **WHEN** a patient confirms via quick-reply and the `whatsapp/confirmation.ack` event is processed
- **THEN** the message is sent via `sendFreeText` (no `contentSid`), and the `whatsapp_messages` row has direction="outbound", template_key=NULL, and body equal to the rendered constant text

#### Scenario: Ack does not read message_templates

- **WHEN** the ack sender runs for a psychologist whose `message_templates` rows are missing entirely
- **THEN** the ack is still sent successfully (body is a code constant)

#### Scenario: Duplicate ack is prevented by idempotency

- **WHEN** the ack event is retried for a session that already has a non-failed `confirmed_ack` message row
- **THEN** no second message is sent

#### Scenario: First outbound message carries the consent footer

- **WHEN** the ack is the first outbound WhatsApp message ever sent to this patient by this psychologist
- **THEN** the consent footer is appended to the free-form body
