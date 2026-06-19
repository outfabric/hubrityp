---
name: reminders-dispatcher-int-date-bomb
description: whatsapp reminders-dispatcher.int.test.ts ("early reminder window" + "both due") was a date bomb — fixed-date seeds (2026-06-15) dropped the early reminder once real wall-clock rolled past, because DB-default created_at tripped RN-04.03. FIXED: dates pinned to 2030 + explicit createdAt.
metadata:
  type: feedback
---

`src/__tests__/integration/whatsapp/reminders-dispatcher.int.test.ts` had two date-bomb cases:
"emits reminder.send event for a session within the early reminder window" and "emits both
early and final reminders when both are due". Both seeded a session at a hard-coded
`new Date('2026-06-15T14:00:00Z')` and injected a hard-coded `now`.

**Real root cause (corrected):** the two failing `seedSession` calls did NOT pass an explicit
`createdAt`, so the DB defaulted it to real `now()`. `computeReminderWindow`'s RN-04.03 rule
(`src/modules/whatsapp/lib/reminders/compute-reminder-window.ts` lines ~103-104) skips the early
reminder when the session was created less than `early_reminder_hours` before `startAt`
(`isBefore(startAt - earlyHours, createdAt)`). Once the real date rolled past 2026-06-15, the
default `createdAt` landed AFTER the `startAt - 24h` threshold, so the early reminder was
suppressed — "both due" returned 1 instead of 2, and the "early window" case returned 0. It was
NOT a look-back/staleness guard. The injected `now` kept the past-session check
(`isBefore(startAt, now)`) happy; only the DB-default `createdAt` was the bomb.

**Fix applied (2026-06-18):** pinned all dates in both cases to 2030 (so the real wall clock
never overtakes the fixture) AND passed an explicit `createdAt: new Date('2030-06-10T12:00:00Z')`
to both `seedSession` calls (creation 5 days before startAt, well outside the RN-04.03 threshold).
Verified 13/13 green on a freshly `docker rm -f`'d container.

**How to apply:** When seeding a session for a reminder test, ALWAYS pass an explicit `createdAt`
well before `startAt` — never rely on the DB default, which is real `now()` and breaks RN-04.03
for any past-dated `startAt`. And anchor seed dates far in the future, not to a literal near the
authoring date. See [[testcontainers-reuse-dirty-state]]: this suite ALSO trips
`profiles_crp_number_crp_uf_unique` on a stale reused container (afterEach only deletes
`test-%@example.com` rows) — `docker rm -f` the reused postgres container before trusting a
duplicate-key failure as a real regression.
