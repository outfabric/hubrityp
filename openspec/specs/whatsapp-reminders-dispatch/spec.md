# whatsapp-reminders-dispatch Specification

## Purpose

Core reminder dispatch engine: reminder window computation, the platform template contract (named `contentVariables`), idempotency, the dispatcher cron that scans sessions and enqueues send events, the sender function that calls Twilio with platform Content SIDs, retry/backoff logic, the Twilio BSP adapter, message persistence and delivery tracking, and the reconciliation poller.

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

The system SHALL run an Inngest cron function every 5 minutes (`*/5 * * * *`) that queries sessions with `status = 'scheduled'`, `reminders_disabled = false`, patient `whatsapp_opt_out = false`, and `whatsapp_accounts.status != 'error'`. For each session within a computed reminder window whose `dueAt` is <= now and no `whatsapp_messages` row exists with the same idempotency key and `status != 'failed'`, the dispatcher emits a `whatsapp.reminder.send` event. The event payload carries the platform Content SID resolved from `serverEnv` by `template_key` and the identity/timing data needed by the platform template contract (patient first/full name, psychologist display name, session start, modality, video link when applicable). The payload MUST NOT include a template body, confirmation link, session value, duration, or location fields.

#### Scenario: Session within early reminder window is dispatched

- **WHEN** dispatcher runs and a session starts in 23 hours (within 24h early window) with no existing message
- **THEN** dispatcher emits `whatsapp.reminder.send` event with kind="early", the session's idempotency key, and `contentSid` = `serverEnv.TWILIO_CONTENT_SID_LEMBRETE_24H`

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

#### Scenario: Event payload has no template body or confirmation link

- **WHEN** any `whatsapp.reminder.send` event is emitted
- **THEN** the payload contains no `templateBody`, `confirmationLink`, `sessionValue`, location, or duration fields

### Requirement: Sender function renders template, calls Twilio, and persists message (RF-04.12)

The system SHALL run an Inngest function triggered by `whatsapp.reminder.send` events. The function: (1) checks idempotency in DB, (2) builds named `contentVariables` via the platform template contract, (3) calls the Twilio adapter with the Content SID and the JSON-encoded variables, (4) persists a `whatsapp_messages` row with the `bsp_message_id`, `template_key`, and `body = NULL` (LGPD data minimization — the delivered text lives in the Meta-approved template). The LGPD consent footer applies only to free-form outbound messages: template content is pre-approved and immutable, so no footer is appended to template sends (any required disclosure text is part of the registered template copy). Each step uses `step.run()` for durability.

#### Scenario: Successful send creates message record with NULL body

- **WHEN** sender processes a `whatsapp.reminder.send` event for session X, kind "early"
- **THEN** Twilio adapter is called with `contentSid` and named `contentVariables`, and a `whatsapp_messages` row is created with status="sent", bsp_message_id from Twilio, template_key="lembrete_24h", direction="outbound", body=NULL

#### Scenario: Idempotency check prevents duplicate send

- **WHEN** sender processes an event but a `whatsapp_messages` row with the same idempotency key and status="delivered" already exists
- **THEN** the function short-circuits without calling Twilio

#### Scenario: No consent footer is appended to template sends

- **WHEN** sender processes the first-ever outbound message for a patient as a template send
- **THEN** no footer text is appended (the Content template body is immutable); the consent footer rule applies only to free-form sends

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

The system SHALL provide an adapter `sendTemplate` in `src/modules/whatsapp/server/adapters/twilio-bsp.ts` that calls the Twilio Messages API with `contentSid` and `contentVariables` serialized as a JSON string of named key→value pairs (`JSON.stringify`). The adapter MUST NOT send a `body` parameter alongside `contentSid`. The adapter maps Twilio error codes to typed errors: `INVALID_PHONE`, `BLOCKED_BY_USER`, `OPT_OUT`, `RATE_LIMIT`, `UNKNOWN`.

#### Scenario: Successful send returns bsp_message_id

- **WHEN** adapter sends a template to a valid phone
- **THEN** returns `{ bspMessageId: "SMxxxxxx", status: "sent" }` and the request carried `contentSid` and `contentVariables` as a JSON string with named keys

#### Scenario: Invalid phone number returns typed error

- **WHEN** Twilio rejects with error code 21211 (invalid phone)
- **THEN** adapter throws `{ type: "INVALID_PHONE", twilioCode: 21211 }`

#### Scenario: Blocked by user returns typed error

- **WHEN** Twilio rejects with error code 21610 (user opted out of WhatsApp)
- **THEN** adapter throws `{ type: "BLOCKED_BY_USER", twilioCode: 21610 }`

### Requirement: whatsapp_messages table logs all messages with delivery tracking

The system SHALL store all outbound and inbound WhatsApp messages in `whatsapp_messages` with: id (UUID PK), user_id (FK, NOT NULL), patient_id (FK, nullable), session_id (FK, nullable), direction (`outbound`/`inbound`), to_phone, from_phone, body (nullable — NULL for outbound template sends; populated for inbound and free-form outbound), template_key, bsp_message_id (UNIQUE for inbound dedup), idempotency_key (partial UNIQUE WHERE status != 'failed'), status enum (`queued`/`sent`/`delivered`/`read`/`failed`/`unable_to_send`), error_reason, sent_at, delivered_at, read_at, created_at. Indexes per PRD appendix A. RLS by `user_id = auth.uid()`.

#### Scenario: Outbound template message row created with NULL body

- **WHEN** the sender function successfully sends a template via Twilio
- **THEN** a `whatsapp_messages` row is inserted with direction="outbound", status="sent", bsp_message_id from Twilio, sent_at=now(), template_key set, and body=NULL

#### Scenario: Outbound free-form message row keeps its body

- **WHEN** a free-form outbound message is sent (inbox reply or confirmation ack)
- **THEN** the row's body contains the actual delivered text

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

### Requirement: Reminder sends use the platform template contract with named variables

The system SHALL provide a module `platform-template-contract` exposing `buildContentVariables(templateKey, ctx)` that returns the named `contentVariables` for each platform Content template, exactly matching the variables registered in the shared Twilio WABA:

| template_key | named variables (exactly, no more, no fewer) |
|---|---|
| `lembrete_24h` | `first_name`, `professional_name`, `date`, `time` |
| `lembrete_2h` | `first_name`, `professional_name`, `time` |
| `link_video` | `first_name`, `professional_name`, `date`, `time`, `session_link` |
| `cancelamento_aviso` | `first_name`, `professional_name`, `date`, `time` |

`first_name` is the patient's first name, `professional_name` is the psychologist's display name, `date` is formatted `dd/MM/yyyy` and `time` is formatted `HH:mm`, both in `America/Sao_Paulo`. The builder MUST throw when any resolved value is empty and MUST strip newline characters from values (Twilio error 92007 rules). The builder MUST NOT emit keys outside the template's declared set (Twilio error 63028).

#### Scenario: lembrete_24h variables built with named keys and BRT formats

- **WHEN** `buildContentVariables('lembrete_24h', ctx)` is called for patient "Marina Souza", psychologist "Dra. Ana", session at 2026-07-16 14:00 BRT
- **THEN** it returns exactly `{ first_name: "Marina", professional_name: "Dra. Ana", date: "16/07/2026", time: "14:00" }`

#### Scenario: lembrete_2h omits date

- **WHEN** `buildContentVariables('lembrete_2h', ctx)` is called
- **THEN** the result has exactly the keys `first_name`, `professional_name`, `time` — no `date` key

#### Scenario: link_video includes session_link

- **WHEN** `buildContentVariables('link_video', ctx)` is called with a resolved video URL
- **THEN** the result includes `session_link` set to the patient video URL alongside `first_name`, `professional_name`, `date`, `time`

#### Scenario: Empty variable value throws

- **WHEN** any resolved variable value is an empty string (e.g. missing session_link)
- **THEN** the builder throws an error naming the missing variable instead of emitting an empty value

#### Scenario: Newlines are stripped from values

- **WHEN** a resolved value contains a newline character
- **THEN** the emitted value has newlines replaced by spaces

### Requirement: Content SIDs are resolved from the environment at dispatch time

The dispatcher SHALL resolve the Content SID for each reminder kind directly from `serverEnv` (`TWILIO_CONTENT_SID_LEMBRETE_24H`, `TWILIO_CONTENT_SID_LEMBRETE_2H`, `TWILIO_CONTENT_SID_LINK_VIDEO`) by `template_key`. The send path MUST NOT read `message_templates` (no body fetch, no per-psychologist SID lookup).

#### Scenario: Dispatch does not query message_templates

- **WHEN** the dispatcher emits a `whatsapp/reminder.send` event
- **THEN** the event carries the platform Content SID from env and no template body, and no query against `message_templates` occurred in the send path

#### Scenario: Seeded template rows do not affect sends

- **WHEN** a psychologist's `message_templates` rows are missing or have divergent `meta_template_id` values
- **THEN** reminder sends still use the env Content SIDs and succeed

### Requirement: Video link reminder is skipped when the session link is unavailable

When a `video` reminder is due for an online session but no patient video URL can be resolved (no `video_rooms` row yet, or `APP_URL` unset), the dispatcher SHALL skip emitting the event for that cron tick and log a structured warning (`event: 'video_link_unavailable'`, session UUID only — no PII). Because no `whatsapp_messages` row is created, the next 5-minute tick retries naturally.

#### Scenario: Missing video room skips the send this tick

- **WHEN** the video reminder for an online session is due and `video_rooms` has no row for the session
- **THEN** no `whatsapp/reminder.send` event is emitted for that session/kind, a warning is logged with the session id only, and no idempotency record is created

#### Scenario: Room created later is picked up on a subsequent tick

- **WHEN** the video room exists on a later dispatcher run and the reminder is still due
- **THEN** the event is emitted normally on that run
