# whatsapp-webhook-receiver Specification

## Purpose

Twilio WhatsApp webhook ingestion: signature validation, delivery status updates, interactive button reply routing, inbound text message persistence, and patient phone matching.

## Requirements

### Requirement: Route Handler validates Twilio HMAC signature (RNF-04.03)

The system SHALL expose a Route Handler at `POST /api/webhooks/twilio/whatsapp` that validates every incoming request using the `X-Twilio-Signature` header and the Twilio SDK's `validateRequest` function with `TWILIO_AUTH_TOKEN` from `serverEnv`. Invalid signatures are rejected with HTTP 403.

#### Scenario: Valid signature is accepted

- **WHEN** Twilio sends a webhook with a valid X-Twilio-Signature header
- **THEN** the handler processes the request and returns HTTP 200

#### Scenario: Invalid signature is rejected

- **WHEN** a request arrives with an invalid or missing X-Twilio-Signature header
- **THEN** the handler returns HTTP 403 without processing any business logic

#### Scenario: Missing auth token returns 500

- **WHEN** the TWILIO_AUTH_TOKEN env var is not configured
- **THEN** the handler returns HTTP 500 with a generic error (no secret leakage in response)

### Requirement: Webhook responds in less than 2 seconds (RNF-04.03)

The system SHALL keep the webhook handler's synchronous processing minimal: parse payload, validate signature, determine event type, send Inngest event, return 200. All business logic (DB updates, template sends, notifications) is offloaded to Inngest functions.

#### Scenario: Webhook response time under 2 seconds

- **WHEN** Twilio sends any webhook event
- **THEN** the handler responds with HTTP 200 within 2 seconds

#### Scenario: Handler sends Inngest event and returns immediately

- **WHEN** webhook receives a delivery status update
- **THEN** handler sends `whatsapp.status.updated` event to Inngest and returns 200 without waiting for DB update

### Requirement: Webhook processes delivery status updates

The system SHALL handle Twilio status callback events (`sent`, `delivered`, `read`, `failed`, `undelivered`) by emitting `whatsapp.status.updated` events to Inngest. The Inngest function updates `whatsapp_messages` by matching `bsp_message_id`.

#### Scenario: Delivered status updates message

- **WHEN** webhook receives status "delivered" for bsp_message_id "SM123"
- **THEN** Inngest function updates whatsapp_messages: status="delivered", delivered_at=NOW()

#### Scenario: Read status updates message

- **WHEN** webhook receives status "read" for bsp_message_id "SM123"
- **THEN** Inngest function updates whatsapp_messages: status="read", read_at=NOW()

#### Scenario: Failed status updates message

- **WHEN** webhook receives status "failed" for bsp_message_id "SM123" with error code
- **THEN** Inngest function updates whatsapp_messages: status="failed", error_reason=error description

#### Scenario: Status never regresses (monotonic)

- **WHEN** webhook receives status "sent" after the message already has status "delivered"
- **THEN** the status is NOT downgraded — "delivered" is preserved

### Requirement: Webhook processes interactive button replies

The system SHALL detect Quick Reply button payloads from Twilio's interactive message webhooks. The handler identifies the button text ("Confirmar" or "Nao posso comparecer"), looks up the session via the originating `whatsapp_messages.session_id`, and emits either `whatsapp.confirmation.received` or `whatsapp.cancellation.received` to Inngest.

#### Scenario: Confirmar button reply dispatched

- **WHEN** webhook receives a Quick Reply with body/button payload "Confirmar"
- **THEN** handler emits `whatsapp.confirmation.received` event with sessionId and patientId

#### Scenario: Nao posso comparecer button reply dispatched

- **WHEN** webhook receives a Quick Reply with body/button payload "Nao posso comparecer"
- **THEN** handler emits `whatsapp.cancellation.received` event with sessionId and patientId

#### Scenario: Unknown button payload is ignored

- **WHEN** webhook receives a Quick Reply with an unrecognized button payload
- **THEN** handler logs a warning and does not emit any event, returns 200

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

### Requirement: Webhook persists inbound text messages

The system SHALL persist any non-button inbound text message as a `whatsapp_messages` row with `direction = 'inbound'`. The `bsp_message_id` UNIQUE constraint prevents duplicate inserts.

#### Scenario: Inbound text message persisted

- **WHEN** webhook receives a free-text message from a patient
- **THEN** a whatsapp_messages row is created with direction="inbound", body=message text, bsp_message_id from Twilio

#### Scenario: Duplicate inbound message ignored

- **WHEN** webhook receives the same inbound message twice (same bsp_message_id)
- **THEN** the second insert is silently ignored (ON CONFLICT DO NOTHING on bsp_message_id)

#### Scenario: Inbound message linked to patient

- **WHEN** webhook receives a message from a phone number matching a patient's phone or reminder_phone
- **THEN** the whatsapp_messages row has patient_id set to the matched patient

### Requirement: Webhook identifies patient from phone number

The system SHALL look up the patient by matching the incoming phone number against `patients.phone` or `patients.reminder_phone` for the psychologist associated with the Twilio account's `from_phone`. If no patient matches, the message is still persisted with `patient_id = NULL`.

#### Scenario: Phone matches patient record

- **WHEN** webhook receives a message from +5511999887766 and a patient with that phone exists for the psychologist
- **THEN** patient_id is set on the whatsapp_messages row

#### Scenario: Phone matches reminder_phone (minor's guardian)

- **WHEN** webhook receives a message from +5511988776655 and a patient has reminder_phone="+5511988776655"
- **THEN** patient_id is set to that patient

#### Scenario: No patient match

- **WHEN** webhook receives a message from an unknown phone number
- **THEN** whatsapp_messages row is created with patient_id=NULL
