## Context

The agenda module owns session lifecycle transitions: confirm, cancel, mark-done, mark-no-show, complete-reschedule, and missing-note-reminder. Each Server Action successfully mutates the database but does not emit Inngest events. The companion change `agenda-session-events-created-updated` established the pattern (fire-and-forget, Zod validation, Inngest client re-export) and wired `session.created` and `session.updated`. This change applies the same pattern to the remaining 6 event types across 8 Server Actions.

One consumer already exists: `src/modules/whatsapp/inngest/cancellation-notice-sender.ts` listens to `agenda/session.cancelled`. The event schemas are fully defined in `src/modules/agenda/lib/session-events.ts` and exported from the barrel.

## Goals / Non-Goals

**Goals:**

- Wire fire-and-forget `inngest.send()` for all 6 lifecycle event types in their respective Server Actions.
- Handle the dual-actor pattern: `session.confirmed` and `session.cancelled` each have two emitters (therapist-initiated and patient-initiated via public link), with the `confirmedBy`/`cancelledBy` field reflecting the actor.
- Handle nullable `patientId` gracefully: blocking slots (no patient) will cause Zod parse to fail silently in the fire-and-forget catch, which is acceptable since lifecycle events for blocking slots are meaningless.
- Wire batch emission in `runMissingNoteReminder` — one event per eligible session, with per-event error handling.

**Non-Goals:**

- Creating new Inngest consumer functions — consumers will be added by their respective modules when needed.
- Modifying event schemas — they are already complete and correct.
- Creating the Inngest client re-export — handled by the companion change.
- Frontend changes — event emission is invisible to the UI.
- At-least-once delivery guarantees — fire-and-forget is acceptable for all lifecycle events.

## Decisions

### Decision 1: Same fire-and-forget pattern as companion change

**Choice:** Every emission follows the same structure: build payload, `schema.parse()`, `inngest.send()`, catch and log on failure.

**Rationale:** Consistency across the codebase. The pattern was validated in the companion change and applies identically here. No special handling needed per event type.

### Decision 2: Dual-actor events use the same event name

**Choice:** Both `confirmSessionImpl` (therapist) and `publicConfirmSessionImpl` (patient) emit `agenda/session.confirmed` with different `confirmedBy` values. Same for cancellation.

**Rationale:** The event name represents what happened, not who triggered it. Consumers can filter on `confirmedBy`/`cancelledBy` if they care about the actor. This keeps the event namespace flat and avoids proliferating event names.

### Decision 3: Nullable patientId fails silently for blocking slots

**Choice:** The `sessionCancelledEventSchema`, `sessionDoneEventSchema`, `sessionNoShowEventSchema`, and `sessionRescheduledEventSchema` all require `patientId` as a non-nullable UUID. If a blocking slot (no patient) reaches a lifecycle transition, the Zod parse fails and the error is caught by fire-and-forget.

**Rationale:** Blocking slots should not trigger lifecycle events — there is no patient to notify, no billing to adjust, no clinical record to update. Letting the validation fail naturally in the catch block is simpler and safer than adding a guard clause (`if (!existing.patientId) skip event`), and the structured log will surface any unexpected occurrences.

**Alternative considered:** Adding a guard `if (existing.patientId)` before the try block. Rejected because it adds branching without adding value — the Zod schema is already the source of truth for what constitutes a valid event, and the catch block handles the failure identically.

### Decision 4: Missing-note-reminder uses per-event error handling

**Choice:** `runMissingNoteReminder` loops over `result.events` and sends each one individually with its own try/catch, rather than sending all events in a single `inngest.send()` call with an array.

**Rationale:** If one event in the batch fails, the others should still be sent. Inngest's `send()` supports arrays, but a single failure would reject the entire batch. Per-event handling ensures maximum delivery.

### Decision 5: Dependency on companion change for Inngest client

**Choice:** This change assumes `src/modules/agenda/inngest/client.ts` exists (created by the companion change `agenda-session-events-created-updated`). If implemented independently, that file must be created first.

**Rationale:** Avoids duplication. The companion change is designed to be applied first. If order is reversed, the implementation should create the file following the same re-export pattern.

## Risks / Trade-offs

- **[Risk] High volume of missing-note events on first run** → The `findSessionsMissingNotes()` query returns ALL done sessions older than 7 days without notes. On first activation, this could be a large batch. → Mitigated by per-event fire-and-forget (failures do not cascade) and Inngest's built-in rate limiting on the consumer side.
- **[Risk] Blocking slot lifecycle transitions emit failed events** → Mitigated by the Zod parse failure being caught silently. Log monitoring can detect unexpected patterns.
- **[Risk] Public actions emit events without authenticated user** → `publicConfirmSessionImpl` and `publicDeclineSessionImpl` use `existing.userId` (the session owner) for the event payload. This is correct — the event identifies the psychologist's session, and the `confirmedBy`/`cancelledBy` field identifies the actor.
- **[Trade-off] No retry mechanism for failed emissions** → Accepted. Same rationale as companion change: eventual consistency is acceptable, and a reconciliation job can be added later if needed.
