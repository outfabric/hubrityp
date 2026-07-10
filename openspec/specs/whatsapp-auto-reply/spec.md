## Requirements

### Requirement: Free-text inbound messages receive a fixed automated reply within the 24h window

The system SHALL reply to unstructured inbound WhatsApp messages (i.e., not a `Confirmar`/`Nao posso comparecer` button reply and not a `PARAR` command) with a single fixed, non-clinical free-text message, using `sendFreeText` (no template). The reply relies on the WhatsApp customer service window: the patient's inbound message opens a 24-hour window during which free-form business messages are permitted. The reply MUST be sent promptly (no long queueing) so it remains inside the open window, and MUST NOT be scheduled for a delayed time.

The fixed reply text MUST make clear this is an automated reminders-only channel and point the patient to an alternative contact, and MUST NOT contain PII or clinical content.

#### Scenario: Patient free text triggers the automated reply

- **WHEN** a patient sends free text (e.g., "Oi, posso remarcar?") to the platform number
- **THEN** the system sends one fixed free-text reply via `sendFreeText` from the platform number, informing the patient that this is an automated reminders channel

#### Scenario: Button replies and PARAR are excluded

- **WHEN** the inbound webhook payload is a `Confirmar`/`Nao posso comparecer` button reply, a `PARAR` command, or a delivery status callback
- **THEN** no automated free-text reply is sent; the existing confirmation/cancellation/stop/status handlers process the payload

#### Scenario: Reply is not routed to the inbox

- **WHEN** the automated reply flow handles a free-text inbound message
- **THEN** it does NOT emit the inbox ingestion event and does NOT create or update a `whatsapp_conversations` row

### Requirement: Automated reply is throttled to at most once per 24 hours per phone

The system SHALL send at most one automated reply to a given patient phone within any rolling 24-hour period, to prevent reply loops or spam when a patient sends multiple messages. The throttle decision MUST be derived from prior outbound auto-reply records in `whatsapp_messages`.

#### Scenario: Repeated inbound messages yield a single reply

- **WHEN** a patient sends three free-text messages within a few minutes
- **THEN** the system sends the automated reply only once and suppresses the subsequent replies

#### Scenario: Reply allowed again after the window elapses

- **WHEN** a patient sends free text more than 24 hours after the last automated reply to their phone
- **THEN** the system sends the automated reply again

### Requirement: Automated reply is recorded for audit without leaking PII in logs

The system SHALL persist the outbound automated reply as a `whatsapp_messages` row with `direction='outbound'` for auditability. Structured logs for this flow MUST NOT include the patient phone value, message body, or other PII; identifiers logged MUST be internal UUIDs or presence flags.

#### Scenario: Outbound auto-reply persisted

- **WHEN** an automated reply is sent
- **THEN** a `whatsapp_messages` row is created with `direction='outbound'` and enough metadata to support the 24h throttle check

#### Scenario: Logs contain no PII

- **WHEN** the auto-reply flow logs its outcome
- **THEN** the log entry contains no phone number, patient name, or message content — only internal identifiers and status
