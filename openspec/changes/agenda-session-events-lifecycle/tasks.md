## 1. Wire session.confirmed Events

- [x] 1.1 In `src/modules/agenda/server/confirm-session.ts`, add imports for `inngest` (from `@/modules/agenda/inngest/client`) and `sessionConfirmedEventSchema` (from `@/modules/agenda/lib/session-events`). Replace the TODO comment (line ~128) with fire-and-forget `inngest.send()`: validate payload with `sessionConfirmedEventSchema.parse({ sessionId: validSessionId, patientId: existing.patientId, userId, confirmedAt: new Date(), confirmedBy: 'therapist' })`, send with event name `'agenda/session.confirmed'`, log error on failure
- [x] 1.2 In `src/modules/agenda/server/public-confirm-session.ts`, add imports for `inngest` and `sessionConfirmedEventSchema`. Replace the TODO comment (line ~132) with fire-and-forget emission: use `confirmedBy: 'patient'`, `confirmedAt: now` (existing variable at line 92), `userId: existing.userId`, `patientId: existing.patientId`

## 2. Wire session.cancelled Events

- [x] 2.1 In `src/modules/agenda/server/cancel-session.ts`, add imports for `inngest` and `sessionCancelledEventSchema`. Replace the TODO comment (line ~155) with fire-and-forget emission: use `cancelledBy: data.cancelledBy`, `cancelledAt` (existing variable), `reason: data.reason`, `notice` (existing variable from `calculateCancellationNotice`), `chargeApplied: data.chargeCancellation`, `patientId: existing.patientId`, `userId`
- [x] 2.2 In `src/modules/agenda/server/public-decline-session.ts`, add imports for `inngest` and `sessionCancelledEventSchema`. Replace the TODO comment (line ~158) with fire-and-forget emission: use `cancelledBy: 'patient'`, `cancelledAt` (existing variable), `reason: 'patient_cancelled'`, `notice` (existing variable), `chargeApplied: false`, `userId: existing.userId`, `patientId: existing.patientId`

## 3. Wire session.done and session.no_show Events

- [x] 3.1 In `src/modules/agenda/server/mark-session-done.ts`, add imports for `inngest` and `sessionDoneEventSchema`. Replace the TODO comment (line ~135) with fire-and-forget emission: use `doneAt: new Date()`, `patientId: existing.patientId`, `userId`, `sessionId: validSessionId`
- [x] 3.2 In `src/modules/agenda/server/mark-session-no-show.ts`, add imports for `inngest` and `sessionNoShowEventSchema`. Replace the TODO comment (line ~126) with fire-and-forget emission: use `noShowAt: new Date()`, `patientId: existing.patientId`, `userId`, `sessionId: validSessionId`

## 4. Wire session.rescheduled Event

- [ ] 4.1 In `src/modules/agenda/server/complete-reschedule.ts`, add imports for `inngest` and `sessionRescheduledEventSchema`. Replace the TODO comment (line ~169) with fire-and-forget emission: use `oldSessionId` (function parameter), `newSessionId: newSessionRow.id`, `rescheduledAt: new Date()`, `patientId: oldSession.patientId`, `userId`

## 5. Wire session.missing_note_reminder Batch Emission

- [ ] 5.1 In `src/modules/agenda/server/missing-note-reminder.ts`, add import for `inngest` (from `@/modules/agenda/inngest/client`). In `runMissingNoteReminder`, replace the TODO comment (line ~137) with a loop over `result.events`: for each event, wrap `inngest.send({ name: 'agenda/session.missing_note_reminder', data: event })` in its own try/catch so that one failure does not block the rest. Log per-event errors with `{ event: 'inngest_send_failed', eventName: 'agenda/session.missing_note_reminder', sessionId: event.sessionId }`

## 6. Unit Tests

- [ ] 6.1 Create `src/__tests__/unit/modules/agenda/server/confirm-session-events.test.ts` — mock `@/modules/agenda/inngest/client`, `@/shared/db/client`, and `supabase.auth.getUser()`. Test: (a) successful confirm calls `inngest.send()` with `confirmedBy: 'therapist'` and correct payload, (b) fire-and-forget on failure, (c) concurrent modification does not emit event
- [ ] 6.2 Create `src/__tests__/unit/modules/agenda/server/public-confirm-session-events.test.ts` — mock inngest client and db. Test: (a) successful confirm calls `inngest.send()` with `confirmedBy: 'patient'`, (b) fire-and-forget on failure, (c) expired token does not emit event
- [ ] 6.3 Create `src/__tests__/unit/modules/agenda/server/cancel-session-events.test.ts` — Test: (a) successful cancel emits with correct `cancelledBy`, `reason`, `notice`, `chargeApplied`, (b) fire-and-forget on failure, (c) blocking slot (null patientId) fails Zod parse silently
- [ ] 6.4 Create `src/__tests__/unit/modules/agenda/server/public-decline-session-events.test.ts` — Test: (a) successful decline emits with `cancelledBy: 'patient'`, `reason: 'patient_cancelled'`, `chargeApplied: false`, (b) fire-and-forget on failure
- [ ] 6.5 Create `src/__tests__/unit/modules/agenda/server/mark-session-done-events.test.ts` — Test: (a) successful mark-done emits with `doneAt`, (b) fire-and-forget on failure
- [ ] 6.6 Create `src/__tests__/unit/modules/agenda/server/mark-session-no-show-events.test.ts` — Test: (a) successful mark-no-show emits with `noShowAt`, (b) fire-and-forget on failure
- [ ] 6.7 Create `src/__tests__/unit/modules/agenda/server/complete-reschedule-events.test.ts` — Test: (a) successful reschedule emits with both `oldSessionId` and `newSessionId`, (b) fire-and-forget on failure
- [ ] 6.8 Create `src/__tests__/unit/modules/agenda/server/missing-note-reminder-events.test.ts` — Test: (a) batch emission sends one event per eligible session, (b) one failure does not block others, (c) zero eligible sessions emits no events

## 7. Integration Tests

- [ ] 7.1 Create `src/__tests__/integration/agenda/session-lifecycle-events.int.test.ts` — run against real Postgres with Drizzle migrations. Mock `inngest.send()` at the module level. Test: (a) confirm session emits `agenda/session.confirmed`, (b) cancel session emits `agenda/session.cancelled` with correct notice and reason, (c) mark done emits `agenda/session.done`, (d) mark no-show emits `agenda/session.no_show`, (e) complete reschedule emits `agenda/session.rescheduled` with both session IDs, (f) missing note reminder emits batch events for eligible sessions
