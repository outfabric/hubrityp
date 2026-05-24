## ADDED Requirements

### Requirement: System emits session.created event after session creation

The system SHALL emit an `agenda/session.created` Inngest event after a session is successfully created (transaction committed). The event payload MUST be validated against `sessionCreatedEventSchema` before sending. The payload MUST contain: `sessionId` (UUID of the new session), `userId` (authenticated psychologist), `patientId` (nullable), `modality` (nullable), `status` (always `'scheduled'` for new sessions), `startAt`, and `endAt`.

#### Scenario: Session created with patient and modality

- **WHEN** psychologist creates a session with patient "Marina Silva", modality "online", start 14:00, duration 50min
- **THEN** system commits the session to the database AND emits `agenda/session.created` with payload `{ sessionId: <new-uuid>, userId: <psychologist-uuid>, patientId: <patient-uuid>, modality: 'online', status: 'scheduled', startAt: 2026-05-15T14:00:00, endAt: 2026-05-15T14:50:00 }`

#### Scenario: Session created as blocking slot (no patient)

- **WHEN** psychologist creates a blocking time slot with no patient, no modality
- **THEN** system emits `agenda/session.created` with `patientId: null` and `modality: null`

#### Scenario: Session created with modality in_person

- **WHEN** psychologist creates a session with modality "in_person"
- **THEN** system emits `agenda/session.created` with `modality: 'in_person'`

### Requirement: System emits session.updated event after session update

The system SHALL emit an `agenda/session.updated` Inngest event after a session is successfully updated (transaction committed). The event payload MUST be validated against `sessionUpdatedEventSchema` before sending. The payload MUST contain all fields from `session.created` plus `previousModality` (the modality value BEFORE the update, sourced from the existing session record).

#### Scenario: Session updated from in_person to online

- **WHEN** psychologist updates an existing session changing modality from "in_person" to "online"
- **THEN** system emits `agenda/session.updated` with `modality: 'online'` and `previousModality: 'in_person'`

#### Scenario: Session updated keeping same modality

- **WHEN** psychologist updates a session's time without changing modality (currently "online")
- **THEN** system emits `agenda/session.updated` with `modality: 'online'` and `previousModality: 'online'`

#### Scenario: Session updated from online to in_person

- **WHEN** psychologist updates an existing session changing modality from "online" to "in_person"
- **THEN** system emits `agenda/session.updated` with `modality: 'in_person'` and `previousModality: 'online'`

#### Scenario: Session status is preserved in update event

- **WHEN** psychologist updates a session that has status "confirmed"
- **THEN** system emits `agenda/session.updated` with `status: 'confirmed'` (the current status, not a hardcoded value)

### Requirement: Event emission is fire-and-forget

The system SHALL NOT fail the user's operation if `inngest.send()` throws an error (network timeout, Inngest downtime, SDK error). The session MUST already be committed to the database before event emission is attempted. On emission failure, the system MUST log a structured error with `event: 'inngest_send_failed'`, the event name, and the session ID (no PII).

#### Scenario: Inngest send fails on session creation

- **WHEN** psychologist creates a session successfully but `inngest.send()` throws a network error
- **THEN** system returns `{ ok: true, sessionId: <uuid> }` to the user AND logs a structured error with `{ event: 'inngest_send_failed', eventName: 'agenda/session.created', sessionId: <uuid> }`

#### Scenario: Inngest send fails on session update

- **WHEN** psychologist updates a session successfully but `inngest.send()` throws an error
- **THEN** system returns `{ ok: true }` to the user AND logs a structured error with `{ event: 'inngest_send_failed', eventName: 'agenda/session.updated', sessionId: <uuid> }`

### Requirement: Event emission occurs after transaction commit

The system SHALL emit Inngest events AFTER the database transaction has committed and BEFORE the success response is returned. Events MUST NOT be emitted inside the transaction (risk of event without commit) or after the return statement (unreachable code).

#### Scenario: Transaction commits then event is emitted

- **WHEN** psychologist creates a session and the transaction commits successfully
- **THEN** `inngest.send()` is called after the transaction completes, before `{ ok: true }` is returned

#### Scenario: Transaction rolls back

- **WHEN** a session creation transaction fails and rolls back
- **THEN** no `inngest.send()` call is made (the code path enters the catch block before reaching event emission)

### Requirement: Agenda module has its own Inngest client re-export

The agenda module SHALL re-export the shared Inngest client from `src/modules/agenda/inngest/client.ts`, following the module isolation convention. Server Actions in the agenda module MUST import the Inngest client from `@/modules/agenda/inngest/client`, not from sibling modules.

#### Scenario: Agenda inngest client re-exports shared singleton

- **WHEN** the agenda module imports `inngest` from `@/modules/agenda/inngest/client`
- **THEN** it receives the same `Inngest({ id: 'hubrityp' })` instance used by whatsapp and telepsicologia modules

### Requirement: Agenda barrel exports created and updated event schemas

The agenda module barrel (`src/modules/agenda/index.ts`) SHALL export `sessionCreatedEventSchema`, `SessionCreatedEvent`, `sessionUpdatedEventSchema`, and `SessionUpdatedEvent` alongside the existing lifecycle event schema exports.

#### Scenario: External consumer imports created event schema

- **WHEN** a module imports `sessionCreatedEventSchema` from `@/modules/agenda`
- **THEN** it receives the Zod schema for `agenda/session.created` event payload validation

#### Scenario: External consumer imports updated event type

- **WHEN** a module imports `SessionUpdatedEvent` from `@/modules/agenda`
- **THEN** it receives the TypeScript type derived from `sessionUpdatedEventSchema` via `z.infer`
