## MODIFIED Requirements

### Requirement: Webhook handler dispatches Inngest event for inbound free-text messages

The system SHALL dispatch an Inngest event `whatsapp.message.persisted` after persisting an inbound free-text message in `whatsapp_messages`. The event payload includes `messageId` (UUID of the persisted row), `userId` (psychologist UUID), and `patientId` (patient UUID). This event triggers the inbox message-ingest pipeline (risk detection, conversation upsert, notification) without blocking the webhook response.

#### Scenario: Inbound free-text message triggers event dispatch

- **WHEN** a patient sends a free-text WhatsApp message and the webhook handler persists it in `whatsapp_messages` with direction='inbound'
- **THEN** the handler dispatches an Inngest event `whatsapp.message.persisted` with `{ messageId, userId, patientId }` before returning the HTTP response

#### Scenario: Button responses do not trigger the event

- **WHEN** a patient clicks a template button (e.g., "Confirmar")
- **THEN** the webhook handler processes the button callback via the existing flow (change 2) and does NOT dispatch `whatsapp.message.persisted`

#### Scenario: Event dispatch failure does not break webhook response

- **WHEN** the Inngest event dispatch fails (e.g., Inngest is temporarily unavailable)
- **THEN** the webhook handler still returns HTTP 200 to Twilio (to prevent retries), and the event dispatch failure is logged for later reconciliation

### Requirement: Twilio adapter exposes sendFreeText method for session-window replies

The system SHALL extend the Twilio adapter (from change 2) with a `sendFreeText` method that sends a plain-text WhatsApp message to a patient's phone number. This method is used for replies within the 24-hour session window where templates are not required by Meta. The method returns the BSP message ID for status tracking.

#### Scenario: Send free-text message within session window

- **WHEN** `sendFreeText` is called with a valid phone number and body text
- **THEN** the message is sent via Twilio's Messages API (not the Content/Template API) and the BSP message ID is returned

#### Scenario: Send free-text message fails with Twilio error

- **WHEN** `sendFreeText` is called and Twilio returns an error (e.g., invalid phone)
- **THEN** the method throws a typed error with the Twilio error code and message for the caller to handle
