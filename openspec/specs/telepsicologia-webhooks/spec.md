# telepsicologia-webhooks Specification

## Purpose

Stream.io video webhook receiver: signature validation, call state reconciliation (room status, participant logs, recording status updates), and idempotent event processing.

## Requirements

### Requirement: Stream webhooks are validated via signature before processing
The Route Handler at `POST /api/webhooks/stream/video` SHALL validate the webhook signature using `STREAM_WEBHOOK_SECRET` and `crypto.timingSafeEqual`. Invalid signatures SHALL be rejected with 403.

#### Scenario: Valid signature is accepted
- **WHEN** a webhook with a valid signature is received
- **THEN** the event is processed and 200 is returned

#### Scenario: Invalid signature is rejected
- **WHEN** a webhook with an invalid signature is received
- **THEN** 403 is returned and no processing occurs

### Requirement: Webhook reconciles call state with database
The handler SHALL process Stream call events: call.session_ended updates room status to 'ended', participant events insert video_session_logs entries, recording events update video_recordings status. Duplicate events SHALL be handled idempotently.

#### Scenario: Call ended webhook updates room
- **WHEN** a call.session_ended event is received for an active room
- **THEN** the video_rooms status is set to 'ended' and a log entry is inserted

#### Scenario: Participant joined webhook logs event
- **WHEN** a call.session_participant_joined event is received
- **THEN** a video_session_logs entry is inserted with the participant details

#### Scenario: Duplicate webhook is idempotent
- **WHEN** the same call.session_ended event is received twice
- **THEN** the second processing is a no-op (room already ended)
