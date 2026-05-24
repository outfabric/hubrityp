## 1. Inngest Client Setup

- [x] 1.1 Create `src/modules/agenda/inngest/client.ts` — re-export the shared Inngest client from `@/modules/whatsapp/inngest/client`, following the same pattern as `src/modules/telepsicologia/inngest/client.ts`

## 2. Wire session.created Event

- [x] 2.1 In `src/modules/agenda/server/create-session.ts`, add imports for `inngest` (from `@/modules/agenda/inngest/client`) and `sessionCreatedEventSchema` (from `@/modules/agenda/lib/session-events`)
- [x] 2.2 In `createSessionImpl`, after the transaction commits (line ~186) and before `return { ok: true, sessionId: inserted.id }`, add fire-and-forget `inngest.send()` wrapped in try/catch: validate payload with `sessionCreatedEventSchema.parse()`, send with event name `'agenda/session.created'`, log error on failure with `{ event: 'inngest_send_failed', eventName: 'agenda/session.created', sessionId: inserted.id }`

## 3. Wire session.updated Event

- [x] 3.1 In `src/modules/agenda/server/update-session.ts`, add imports for `inngest` (from `@/modules/agenda/inngest/client`) and `sessionUpdatedEventSchema` (from `@/modules/agenda/lib/session-events`)
- [x] 3.2 In `updateSessionImpl`, after the transaction commits (line ~274) and before `return { ok: true }`, add fire-and-forget `inngest.send()` wrapped in try/catch: validate payload with `sessionUpdatedEventSchema.parse()`, include `previousModality: existing.modality` and `status: existing.status`, log error on failure with `{ event: 'inngest_send_failed', eventName: 'agenda/session.updated', sessionId }`

## 4. Barrel Exports

- [ ] 4.1 Update `src/modules/agenda/index.ts` to export `sessionCreatedEventSchema`, `SessionCreatedEvent`, `sessionUpdatedEventSchema`, and `SessionUpdatedEvent` from `./lib/session-events` (add to the existing session-events export block that currently only exports lifecycle event schemas)

## 5. Unit Tests

- [ ] 5.1 Create `src/__tests__/unit/modules/agenda/server/create-session-events.test.ts` — mock `@/modules/agenda/inngest/client`, `@/shared/db/client` (with transaction support), and `supabase.auth.getUser()`. Test: (a) successful create calls `inngest.send()` with correct event name and Zod-valid payload, (b) `inngest.send()` failure does not cause operation to fail (returns `{ ok: true }`), (c) failure logs structured error via `logger.error()`
- [ ] 5.2 Create `src/__tests__/unit/modules/agenda/server/update-session-events.test.ts` — same mock setup. Test: (a) successful update calls `inngest.send()` with correct event name and payload including `previousModality: existing.modality`, (b) fire-and-forget on failure, (c) `previousModality` reflects value from existing session not from input, (d) `status` uses `existing.status`

## 6. Integration Tests

- [ ] 6.1 Create `src/__tests__/integration/agenda/session-events.int.test.ts` — run against real Postgres with Drizzle migrations. Mock `inngest.send()` at the module level. Test: (a) create session with modality 'online' emits `agenda/session.created` with correct payload, (b) update session from 'in_person' to 'online' emits `agenda/session.updated` with `previousModality: 'in_person'`, (c) create blocking slot (no patient) emits event with `patientId: null`, (d) update keeping same modality has matching `previousModality`
