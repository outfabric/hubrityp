---
name: patient-session-history-patterns
description: PRD 13 patient session history tab: server query patterns, multi-getUser() antipattern, couple-safe projection, audit log design, hybrid client/server filter, keyset cursor, focusSession deep-link, test isolation
metadata:
  type: project
---

# Patient Session History Module (PRD §13)

**Why:** Added in feature/add-patient-session-history (reviewed 2026-06-09). Introduces the full session history tab for psychologist-patient views.

## Architecture

- `src/modules/sessions/server/get-patient-session-history.ts` — orchestrator, Zod validates input, calls getUser() once then delegates to three sub-functions
- `src/modules/sessions/server/get-patient-session-summary.ts` — aggregate: doneTotal, cancelledByPatient, noShow, doneWithoutEvolution, lastDoneAt
- `src/modules/sessions/server/get-nearest-future-session.ts` — single upcoming scheduled/confirmed session
- `src/modules/sessions/server/get-patient-session-history-list.ts` — paginated list with keyset cursor
- `src/modules/sessions/server/session-history-row.ts` — shared Drizzle column projection + mapper

## Multi-getUser() antipattern (HIGH finding from review)

**Each of the four server functions calls `supabase.auth.getUser()` independently.** For a single initial tab open this generates 4 GoTrue round-trips; load-more generates 2. The sub-functions are standalone-testable but pay a latency cost when orchestrated. The correct fix is to authenticate once at the orchestrator and pass `userId` as a plain parameter to sub-functions.

**Pattern to flag:** Any orchestrator that calls multiple sub-functions each holding their own `supabase.auth.getUser()` call. This is a HIGH performance finding, not a security defect.

## Couple-safe projection (LGPD-13.03)

The `sessionHistoryColumns` projection in `session-history-row.ts` exposes only:
```ts
isCouple: sql<boolean>`(${sessions.patientIds} is not null)`,
```
Never the partner UUID or name. The correlated reschedule subquery also carries `and orig.user_id = ${sessions.userId}` to prevent cross-tenant subquery results.

Integration test at `get-patient-session-history-list.int.test.ts:L485-L489` asserts:
```ts
expect(JSON.stringify(row)).not.toContain(partnerId);
```

## Audit log design (LGPD-13.01)

- Written by service-role `db` client (never the RLS-scoped supabase client)
- `audit_log` table has NO authenticated INSERT policy — prevents user from forging their own trail
- Written on initial open (cursor absent) only; NOT on load-more calls
- Carries only identifiers: `user_id`, `resource_id`, `resource_type`, `action` — no patient name or clinical text
- Best-effort: write failure is logged (no PII) and swallowed so the read is never blocked

## Keyset cursor security

`decodeSessionHistoryCursor` in `session-history-cursor.ts`:
- Returns `null` for invalid base64, invalid JSON, missing fields, non-ISO date
- A tampered cursor falls back to first page silently
- Owner predicate still applied unconditionally — tampered cursor can't leak cross-tenant rows

## Hybrid client/server filter (D5)

`useSessionHistoryFilter` hook in `hooks/use-session-history-filter.ts`:
- `<= 50 loaded` → client-side filter (no refetch, stable query key)
- `> 50 loaded` → server-side filter via status param in query key (causes refetch + pagination reset)
- The future session is OUTSIDE the filter — always visible regardless of active chip

## focusSession deep-link

- Agenda page reads `?focusSession=` from searchParams
- `getSessionByIdImpl` validates ownership server-side (getUser() + userId predicate)
- A tampered/wrong id returns `not_found` and the calendar falls back to "today"
- MISSING: UUID format pre-validation before the DB call (a non-UUID string triggers a Postgres error + noisy log)
- Fix: `z.string().uuid().optional().safeParse(focusSessionId)` before calling the impl

## Test isolation pattern

`SEED_SESSION_HISTORY_USER` in `seed-state.ts` is a dedicated psychologist owning:
- `withHistory` patient: 14 done (1 evolved, 1 couple) + 1 cancelled + 1 no_show + 1 future = 16 history rows, page size 12
- `noHistory` patient: no sessions → empty state
- `partnerHidden`: never surfaced in card output

Integration cross-tenant test:
```ts
// userA reading userB's patientId must get empty results (0 sessions, 0 summary doneTotal)
```

## RLS posture

No new tables added in this change. All queries against `sessions`, `evolutions`, `locations` use the service-role `db` client with explicit `userId` predicates as defense-in-depth (the `audit_log` pattern is also used here for all history reads).

## Future-session time-bound (fix-session-history-future-leak, 2026-06)

**Bug fixed:** Original code only excluded the nearest future session by id (`ne(sessions.id, excludeSessionId)`). A recurrence with N future occurrences leaked N−1 sessions into the historical list.

**Fix:** Added `lt(sessions.startAt, sql\`now()\`)` as a predicate to `getPatientSessionHistoryList`. The id exclusion is retained as a race-safety belt only — it guards the narrow window where `now()` is evaluated at different instants by the two queries.

**Key pattern:** Both queries must use database-side `sql\`now()\`` (not a JS `Date`) for clock-source consistency. Any reviewer who sees a JS `Date` object used in the comparison here should flag it as a potential subtle bug.

**Regression test shape:** (a) seed 10+ future occurrences, pass `nearestId` as `excludeSessionId`, assert zero future ids appear; (b) seed an overdue `scheduled` session (`start_at` in past), assert it IS in history and is NOT returned by `getNearestFutureSession`.

**Known stale test:** The `EXPLAIN` block in the query-plan test (RNF-13.03) does not include `AND s.start_at < now()` after this fix. The index still covers the predicate; update the inline SQL when touching that test.

## How to apply

- When reviewing any multi-query orchestrator: count getUser() calls and flag if > 1 per request
- When reviewing couple sessions: verify projection never exposes patientIds array or partner data
- When reviewing search params → DB: confirm UUID format validation before the query
- When reviewing `getPatientSessionHistoryList`: verify the `lt(sessions.startAt, sql\`now()\`)` predicate is present; its absence is the recurrence leak bug
