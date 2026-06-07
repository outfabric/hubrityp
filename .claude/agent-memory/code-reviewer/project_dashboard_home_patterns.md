---
name: project-dashboard-home-patterns
description: Dashboard home module patterns: aggregate read helpers, São Paulo timezone windows, Suspense streaming, first_access_at stamp, cross-tenant isolation tests, RLS bypass with manual WHERE scoping, component architecture.
metadata:
  type: project
---

## Dashboard module (`src/modules/dashboard/`) — reviewed 2026-06-03

### Architecture
- Four owner-scoped read helpers + `stampFirstAccess` write + six section components.
- No `edge.ts` needed (module not consumed by middleware.ts).
- `'use client'` only at leaf components: `DashboardSecondary` (mobile collapse + router.push) and `SectionActions` (onClick triggers).
- `WeeklySummarySlot` is a Suspense-streamed async Server Component that creates its OWN `createServerClient()` — does not share the parent page's client. This is the correct pattern when a component streams independently.

### Security pattern: db bypasses RLS, manual WHERE scoping is the defense
All helpers import `db` from `@/shared/db/client` (Drizzle/postgres-js direct connection, bypasses RLS). This is the established codebase pattern. Security contract:
1. `supabase.auth.getUser()` first — returns `UnauthorizedResult` if null.
2. Every query WHERE clause includes `eq(table.userId, userId)` from `getUser()` result.
3. No caller-supplied IDs accepted anywhere.
Pattern is verified by cross-tenant integration tests in all four helpers.

### Cross-tenant join safety
`getTodaySessions` does `sessions LEFT JOIN patients ON sessions.patient_id = patients.id` WITHOUT a `patients.user_id = userId` filter. This is safe because:
- `sessions` INSERT RLS: `WITH CHECK (auth.uid() = user_id)` — prevents cross-tenant session creation.
- FK `sessions.patient_id → patients(id)` ON DELETE SET NULL.
- Application logic only offers owned patients when creating sessions.
So `sessions.patient_id` can only reference patients owned by the same `user_id`.

### São Paulo timezone windows (`lib/sao-paulo-windows.ts`)
- Pattern: `formatInTimeZone(now, SP_TZ, 'yyyy-MM-dd')` → string → `fromZonedTime(str, SP_TZ)` — avoids the double-shift DST pitfall.
- Noon anchor in `startOfSaoPauloDayShifted` prevents DST from flipping the target calendar date.
- `startOfNextSaoPauloWeek` correctly passes `weekStart` (not `now`) to `startOfSaoPauloDayShifted`; this is safe because `dayStart = startOfSaoPauloDay(weekStart)` is idempotent when `weekStart` is already a day start.

### Known behavioral quirk to flag in future reviews
`getWeeklySummary`'s "new patients this month" count does NOT filter `archivedAt IS NULL`. A patient created + archived in the same month inflates the count. This is inconsistent with `getPendencias` which DOES filter `isNull(patients.archivedAt)`. Flagged as 🟠 HIGH.

### fire-and-forget stampFirstAccess
`void stampFirstAccess(supabase).catch(() => {})` in the page — silently swallows failures. Future reviews: nudge toward `catch((err) => logger.warn(..., 'stamp_first_access_failed'))` so silent NPS anchor misses are visible.

### Test patterns
- Integration tests: `fakeSupabaseClient(userId)` returns a static fake `getUser()` that returns the userId. This bypasses GoTrue but exercises the real Drizzle queries against the real Testcontainers Postgres. Cross-user isolation tests seed two auth.users rows and call the helper as each user separately.
- `cleanTestData()` called in beforeAll/afterEach/afterAll (FK-ordered cascade cleaner).
- `weekAnchor(offsetHours)` helper anchors sessions to noon of the current SP week's Monday — prevents week-rollover flakes.
- E2E: zero-data user (`SEED_DASHBOARD_EMPTY_USER`) is a second active psychologist seeded in `global-setup.ts`; the spec registers it with mock GoTrue at runtime via `POST /_test/register-oauth-user` and builds the Supabase cookie manually.

### LGPD data minimization
`PendenciasResult` carries only counts + static href strings — no patient names, session IDs, evolution content. Integration test asserts the EXACT key set and verifies no clinical string appears in the serialized result.

### middleware.ts classifyPath coverage
`/dashboard` prefix was already in `APP_PREFIXES` before this change — no update needed. Verified the route continues to gate correctly.

**Why:** [[project_auth_hardening_patterns]]
