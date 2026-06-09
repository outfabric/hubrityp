## 1. Fix the historical-list time bound

- [ ] 1.1 In `src/modules/sessions/server/get-patient-session-history-list.ts`, add a `lt(sessions.startAt, sql\`now()\`)` predicate to the list query so only sessions with `start_at < now()` are returned; keep the existing `excludeSessionId` predicate as race-safety defense-in-depth (import `lt` from `drizzle-orm` if not already imported)
- [ ] 1.2 Update the JSDoc on `getPatientSessionHistoryList` to state that the time bound is the primary no-leak mechanism and that the id exclusion guards the `now()` race between the nearest-future read and the list read
- [ ] 1.3 Add a regression case to `src/__tests__/integration/sessions/get-patient-session-history-list.int.test.ts` that seeds multiple future `scheduled`/`confirmed` occurrences plus some past sessions and asserts the list returns only the past sessions and zero future ones (covers the "Multiple future sessions never leak" scenario)
- [ ] 1.4 Add an integration case asserting an overdue non-terminal session (past `start_at`, status `scheduled`) is NOT returned by `getNearestFutureSession` and DOES appear in `getPatientSessionHistoryList` (covers the "Overdue non-terminal session" scenario)

