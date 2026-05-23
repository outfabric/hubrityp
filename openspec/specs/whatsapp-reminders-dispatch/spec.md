# whatsapp-reminders-dispatch Specification

## Purpose

Core reminder dispatch engine: reminder window computation, template variable selection, idempotency, the dispatcher cron that scans sessions and enqueues send events, the sender function that renders templates and calls Twilio, retry/backoff logic, the Twilio BSP adapter, message persistence and delivery tracking, and the reconciliation poller.

## Requirements

### Requirement: Reminder window is computed correctly for each session

The system SHALL provide a pure function `computeReminderWindow` that, given a session (startAt), reminder settings, current time, and timezone (`America/Sao_Paulo`), returns `{ earlyDueAt: Date|null, finalDueAt: Date|null, videoDueAt: Date|null }`. The function applies RN-04.03 (skip early reminder if session was created with less time than the early window) and the night-shift rule (defer to 07:00 if `send_during_night` is false and due time falls between 22:00-07:00).

#### Scenario: Standard 24h early + 2h final reminder

- **WHEN** session starts at 2026-05-16 14:00 BRT, settings are early=24, final=2, video=30
- **THEN** earlyDueAt = 2026-05-15 14:00 BRT, finalDueAt = 2026-05-16 12:00 BRT, videoDueAt = null (only for online sessions)

#### Scenario: Online session includes video link reminder

- **WHEN** session starts at 2026-05-16 14:00 BRT, modality is "online", settings video=30
- **THEN** videoDueAt = 2026-05-16 13:30 BRT

#### Scenario: Session created with less than early window skips early (RN-04.03)

- **WHEN** session starts in 12 hours, settings have early=24, session createdAt is 2 hours ago
- **THEN** earlyDueAt = null (skipped), finalDueAt is still calculated normally

#### Scenario: Night-shift defers to 07:00

- **WHEN** early reminder due at 2026-05-15 23:30 BRT and send_during_night=false
- **THEN** earlyDueAt is adjusted to 2026-05-16 07:00 BRT

#### Scenario: Night-shift defers early morning to 07:00

- **WHEN** final reminder due at 2026-05-16 05:00 BRT and send_during_night=false
- **THEN** finalDueAt is adjusted to 2026-05-16 07:00 BRT

#### Scenario: Night-shift disabled sends at original time

- **WHEN** reminder due at 23:30 and send_during_night=true
- **THEN** dueAt remains 23:30 (no adjustment)

#### Scenario: Session in the past returns all null

- **WHEN** session startAt is in the past relative to now
- **THEN** all due times are null

#### Scenario: Disabled reminder returns null for that type

- **WHEN** early_reminder_hours is null
- **THEN** earlyDueAt is null regardless of session time

### Requirement: Template variables are selected correctly per reminder kind

The system SHALL provide a pure function `selectTemplateVariables` that, given session, patient, psychologist, location, and kind (`early`, `final`, `video`, `cancelled`, `confirmed_ack`, `consent`), returns a `Record<string, string>` with the 12 PRD variables filled. Variables not applicable to a kind are omitted.

#### Scenario: Early reminder fills all standard variables

- **WHEN** kind is "early" for patient "Marina", session at 14:00, location "Consultorio Centro"
- **THEN** variables include nome_paciente="Marina", data="amanha", hora="14:00", endereco="Consultorio Centro, Rua X", nome_psicologo="Dra. Ana"

#### Scenario: Video kind includes link_video

- **WHEN** kind is "video" for an online session with video_link="https://meet.example.com/abc"
- **THEN** variables include link_video="https://meet.example.com/abc"

#### Scenario: In-person session omits link_video

- **WHEN** kind is "early" for an in_person session
- **THEN** variables do not include link_video

#### Scenario: Patient without address uses location name only

- **WHEN** location has name "Consultorio" but no address
- **THEN** endereco="Consultorio"

### Requirement: Video link template variable is populated from video_rooms

The `selectTemplateVariables` function SHALL populate the `link_video` variable by querying `video_rooms` for the session when the template kind involves a video link or the session modality is 'online'. If no room exists yet, `link_video` SHALL be an empty string.

#### Scenario: Video room exists for online session

- **WHEN** selectTemplateVariables is called for an online session with a video room
- **THEN** the `link_video` variable contains the patient video URL in the format `https://<domain>/v/<patient_token>`

#### Scenario: No video room exists yet

- **WHEN** selectTemplateVariables is called for an online session without a video room
- **THEN** the `link_video` variable is an empty string

### Requirement: Idempotency key is deterministic

The system SHALL generate idempotency keys using `sha256(sessionId + ":" + kind)`. The same session and kind always produce the same key. Different kinds for the same session produce different keys.

#### Scenario: Same session and kind produce same key

- **WHEN** idempotencyKey is computed for session "abc-123" kind "early" twice
- **THEN** both calls return the identical hash string

#### Scenario: Different kinds produce different keys

- **WHEN** idempotencyKey is computed for session "abc-123" kind "early" and kind "final"
- **THEN** the two keys are different

#### Scenario: Different sessions produce different keys

- **WHEN** idempotencyKey is computed for session "abc-123" kind "early" and session "def-456" kind "early"
- **THEN** the two keys are different

### Requirement: Dispatcher cron scans sessions and enqueues send events (RF-04.12)

The system SHALL run an Inngest cron function every 5 minutes (`*/5 * * * *`) that queries sessions with `status = 'scheduled'`, `reminders_disabled = false`, patient `whatsapp_opt_out = false`, and `whatsapp_accounts.status != 'error'`. For each session within a computed reminder window whose `dueAt` is <= now and no `whatsapp_messages` row exists with the same idempotency key and `status != 'failed'`, the dispatcher emits a `whatsapp.reminder.send` event.

#### Scenario: Session within early reminder window is dispatched

- **WHEN** dispatcher runs and a session starts in 23 hours (within 24h early window) with no existing message
- **THEN** dispatcher emits `whatsapp.reminder.send` event with kind="early" and the session's idempotency key

#### Scenario: Session already has a sent reminder is not re-dispatched

- **WHEN** dispatcher runs and a session has an existing `whatsapp_messages` row with the same idempotency key and status="delivered"
- **THEN** no event is emitted for that session (idempotency check)

#### Scenario: Patient opted out is skipped

- **WHEN** dispatcher runs and a session's patient has `whatsapp_opt_out = true`
- **THEN** no event is emitted for that patient's sessions

#### Scenario: Session with reminders_disabled is skipped

- **WHEN** dispatcher runs and a session has `reminders_disabled = true`
- **THEN** no event is emitted for that session

#### Scenario: WhatsApp account in error state skips all

- **WHEN** dispatcher runs and the psychologist's `whatsapp_accounts.status = 'error'`
- **THEN** no events are emitted for that psychologist's sessions

#### Scenario: Cancelled session is not dispatched (RN-04.01)

- **WHEN** dispatcher runs and a session has `status = 'cancelled'`
- **THEN** no event is emitted

#### Scenario: Confirmed session does not receive additional reminders (RN-04.01)

- **WHEN** dispatcher runs and a session has `status = 'confirmed'`
- **THEN** no event is emitted (already confirmed)

#### Scenario: Multiple sessions dispatched in parallel

- **WHEN** dispatcher finds 10 sessions needing reminders
- **THEN** 10 separate `whatsapp.reminder.send` events are emitted

### Requirement: Sender function renders template, calls Twilio, and persists message (RF-04.12)

The system SHALL run an Inngest function triggered by `whatsapp.reminder.send` events. The function: (1) checks idempotency in DB, (2) determines if consent footer is needed (first message to this patient), (3) selects template variables, (4) renders the template body, (5) calls the Twilio adapter, (6) persists a `whatsapp_messages` row with the `bsp_message_id`. Each step uses `step.run()` for durability.

#### Scenario: Successful send creates message record

- **WHEN** sender processes a `whatsapp.reminder.send` event for session X, kind "early"
- **THEN** Twilio adapter is called, `whatsapp_messages` row is created with status="sent", bsp_message_id from Twilio response, template_key="lembrete_24h", direction="outbound"

#### Scenario: Idempotency check prevents duplicate send

- **WHEN** sender processes an event but a `whatsapp_messages` row with the same idempotency key and status="delivered" already exists
- **THEN** the function short-circuits without calling Twilio

#### Scenario: First message to patient includes consent footer (RF-04.20)

- **WHEN** sender processes a reminder for a patient who has never received a WhatsApp message from this psychologist
- **THEN** the rendered body includes the consent footer text appended

#### Scenario: Subsequent messages omit consent footer

- **WHEN** sender processes a reminder for a patient who has previously received a WhatsApp message
- **THEN** the rendered body does not include the consent footer

### Requirement: Sender retries with backoff on BSP failure (RF-04.13)

The system SHALL configure the sender Inngest function with `retries: 3`. Step-level retries use exponential backoff (1 min, 5 min, 15 min). After 3 failed attempts, the message status is set to `failed` with `error_reason`, and the psychologist is notified via in-app notification.

#### Scenario: First retry after 1 minute

- **WHEN** Twilio adapter returns a transient error on the first attempt
- **THEN** Inngest retries after approximately 1 minute

#### Scenario: All retries exhausted marks as failed

- **WHEN** Twilio adapter fails on all 3 retry attempts
- **THEN** `whatsapp_messages.status` is set to "failed", `error_reason` is populated, and a notification is sent to the psychologist

#### Scenario: Invalid phone marks as unable_to_send (RF-04.14)

- **WHEN** Twilio adapter returns INVALID_PHONE error
- **THEN** message status is set to "unable_to_send" immediately (no retry), psychologist is notified

#### Scenario: Patient blocked marks as unable_to_send

- **WHEN** Twilio adapter returns BLOCKED_BY_USER error
- **THEN** message status is set to "unable_to_send" immediately (no retry), psychologist is notified

### Requirement: Twilio BSP adapter sends template messages with structured errors

The system SHALL provide an adapter `sendTemplate` in `src/modules/whatsapp/server/adapters/twilio-bsp.ts` that calls the Twilio Messages API to send a WhatsApp template message. The adapter maps Twilio error codes to typed errors: `INVALID_PHONE`, `BLOCKED_BY_USER`, `OPT_OUT`, `RATE_LIMIT`, `UNKNOWN`.

#### Scenario: Successful send returns bsp_message_id

- **WHEN** adapter sends a template to a valid phone
- **THEN** returns `{ bspMessageId: "SMxxxxxx", status: "sent" }`

#### Scenario: Invalid phone number returns typed error

- **WHEN** Twilio rejects with error code 21211 (invalid phone)
- **THEN** adapter throws `{ type: "INVALID_PHONE", twilioCode: 21211 }`

#### Scenario: Blocked by user returns typed error

- **WHEN** Twilio rejects with error code 21610 (user opted out of WhatsApp)
- **THEN** adapter throws `{ type: "BLOCKED_BY_USER", twilioCode: 21610 }`

### Requirement: whatsapp_messages table logs all messages with delivery tracking

The system SHALL store all outbound and inbound WhatsApp messages in `whatsapp_messages` with: id (UUID PK), user_id (FK, NOT NULL), patient_id (FK, nullable), session_id (FK, nullable), direction (`outbound`/`inbound`), to_phone, from_phone, body, template_key, bsp_message_id (UNIQUE for inbound dedup), idempotency_key (partial UNIQUE WHERE status != 'failed'), status enum (`queued`/`sent`/`delivered`/`read`/`failed`/`unable_to_send`), error_reason, sent_at, delivered_at, read_at, created_at. Indexes per PRD appendix A. RLS by `user_id = auth.uid()`.

#### Scenario: Outbound message row created on send

- **WHEN** the sender function successfully calls Twilio
- **THEN** a `whatsapp_messages` row is inserted with direction="outbound", status="sent", bsp_message_id from Twilio, sent_at=now()

#### Scenario: Inbound message row created on webhook

- **WHEN** webhook receives a patient text message
- **THEN** a `whatsapp_messages` row is inserted with direction="inbound", status=null, bsp_message_id from Twilio (UNIQUE prevents duplication)

#### Scenario: Status update via webhook advances message state

- **WHEN** Twilio webhook reports status "delivered" for bsp_message_id "SM123"
- **THEN** `whatsapp_messages` row with bsp_message_id="SM123" has status updated to "delivered" and delivered_at set

#### Scenario: RLS prevents cross-user access

- **WHEN** psychologist A queries whatsapp_messages
- **THEN** only rows with user_id = psychologist A are returned

### Requirement: Reconciliation poller catches stuck messages

The system SHALL run an Inngest cron function every 30 minutes (`*/30 * * * *`) that queries `whatsapp_messages` with `status IN ('queued', 'sent')` and `sent_at < NOW() - INTERVAL '5 minutes'`. For each, it polls the Twilio Messages API for current status and updates the DB row accordingly.

#### Scenario: Stuck "sent" message updated to "delivered"

- **WHEN** poller finds a message with status="sent" and sent_at 10 minutes ago, and Twilio reports it as "delivered"
- **THEN** the message row is updated to status="delivered" and delivered_at is set

#### Scenario: Stuck "queued" message updated to "failed"

- **WHEN** poller finds a message with status="queued" and sent_at 15 minutes ago, and Twilio reports it as "failed"
- **THEN** the message row is updated to status="failed" and error_reason is populated
