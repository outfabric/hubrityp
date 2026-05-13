## 1. Shared DB Fixture

- [x] 1.1 Create `src/__tests__/e2e/seeded/setup/db-fixture.ts` — Playwright fixture via `test.extend()` that reads `databaseUrl` from `seed-state.json`, exposes a `db` object with a `postgres.js` connection, and provides a `resetSession(sessionId, overrides)` helper that runs an UPDATE resetting status, cancellation fields, confirmed_at, updated_at, and deleted_at
- [x] 1.2 Add `resetSessionHistory(sessionId)` helper to the fixture — deletes all session_history rows for the session except the original "created" entry, so history assertions start clean

## 2. Fix Agenda Tests — Session Reset

- [x] 2.1 `session-cancel.spec.ts` — import `{ test, expect }` from `db-fixture`, add `beforeEach` that calls `db.resetSession(SEED_SESSIONS.cancellable.id, { status: 'scheduled' })` and `db.resetSessionHistory(SEED_SESSIONS.cancellable.id)`
- [x] 2.2 `session-mark-done.spec.ts` — import from `db-fixture`, add `beforeEach` that resets `SEED_SESSIONS.confirmedForDone` to `{ status: 'confirmed', confirmed_at: now() }`
- [x] 2.3 `session-no-show.spec.ts` — import from `db-fixture`, add `beforeEach` that resets `SEED_SESSIONS.forNoShow` to `{ status: 'scheduled' }`
- [x] 2.4 `session-edit-lock.spec.ts` — import from `db-fixture`, add `beforeEach` that resets `SEED_SESSIONS.lockedDone` to `{ status: 'done', updated_at: now() - 8 days }`

## 3. Fix Agenda Tests — Locator Disambiguation

- [x] 3.1 `session-edit-lock.spec.ts` — add `.filter({ hasText: '20:00' })` to the done chip locator to disambiguate from other João Santos done chips that may exist after parallel test runs

## 4. Fix Patient Listing Tests — Suspense Wait

- [x] 4.1 `patient-listing.spec.ts` `beforeEach` — replace bare `page.goto('/pacientes')` with `goto` + `await expect(page.getByTestId('patient-list').or(page.getByTestId('patient-list-empty'))).toBeVisible()`

## 5. Fix Patient Listing Tests — Deterministic Assertions

- [x] 5.1 Rewrite test L39 ("empty state renders when no patients exist") — since seed always has 2 active patients, change to verify `patient-list` is visible with at least 2 patient rows/cards. Remove the impossible empty-state branch.
- [x] 5.2 Rewrite test L56 ("+ Novo Paciente button") — replace `.isVisible().catch(() => false)` with direct `await expect(page.getByTestId('patient-add-button')).toBeVisible()`
- [x] 5.3 Rewrite test L68 ("search input") — remove conditional `if (hasList)` guard, replace with direct assertions since Suspense wait in beforeEach guarantees the list is rendered
- [x] 5.4 Review remaining tests in the file (L83 status filter, L116 seeded data, L143 search filters, L166 pagination) — apply same pattern: remove `.isVisible().catch(() => false)` and conditional guards where state is deterministic

## 6. Validation

- [x] 6.1 Run `npm run test:e2e:seeded -- --grep "@agenda"` locally and verify all 4 agenda tests pass (including with `--retries 2`)
- [x] 6.2 Run `npm run test:e2e:seeded -- --grep "@patients"` locally and verify all patient-listing tests pass consistently (run 3x to check for flakiness)
