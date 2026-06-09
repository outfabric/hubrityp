## Why

The "Histórico de sessões" tab on `/pacientes/:id` is supposed to show **at most one** future session (the nearest upcoming one), but patients on a recurring schedule see many future sessions piled at the top of the list. The historical-list query relies on excluding a single session id instead of bounding by time, so every other future occurrence from a recurrence leaks into the list — a direct violation of the existing `patient-session-history` spec ("Additional future sessions … SHALL NOT be loaded in this tab").

## What Changes

- Bound the historical-list query (`getPatientSessionHistoryList`) by time so only sessions with `start_at < now()` are returned, structurally excluding all future occurrences instead of relying on single-id exclusion.
- Keep the existing nearest-future-session id exclusion as defense-in-depth against the `now()` race between the two reads (the nearest-future read and the list read run at slightly different instants), preventing the nearest session from appearing twice.
- Clarify where overdue but non-terminal sessions (`start_at` in the past, status still `scheduled`/`confirmed`) belong: under "Sessões anteriores", since their time has passed and they are not picked up as the upcoming session.
- Add a regression integration test that seeds multiple future occurrences (recurrence) and asserts the list returns only past sessions and zero future ones.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `patient-session-history`: strengthen the "At most one future session" requirement to mandate that the historical list is time-bounded (`start_at < now()`), making the no-leak guarantee independent of id exclusion, and clarify the placement of overdue non-terminal sessions.

## Impact

- Code: `src/modules/sessions/server/get-patient-session-history-list.ts` (add the `start_at < now()` predicate).
- Tests: `src/__tests__/integration/sessions/get-patient-session-history-list.int.test.ts` (new multi-future regression case).
- No schema, migration, RLS, or API-contract changes. No breaking changes — the fix brings runtime behavior back in line with the published spec.
