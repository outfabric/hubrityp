## MODIFIED Requirements

### Requirement: Twilio BSP adapter sends template messages with structured errors

The system SHALL provide an adapter `sendTemplate` in `src/modules/whatsapp/server/adapters/twilio-bsp.ts` that calls the Twilio Messages API with `contentSid` and `contentVariables` serialized as a JSON string of named key→value pairs (`JSON.stringify`). The adapter MUST NOT send a `body` parameter alongside `contentSid`. Before addressing the message, the adapter SHALL normalize the destination number to E.164 (`+` followed by 7–15 digits, first digit non-zero) via a pure helper, so a number stored in the canonical masked format `+55 DD NNNNN-NNNN` (with spaces and a hyphen) is converted to `+55DDNNNNNNNNN` prior to building the `whatsapp:` address. Normalization SHALL be idempotent for input that is already E.164. When the destination number cannot be normalized to a structurally valid E.164 string, the adapter SHALL return the typed `INVALID_PHONE` error WITHOUT calling the Twilio Messages API. The same normalization SHALL apply to the free-text send path (`sendFreeText`). The adapter maps Twilio error codes to typed errors: `INVALID_PHONE`, `BLOCKED_BY_USER`, `OPT_OUT`, `RATE_LIMIT`, `UNKNOWN`.

#### Scenario: Successful send returns bsp_message_id

- **WHEN** adapter sends a template to a valid phone
- **THEN** returns `{ bspMessageId: "SMxxxxxx", status: "sent" }` and the request carried `contentSid` and `contentVariables` as a JSON string with named keys

#### Scenario: Masked Brazilian number is normalized to E.164 before send

- **WHEN** adapter is called with a `to` in the canonical masked format `+55 86 99578-3867`
- **THEN** the Twilio Messages API receives `to: "whatsapp:+5586995783867"` (spaces and hyphen removed, single leading `+`)

#### Scenario: Already-E.164 number is sent unchanged (idempotent)

- **WHEN** adapter is called with a `to` that is already E.164 (`+5586995783867`)
- **THEN** the Twilio Messages API receives `to: "whatsapp:+5586995783867"` unchanged

#### Scenario: Un-normalizable number short-circuits to INVALID_PHONE without calling Twilio

- **WHEN** adapter is called with a `to` that cannot be normalized to a valid E.164 number (e.g. too few digits)
- **THEN** the adapter returns the typed `INVALID_PHONE` error AND the Twilio Messages API is never called

#### Scenario: Invalid phone number returns typed error

- **WHEN** Twilio rejects with error code 21211 (invalid phone)
- **THEN** adapter throws `{ type: "INVALID_PHONE", twilioCode: 21211 }`

#### Scenario: Blocked by user returns typed error

- **WHEN** Twilio rejects with error code 21610 (user opted out of WhatsApp)
- **THEN** adapter throws `{ type: "BLOCKED_BY_USER", twilioCode: 21610 }`
