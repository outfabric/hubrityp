---
name: today-sessions-int-sp-midnight-flake
description: dashboard today-sessions.int.test.ts "all of today's sessions in the past" case fails when run in the first ~2h after São Paulo midnight (seeds "2h ago" → lands on previous SP day)
metadata:
  type: feedback
---

`src/__tests__/integration/dashboard/today-sessions.int.test.ts` → "returns next = null when all of today's sessions are in the past" (around line 207) seeds a session at `Date.now() - 2h` and asserts `result.sessions` has length 1. This fails with `expected [] to have a length of 1` whenever the suite runs between ~00:00 and ~02:00 São Paulo wall-clock.

**Why:** `getTodaySessions` filters to `[startOfSaoPauloDay(now), startOfNextSaoPauloDay(now))` (see `src/modules/dashboard/lib/sao-paulo-windows.ts`). SP is UTC-3, so when wall-clock is e.g. 00:16 SP, "2 hours ago" is ~22:16 of the **previous** SP calendar day → correctly excluded from "today" → 0 rows, not 1. The other 6 tests in the file use future-relative `startAt` or status-only assertions and are unaffected. This is date-deterministic, NOT load/parallelism flakiness: a rerun within the same window fails identically; it only "heals" once SP clock passes ~02:00.

**How to apply:** If a full integration sweep fails ONLY on this one test with `[] to have length 1`, check `TZ=America/Sao_Paulo date` — if it is within ~2h of SP midnight, it is this boundary flake, not your change. Do not chase it in unrelated work (e.g. an onboarding-tour fix). Sibling: [[sp-week-window-half-day-fudge]]. The proper fix (out of scope for unrelated tickets) is to inject a fixed `now` into the test seed/query instead of `Date.now()`, the way other window helpers can be pinned, so the case is wall-clock-independent.
