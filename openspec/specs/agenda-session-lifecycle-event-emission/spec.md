## Requirements

### Requirement: System emits session.confirmed event after therapist confirmation

The system SHALL emit an `agenda/session.confirmed` Inngest event after a therapist successfully confirms a session via `confirmSessionImpl`. The event payload MUST be validated against `sessionConfirmedEventSchema` before sending. The payload MUST contain: `sessionId`, `patientId` (from the existing session record), `userId` (authenticated psychologist), `confirmedAt` (current timestamp), and `confirmedBy: 'therapist'`.

#### Scenario: Therapist confirms a scheduled session

- **WHEN** psychologist confirms a session with status "scheduled" for patient "Marina Silva"
- **THEN** system transitions status to "confirmed" AND emits `agenda/session.confirmed` with `confirmedBy: 'therapist'`, `confirmedAt` as current timestamp, and `patientId` matching the session's patient

#### Scenario: Confirmation fails due to concurrent modification

- **WHEN** psychologist confirms a session but another operation changed the status concurrently
- **THEN** system returns `concurrent_modification` error AND does NOT emit any event

### Requirement: System emits session.confirmed event after patient confirmation

The system SHALL emit an `agenda/session.confirmed` Inngest event after a patient successfully confirms a session via `publicConfirmSessionImpl` (public link, no auth). The payload MUST use `confirmedBy: 'patient'`, `userId: existing.userId` (session owner), and `confirmedAt` from the local `now` variable.

#### Scenario: Patient confirms via public link

- **WHEN** patient clicks the confirmation link and confirms the session
- **THEN** system transitions status to "confirmed" AND emits `agenda/session.confirmed` with `confirmedBy: 'patient'` and `userId` set to the session owner's ID

#### Scenario: Patient confirmation with expired token

- **WHEN** patient clicks the confirmation link but the session has already started (token expired)
- **THEN** system returns `expired` error AND does NOT emit any event

### Requirement: System emits session.cancelled event after therapist cancellation

The system SHALL emit an `agenda/session.cancelled` Inngest event after a therapist successfully cancels a session via `cancelSessionImpl`. The payload MUST contain: `sessionId`, `patientId`, `userId`, `cancelledAt`, `cancelledBy` (from validated input), `reason` (from validated input), `notice` (computed via `calculateCancellationNotice`), and `chargeApplied` (from validated input `chargeCancellation`).

#### Scenario: Therapist cancels a session with 24h+ notice

- **WHEN** psychologist cancels a confirmed session 48 hours before start time with reason "Viagem profissional" and no charge
- **THEN** system emits `agenda/session.cancelled` with `cancelledBy: 'therapist'`, `notice: '24h+'`, `reason: 'Viagem profissional'`, `chargeApplied: false`

#### Scenario: Therapist cancels with charge applied

- **WHEN** psychologist cancels a session less than 1 hour before start and applies charge
- **THEN** system emits `agenda/session.cancelled` with `notice: 'less_1h'`, `chargeApplied: true`

#### Scenario: Blocking slot cancelled (no patient)

- **WHEN** psychologist cancels a blocking time slot (patientId is null)
- **THEN** system completes the cancellation successfully AND the event emission Zod parse fails silently (patientId is required in the schema), which is caught by fire-and-forget — no event is emitted, error is logged

### Requirement: System emits session.cancelled event after patient decline

The system SHALL emit an `agenda/session.cancelled` Inngest event after a patient declines a session via `publicDeclineSessionImpl` (public link, no auth). The payload MUST use `cancelledBy: 'patient'`, `reason: 'patient_cancelled'`, `chargeApplied: false`, and `userId: existing.userId`.

#### Scenario: Patient declines via public link

- **WHEN** patient clicks the decline link and cancels the session
- **THEN** system emits `agenda/session.cancelled` with `cancelledBy: 'patient'`, `reason: 'patient_cancelled'`, `chargeApplied: false`, and computed `notice` tier

#### Scenario: Patient decline with already cancelled session

- **WHEN** patient clicks the decline link but the session was already cancelled
- **THEN** system returns `cancelled` error AND does NOT emit any event

### Requirement: System emits session.done event after marking session done

The system SHALL emit an `agenda/session.done` Inngest event after a therapist successfully marks a session as done via `markSessionDoneImpl`. The payload MUST contain: `sessionId`, `patientId`, `userId`, and `doneAt` (current timestamp).

#### Scenario: Therapist marks confirmed session as done

- **WHEN** psychologist marks a confirmed session as done
- **THEN** system transitions status to "done" AND emits `agenda/session.done` with `doneAt` as current timestamp

#### Scenario: Blocking slot marked done (no patient)

- **WHEN** psychologist marks a blocking time slot as done (patientId is null)
- **THEN** system completes the transition AND the event emission Zod parse fails silently (caught by fire-and-forget), no event emitted

### Requirement: System emits session.no_show event after marking no-show

The system SHALL emit an `agenda/session.no_show` Inngest event after a therapist successfully marks a session as no-show via `markSessionNoShowImpl`. The payload MUST contain: `sessionId`, `patientId`, `userId`, and `noShowAt` (current timestamp).

#### Scenario: Therapist marks session as no-show

- **WHEN** psychologist marks a scheduled session as no-show
- **THEN** system transitions status to "no_show" AND emits `agenda/session.no_show` with `noShowAt` as current timestamp

#### Scenario: No-show on blocking slot (no patient)

- **WHEN** psychologist marks a blocking time slot as no-show (patientId is null)
- **THEN** system completes the transition AND the event emission Zod parse fails silently (caught by fire-and-forget)

### Requirement: System emits session.rescheduled event after completing reschedule

The system SHALL emit an `agenda/session.rescheduled` Inngest event after successfully completing a reschedule via `completeRescheduleImpl`. The payload MUST contain: `oldSessionId`, `newSessionId`, `patientId` (from old session), `userId`, and `rescheduledAt` (current timestamp).

#### Scenario: Session rescheduled to new time

- **WHEN** psychologist reschedules a session from Monday 14:00 to Tuesday 10:00
- **THEN** system cancels the old session, creates the new session, AND emits `agenda/session.rescheduled` with both `oldSessionId` and `newSessionId`

#### Scenario: Reschedule with no patient (blocking slot)

- **WHEN** psychologist reschedules a blocking slot (patientId is null)
- **THEN** system completes the reschedule AND the event emission Zod parse fails silently (caught by fire-and-forget)

### Requirement: System emits session.missing_note_reminder events in batch

The system SHALL emit one `agenda/session.missing_note_reminder` Inngest event per eligible session when `runMissingNoteReminder` executes. Each event payload MUST contain: `sessionId`, `patientId`, `userId`, `doneAt`, and `daysSinceDone`. Events MUST be sent individually (not as a batch) so that a failure on one event does not prevent the others from being sent.

#### Scenario: Three sessions missing notes

- **WHEN** `runMissingNoteReminder` finds 3 done sessions older than 7 days without clinical notes
- **THEN** system emits 3 separate `agenda/session.missing_note_reminder` events, one per session

#### Scenario: One event fails in batch

- **WHEN** `runMissingNoteReminder` sends 3 events but the second `inngest.send()` call throws
- **THEN** the first and third events are sent successfully, the second failure is logged, and `runMissingNoteReminder` returns normally

#### Scenario: No sessions missing notes

- **WHEN** `runMissingNoteReminder` finds 0 eligible sessions
- **THEN** no events are emitted and the function returns `{ sessionsNotified: 0 }`

### Requirement: All lifecycle event emissions are fire-and-forget

The system SHALL NOT fail any user-facing operation or scheduled job if `inngest.send()` throws an error. The database mutation MUST already be committed before event emission is attempted. On emission failure, the system MUST log a structured error with `event: 'inngest_send_failed'`, the event name, and the session ID (no PII).

#### Scenario: Inngest send fails on session confirmation

- **WHEN** psychologist confirms a session but `inngest.send()` throws
- **THEN** system returns `{ ok: true }` AND logs `{ event: 'inngest_send_failed', eventName: 'agenda/session.confirmed', sessionId: <uuid> }`

#### Scenario: Inngest send fails on session cancellation

- **WHEN** psychologist cancels a session but `inngest.send()` throws
- **THEN** system returns `{ ok: true }` AND logs the failure

#### Scenario: Inngest send fails on missing-note-reminder (single event in batch)

- **WHEN** `runMissingNoteReminder` fails to send one event in a batch of 5
- **THEN** the other 4 events are still sent and the function returns normally with the total count
