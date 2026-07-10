## MODIFIED Requirements

### Requirement: Webhook handler dispatches Inngest event for inbound free-text messages

In the reminders-only MVP, the webhook handler SHALL NOT feed inbound free-text messages into the inbox ingestion pipeline. Instead, when an inbound payload is classified as free text (not a button reply, not `PARAR`, not a status callback), the handler SHALL trigger the fixed automated reply flow (see `whatsapp-auto-reply`). The inbox message-ingest pipeline (`whatsapp.message.persisted` → risk detection, conversation upsert, notification) is frozen for the MVP and MUST NOT be invoked for these messages. Triggering the auto-reply MUST NOT block returning HTTP 200 to Twilio.

#### Scenario: Inbound free-text message triggers the automated reply flow

- **WHEN** a patient sends a free-text WhatsApp message and the webhook classifies it as `inbound_text`
- **THEN** the handler triggers the automated reply flow and does NOT emit `whatsapp.message.persisted` to the inbox ingestion pipeline

#### Scenario: Button responses and PARAR do not trigger the auto-reply

- **WHEN** a patient clicks a template button (e.g., "Confirmar") or sends `PARAR`
- **THEN** the webhook processes it via the existing confirmation/cancellation/stop flow and does NOT trigger the automated reply

#### Scenario: Auto-reply trigger failure does not break webhook response

- **WHEN** triggering the automated reply flow fails (e.g., the queue is temporarily unavailable)
- **THEN** the webhook handler still returns HTTP 200 to Twilio and the failure is logged without PII for later reconciliation

### Requirement: Webhook persists inbound text messages

The system SHALL persist any non-button inbound text message as a `whatsapp_messages` row with `direction = 'inbound'` for auditability. The `bsp_message_id` UNIQUE constraint prevents duplicate inserts. In the MVP this persistence is for the audit trail and the 24h auto-reply throttle only; it MUST NOT create or update `whatsapp_conversations` (inbox) rows.

#### Scenario: Inbound text message persisted

- **WHEN** webhook receives a free-text message from a patient
- **THEN** a whatsapp_messages row is created with direction="inbound", body=message text, bsp_message_id from Twilio

#### Scenario: Duplicate inbound message ignored

- **WHEN** webhook receives the same inbound message twice (same bsp_message_id)
- **THEN** the second insert is silently ignored (ON CONFLICT DO NOTHING on bsp_message_id)

#### Scenario: Inbound persistence does not touch the inbox

- **WHEN** an inbound free-text message is persisted in the MVP
- **THEN** no `whatsapp_conversations` row is created or updated
