---
name: integration-cleanup-use-cleantestdata
description: In dashboard/agenda integration tests, never hand-roll DELETE FROM sessions/patients in afterEach — use the shared cleanTestData() helper plus a beforeAll wipe
metadata:
  type: feedback
---

Integration tests that seed `sessions`/`patients` must clean up via `cleanTestData()` from `src/__tests__/integration/setup/clean-test-data.ts`, NOT via a local `runAsService(db => db.delete(sessions))`.

**Why:** the Testcontainers DB is `.withReuse()` with no teardown, so it retains rows from OTHER suites — e.g. `video_rooms` rows that FK-reference `sessions`. An unfiltered `DELETE FROM sessions` then fails with `video_rooms_session_id_fk` (PostgresError 23503), which surfaces as an `afterEach` error that fails an otherwise-passing test (even the UNAUTHORIZED one). Stale rows can also pollute owner-scoped COUNT assertions.

**How to apply:** import `cleanTestData` and wire `beforeAll(cleanTestData)` (clean slate so prior-suite rows never inflate counts) + `afterEach(cleanTestData)` + `afterAll(cleanTestData)`. `cleanTestData()` already deletes in the full FK-dependency order (medical-records → ai_transcriptions → telepsicologia video_* → consent_terms → session_history → sessions → patients → auth.users test-* emails). Reinforces [[feedback-testcontainers-reuse-dirty-state]].
