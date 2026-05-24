## Why

The agenda module's lifecycle Server Actions (confirm, cancel, mark-done, mark-no-show, complete-reschedule, missing-note-reminder) all have explicit TODO comments indicating they need to emit Inngest events, but none of them do. One downstream consumer already exists: `whatsapp/cancellation-notice-sender` listens to `agenda/session.cancelled` to send WhatsApp cancellation notices to patients. Without event emission, patients are not notified when the psychologist cancels a session. The remaining 5 events have no consumers yet but must be emitted so future consumers (billing, analytics, notifications) can subscribe without modifying the agenda module.

## What Changes

- Wire `agenda/session.confirmed` emission in `confirmSessionImpl` (therapist-initiated, `confirmedBy: 'therapist'`).
- Wire `agenda/session.confirmed` emission in `publicConfirmSessionImpl` (patient-initiated via public link, `confirmedBy: 'patient'`).
- Wire `agenda/session.cancelled` emission in `cancelSessionImpl` (therapist-initiated, with notice tier, reason, and charge flag).
- Wire `agenda/session.cancelled` emission in `publicDeclineSessionImpl` (patient-initiated via public link, `cancelledBy: 'patient'`).
- Wire `agenda/session.done` emission in `markSessionDoneImpl`.
- Wire `agenda/session.no_show` emission in `markSessionNoShowImpl`.
- Wire `agenda/session.rescheduled` emission in `completeRescheduleImpl` (with both old and new session IDs).
- Wire `agenda/session.missing_note_reminder` batch emission in `runMissingNoteReminder` (one event per eligible session, loop with per-event fire-and-forget).

All 8 Server Actions follow the same fire-and-forget pattern: try/catch around `inngest.send()`, Zod-validate payload before sending, log errors, never fail the user operation.

## Capabilities

### New Capabilities

- `agenda-session-lifecycle-event-emission`: Inngest event emission wiring for `agenda/session.confirmed`, `agenda/session.cancelled`, `agenda/session.done`, `agenda/session.no_show`, `agenda/session.rescheduled`, and `agenda/session.missing_note_reminder` across 8 Server Actions. Covers the fire-and-forget pattern, nullable patientId handling for blocking slots, and batch emission for missing-note reminders.

### Modified Capabilities

_(none — event schemas, consumer functions, and session lifecycle logic already exist; only the emission wiring is missing)_

## Impact

- **Code**: 8 Server Action files modified (confirm-session, public-confirm-session, cancel-session, public-decline-session, mark-session-done, mark-session-no-show, complete-reschedule, missing-note-reminder).
- **Dependencies**: Inngest SDK (already installed); `src/modules/agenda/inngest/client.ts` (created by companion change `agenda-session-events-created-updated`).
- **Downstream consumers**: `whatsapp/cancellation-notice-sender` will start receiving `agenda/session.cancelled` events it already listens for. Other events have no consumers yet but are emitted for future use.
- **No new routes, tables, RLS policies, migrations, or frontend changes.**
