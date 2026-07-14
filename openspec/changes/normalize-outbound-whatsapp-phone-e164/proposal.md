## Why

Outbound WhatsApp reminders fail with Twilio error `21211` (`INVALID_PHONE`) whenever the recipient number comes from `patients.phone`, because that column is stored in the human-readable canonical format `+55 DD NNNNN-NNNN` (with spaces and a hyphen) while the Twilio Messages API requires E.164 (`+` followed by digits only). The dispatcher falls back to `patients.phone` whenever `patients.reminder_phone` is empty (the common case), so every patient without an explicit reminder phone silently never receives reminders — reproduced in production with `whatsapp:+55 86 99578-3867`.

## What Changes

- Add a pure `toE164(phone)` normalization helper for Brazilian outbound numbers (strip non-digits, re-add the leading `+`), idempotent for already-E.164 input.
- Normalize the `to` number to E.164 at the single choke point in the Twilio adapter (`twilio-bsp.ts`), inside **both** `sendTemplate` and `sendFreeText`, immediately before building `whatsapp:${to}` — so every outbound path (reminder templates, free-text auto-reply, confirmation ack) is covered regardless of which column supplied the number.
- Reject a number that cannot be normalized to a structurally valid E.164 string with the existing typed `INVALID_PHONE` error, without calling Twilio (fail fast, no wasted BSP round-trip).
- No database migration and no change to how numbers are *stored* or *displayed* — normalization happens only at the boundary to Twilio. (Unifying the two storage formats is explicitly out of scope for this fix.)

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `whatsapp-reminders-dispatch`: the Twilio BSP adapter requirement gains an explicit obligation to normalize the destination number to E.164 before calling the Messages API, and to return the typed `INVALID_PHONE` error (without hitting Twilio) when the input cannot be normalized to a valid E.164 number.

## Impact

- **Code**: `src/modules/whatsapp/server/adapters/twilio-bsp.ts` (`sendTemplate`, `sendFreeText`); new helper `src/modules/whatsapp/lib/phone-number-e164.ts` (or colocated with the existing `phone-number-schema.ts`).
- **Behavior**: patients whose only number lives in `patients.phone` start receiving reminders; no user-visible change for patients who already had an E.164 `reminder_phone`.
- **Data**: none — no schema/migration change; stored formats untouched.
- **Tests**: unit coverage for the normalizer; unit/integration coverage for the adapter proving the `to` sent to Twilio is E.164 and that un-normalizable input short-circuits to `INVALID_PHONE`. See `tasks.md`.
- **Out of scope**: consolidating `patients.phone` (masked) and `patients.reminder_phone` (E.164) into a single stored format; international (non-`+55`) numbers.
