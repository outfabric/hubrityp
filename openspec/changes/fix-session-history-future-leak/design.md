## Context

`getPatientSessionHistoryList` (`src/modules/sessions/server/get-patient-session-history-list.ts`) backs the historical list of the "Histórico de sessões" tab. The nearest upcoming session is read separately by `getNearestFutureSession` (status `scheduled`/`confirmed`, `start_at >= now()`, `ORDER BY start_at ASC LIMIT 1`) and the orchestrator (`getPatientSessionHistoryImpl`) passes that session's id to the list as `excludeSessionId`.

The list query's predicates are: owner scope (`user_id`, `patient_id`), `deleted_at IS NULL`, `is_blocking = false`, optional terminal-status filter, and `id <> :excludeSessionId`. It is ordered `start_at DESC`. Crucially it has **no upper time bound**, so for a recurrence with N future occurrences it excludes only the single nearest one by id and returns the other N−1 future rows at the top of the list. This violates the `patient-session-history` "At most one future session" requirement.

The existing test `excludes the nearest-future session id from the list` seeds only one future session, so the leak went uncaught.

## Goals / Non-Goals

**Goals:**
- The historical list returns zero future sessions regardless of recurrence size.
- The nearest-future session is never duplicated (race-safe).
- Overdue non-terminal sessions (past `start_at`, still `scheduled`/`confirmed`) are placed in the historical list.
- A regression test covers the multi-future case.

**Non-Goals:**
- No change to `getNearestFutureSession`, the summary query, the orchestrator, pagination/cursor logic, or any UI component.
- No schema, migration, RLS, or index changes.
- No change to the optional terminal-status filter behavior.

## Decisions

**Decision 1 — Bound the list by `start_at < now()` (time bound), not by status.**
Add `lt(sessions.startAt, sql\`now()\`)` to the list predicates. A time bound matches the semantic the "Sessões anteriores" divider communicates ("sessions whose time has passed") and is robust: it excludes future `scheduled`/`confirmed` rows while still surfacing overdue non-terminal sessions (past time, awaiting a status update) where they belong.
*Alternative considered:* excluding by status (`status NOT IN ('scheduled','confirmed')`). Rejected — it would wrongly hide overdue sessions that are genuinely in the past, and it conflates lifecycle state with chronology.

**Decision 2 — Keep the `excludeSessionId` predicate as defense-in-depth.**
`getNearestFutureSession` and the list read evaluate `now()` at slightly different instants. A session at `start_at ≈ now()` could be picked as "nearest future" (`>= now`) by the first read and then satisfy `start_at < now()` in the list read a moment later, reappearing in the list. Retaining the id exclusion guarantees the nearest session is never rendered twice even across that race. The two guards are complementary: the time bound handles the bulk (recurrence tail), the id exclusion handles the boundary instant.

**Decision 3 — Use the database `now()`, consistent with `getNearestFutureSession`.**
Both reads must use the same clock source (Postgres `now()`) so the boundary is coherent. Using a JS-side timestamp would introduce a second clock and widen the race window.

## Risks / Trade-offs

- [A session exactly at `start_at = now()` falls in neither read] → Acceptable and self-healing: `getNearestFutureSession` uses `>= now()` so it claims the boundary instant; the list uses strict `< now()` so it does not. The boundary row is owned by the future read, never dropped.
- [`now()` race causing duplication] → Mitigated by retaining `excludeSessionId` (Decision 2).
- [Performance] → Adds one more predicate on `start_at`; the query is already owner-scoped and ordered by `start_at`, so no new index is required.

## Migration Plan

Pure code change to one query plus a test. No data migration, no rollback steps beyond reverting the commit. Deploy is non-breaking and brings runtime behavior in line with the already-published spec.

## Open Questions

None.
