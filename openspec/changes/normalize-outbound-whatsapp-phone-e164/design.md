## Context

The Twilio Messages API requires the `To` number in **E.164** (`+` followed by digits only, no spaces/punctuation). The HubrityP data layer stores patient numbers in two inconsistent formats:

- `patients.phone` (primary) — canonical **masked** format `+55 DD NNNNN-NNNN`, enforced by `isValidBrazilianPhone` (`/^\+55 \d{2} 9\d{4}-\d{4}$/`) and produced by `maskPhone` for display.
- `patients.reminder_phone` (alternative) — **E.164**, enforced by `phoneNumberSchema` (`/^\+[1-9]\d{6,14}$/`).

The dispatcher resolves the outbound number as `reminder_phone ?? phone` (`fetchPatientData` in `reminders-dispatcher.ts`) and passes it verbatim through the `whatsapp/reminder.send` event to the adapter, which sends `to: whatsapp:${to}`. When `reminder_phone` is null (the common case) the masked `phone` reaches Twilio and is rejected with `21211 INVALID_PHONE` — reproduced in production with `whatsapp:+55 86 99578-3867`.

Constraint: this is a production incident fix. It must be minimal, reversible, and must not change how numbers are stored or displayed.

## Goals / Non-Goals

**Goals:**
- Every outbound WhatsApp send addresses Twilio with an E.164 number, regardless of which column supplied it.
- Cover all outbound paths (reminder template, free-text auto-reply, confirmation ack) with a single change.
- Fail fast with the existing typed `INVALID_PHONE` error when a number cannot be normalized — no wasted Twilio round-trip, no unhandled throw.

**Non-Goals:**
- Consolidating the two storage formats (`patients.phone` masked vs. `patients.reminder_phone` E.164) into one — tracked separately.
- International (non-`+55`) numbers — the platform is BR-only today.
- Any database migration or change to input validation / masking on the patient form.

## Decisions

### D1 — Normalize at the adapter boundary, not at the DB read

Place the normalization inside `twilio-bsp.ts` (`sendTemplate` and `sendFreeText`), right before `to: \`whatsapp:${to}\``.

- **Why**: the adapter is the single choke point through which *every* outbound message passes. Normalizing here guarantees coverage of the reminder path, the free-text auto-reply, and the confirmation ack in one edit, and keeps the invariant ("Twilio always receives E.164") local to the code that talks to Twilio.
- **Alternative considered — normalize in `fetchPatientData`**: rejected. It only fixes the reminder dispatcher; the free-text/ack senders resolve numbers by other routes and would remain vulnerable. It also spreads the E.164 invariant across callers instead of enforcing it at the boundary.

### D2 — Pure `toE164` helper, colocated with the existing phone schema

Add `toE164(raw: string): string | null` — strips every non-digit, re-prefixes `+`, and returns the result only if it satisfies the E.164 shape (`/^\+[1-9]\d{6,14}$/`, the same regex `phoneNumberSchema` already uses); otherwise `null`.

- **Why a pure helper**: trivially unit-testable, no I/O, reusable. Idempotent for already-E.164 input (`+5586995783867 → +5586995783867`), and correct for the masked format (`+55 86 99578-3867 → +5586995783867`).
- **Why return `null` (not throw)**: lets the adapter map the failure to the existing typed `INVALID_PHONE` result shape rather than surfacing an untyped exception up the Inngest stack.
- **Location**: `src/modules/whatsapp/lib/phone-number-e164.ts`, alongside `phone-number-schema.ts`, reusing the same regex constant as the single source of truth for "valid E.164".

### D3 — Un-normalizable input short-circuits to `INVALID_PHONE`

When `toE164` returns `null`, the adapter returns `{ ok: false, error: { code: 'INVALID_PHONE', twilioCode: undefined, message: ... } }` **without** calling Twilio.

- **Why**: `INVALID_PHONE` is already a non-retriable code (`NON_RETRIABLE_ERROR_CODES` in `reminder-sender.ts`), so a malformed number is recorded as `unable_to_send` and never retried — the correct terminal state. Avoids a guaranteed-failure BSP call and keeps behavior identical to Twilio's own `21211` from the sender's point of view.

## Risks / Trade-offs

- **[A number that is neither masked-BR nor E.164 slips through as digits]** → `toE164` re-validates against the E.164 regex after stripping, so garbage (too short/too long, leading zero) returns `null` and is rejected locally rather than sent. Mitigated by D2/D3.
- **[Double `+` or `whatsapp:` prefix already present in the stored value]** → stripping non-digits removes any stray `+`/letters before re-prefixing exactly one `+`; the `whatsapp:` scheme is added by the adapter *after* normalization, so it can't be doubled. Covered by a unit test.
- **[Silent behavior change for existing E.164 `reminder_phone` users]** → none: `toE164` is idempotent for valid E.164, so those sends are byte-identical to today. Covered by an idempotency unit test.
- **[Root cause — two storage formats — remains]** → this fix makes the boundary tolerant; it does not unify storage. Accepted for an incident fix; the divergence is called out as out-of-scope follow-up in the proposal.

## Migration Plan

Pure code change — no migration, no data backfill. Deploy the adapter change; on the next 5-minute dispatcher tick, previously-failing reminders for patients without a `reminder_phone` begin sending. Rollback is a straight revert (numbers stored unchanged, so no cleanup).
