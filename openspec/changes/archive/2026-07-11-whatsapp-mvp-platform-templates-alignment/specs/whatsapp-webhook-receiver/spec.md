# whatsapp-webhook-receiver — Delta

## MODIFIED Requirements

### Requirement: Webhook processes interactive button replies

The system SHALL classify quick-reply button presses by the `ButtonPayload` webhook parameter — the button ID defined in the Content Template Builder (`confirm` and `cancel` on the `lembrete_24h` template) — never by the button label text (`ButtonText`), which is display copy and may change or contain accents. The handler looks up the session via the originating `whatsapp_messages.session_id` (through `OriginalRepliedMessageSid`) and emits either `whatsapp.confirmation.received` or `whatsapp.cancellation.received` to Inngest. A payload with an unrecognized `ButtonPayload` value falls through to the `inbound_text` classification (safe default: no state mutation).

#### Scenario: confirm button ID dispatched

- **WHEN** webhook receives a quick-reply with `ButtonPayload = "confirm"`
- **THEN** handler emits `whatsapp.confirmation.received` event with sessionId and patientId

#### Scenario: cancel button ID dispatched

- **WHEN** webhook receives a quick-reply with `ButtonPayload = "cancel"`
- **THEN** handler emits `whatsapp.cancellation.received` event with sessionId and patientId

#### Scenario: Button label text is never load-bearing

- **WHEN** webhook receives a quick-reply with `ButtonPayload = "confirm"` and any `ButtonText` value (e.g. a re-worded label "Sim, confirmo")
- **THEN** handler still emits `whatsapp.confirmation.received` — classification ignores `ButtonText`

#### Scenario: Unknown button payload falls through to inbound text

- **WHEN** webhook receives a quick-reply with an unrecognized `ButtonPayload` (e.g. "reschedule")
- **THEN** handler classifies it as `inbound_text` (auto-reply flow), mutates no session state, and returns 200
