## Why

The agenda module's `createSessionImpl` and `updateSessionImpl` Server Actions commit sessions to the database but do not emit Inngest events. A downstream consumer (`telepsicologia/auto-create-room`) already listens for `agenda/session.created` and `agenda/session.updated` to auto-provision Stream.io video rooms for online sessions. Without event emission, online sessions are created but no video room is provisioned — breaking the telepsychology flow.

## What Changes

- Create `src/modules/agenda/inngest/client.ts` — re-export the shared Inngest singleton so the agenda module has its own import path (same pattern as telepsicologia).
- Wire `agenda/session.created` emission in `createSessionImpl` — fire-and-forget `inngest.send()` after the transaction commits, with Zod-validated payload.
- Wire `agenda/session.updated` emission in `updateSessionImpl` — same pattern, including `previousModality` from the pre-update session state for online/in_person transition detection.
- Add missing `sessionCreatedEventSchema` and `sessionUpdatedEventSchema` exports to the agenda module barrel (`index.ts`).

## Capabilities

### New Capabilities

- `agenda-session-event-emission`: Inngest event emission wiring for `agenda/session.created` and `agenda/session.updated` in the agenda module's session CRUD Server Actions. Covers the fire-and-forget pattern, Zod payload validation, and the Inngest client re-export.

### Modified Capabilities

_(none — event schemas, consumer functions, and session CRUD logic already exist; only the emission wiring is missing)_

## Impact

- **Code**: `src/modules/agenda/server/create-session.ts`, `src/modules/agenda/server/update-session.ts`, `src/modules/agenda/index.ts` (modified); `src/modules/agenda/inngest/client.ts` (new).
- **Dependencies**: Inngest SDK (`inngest` package) — already installed and used by whatsapp/telepsicologia modules.
- **Downstream consumers**: `telepsicologia/auto-create-room` will start receiving events it already listens for. `whatsapp/cancellation-notice-sender` is unaffected (listens to `session.cancelled`, not `created`/`updated`).
- **No new routes, tables, RLS policies, migrations, or frontend changes.**
