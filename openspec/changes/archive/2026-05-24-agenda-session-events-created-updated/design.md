## Context

The agenda module owns session CRUD operations (`createSessionImpl`, `updateSessionImpl`). These Server Actions commit session data to Postgres but do not emit Inngest events afterward. The telepsicologia module's `auto-create-room` Inngest function already registers triggers for `agenda/session.created` and `agenda/session.updated` to auto-provision Stream.io video rooms for online sessions. The event schemas (`sessionCreatedEventSchema`, `sessionUpdatedEventSchema`) and their TypeScript types already exist in `src/modules/agenda/lib/session-events.ts`. The shared Inngest client singleton lives in `src/modules/whatsapp/inngest/client.ts` (`new Inngest({ id: 'hubrityp' })`).

## Goals / Non-Goals

**Goals:**

- Wire `inngest.send()` for `agenda/session.created` after successful session creation.
- Wire `inngest.send()` for `agenda/session.updated` after successful session update, including `previousModality` to enable online/in_person transition detection.
- Create `src/modules/agenda/inngest/client.ts` re-export so the agenda module has its own import path (module isolation convention).
- Add missing `sessionCreatedEventSchema` / `sessionUpdatedEventSchema` exports to the agenda barrel.
- Ensure event emission failures do not break the user-facing operation (fire-and-forget).

**Non-Goals:**

- Wiring lifecycle events (`session.confirmed`, `session.cancelled`, `session.done`, `session.no_show`, `session.rescheduled`, `session.missing_note_reminder`) — covered by a separate change.
- Creating new Inngest consumer functions — the existing `auto-create-room` consumer is already implemented.
- Modifying event schemas — they are already defined and correct.
- Frontend changes — event emission is invisible to the UI.
- Database schema or migration changes — no new tables or columns needed.

## Decisions

### Decision 1: Fire-and-forget with error logging

**Choice:** Wrap `inngest.send()` in a try/catch. On failure, log the error and let the operation succeed.

**Rationale:** The session has already been committed to the database. Failing the user operation because of an Inngest SDK issue (network timeout, Inngest downtime) would be worse than a missing downstream side-effect. The downstream consumer is idempotent (room creation checks for existing rooms). Logged errors give observability for incident response.

**Alternative considered:** Making `inngest.send()` part of the transaction. Rejected because: (a) Inngest is an external HTTP call and should never run inside a database transaction (blocks the connection); (b) if the transaction rolls back after a successful send, we get a phantom event with no matching session.

### Decision 2: Zod validation of outbound payload

**Choice:** Call `schema.parse(payload)` before `inngest.send()`.

**Rationale:** The event schemas are already the contract between producer and consumer. Validating at the producer side catches shape mismatches immediately (at the Server Action that emitted it), rather than surfacing as runtime errors inside the Inngest function handler. If validation fails, it is caught by the same try/catch and logged — the user operation still succeeds.

### Decision 3: Inngest client re-export per module

**Choice:** Create `src/modules/agenda/inngest/client.ts` that re-exports from `@/modules/whatsapp/inngest/client`.

**Rationale:** Follows the exact pattern of `src/modules/telepsicologia/inngest/client.ts`. Keeps imports self-contained within each module — agenda imports from `@/modules/agenda/inngest/client`, not from a sibling module. If the Inngest client ever moves to `shared/`, only the re-export files need updating.

### Decision 4: `previousModality` sourced from `existing` record

**Choice:** In `updateSessionImpl`, the `previousModality` field in the event payload is set to `existing.modality` (the session state read before the update), not from the input.

**Rationale:** The `auto-create-room` consumer uses `previousModality` vs `modality` comparison to detect online-to-in_person transitions (expiring the video room). The `existing` record is already loaded at step 3 of the update flow for ownership verification and diff computation, so no additional query is needed.

### Decision 5: `status` in the update event uses `existing.status`

**Choice:** The `status` field in the `session.updated` payload uses `existing.status`, not a hardcoded value.

**Rationale:** The `updateSessionImpl` action does not change the session status — status transitions are handled by dedicated actions (`confirmSessionImpl`, `cancelSessionImpl`, etc.). The current status is relevant for the consumer's guard check (it only creates rooms for `scheduled` or `confirmed` sessions).

## Risks / Trade-offs

- **[Risk] Event emitted but consumer fails** → Mitigated by Inngest's built-in retry mechanism (3 retries with backoff on `auto-create-room`). The consumer is idempotent.
- **[Risk] Event not emitted due to catch swallowing the error** → Mitigated by `logger.error()` with structured metadata (`eventName`, `sessionId`). Monitoring/alerting on `inngest_send_failed` log events can detect systematic failures.
- **[Risk] Zod parse failure on outbound payload** → Extremely unlikely since the payload is constructed from validated input + database values. If it happens, caught by try/catch and logged. Does not affect the user operation.
- **[Trade-off] No at-least-once delivery guarantee** → Accepted. For session CRUD events, eventual consistency is acceptable. A scheduled reconciliation job could be added in the future if delivery guarantees become critical.
