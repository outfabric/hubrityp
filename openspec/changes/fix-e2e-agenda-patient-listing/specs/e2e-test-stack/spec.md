## ADDED Requirements

### Requirement: E2E tests that mutate seeded data SHALL reset state before each attempt

Tests that change database state (e.g., session status transitions) SHALL reset the affected rows to their original seeded values in a `test.beforeEach` hook. The reset MUST use direct SQL via a shared Playwright fixture (`db`) that reads `databaseUrl` from `seed-state.json`. This ensures idempotency across Playwright retries (`retries: 2` in CI) and prevents inter-test contamination when running with `fullyParallel: true`.

#### Scenario: Session cancel test retries with clean state

- **WHEN** `session-cancel.spec.ts` fails on the first attempt and Playwright retries it
- **THEN** the `beforeEach` resets the `cancellable` session to `status='scheduled'` with all cancellation fields cleared before the retry runs

#### Scenario: Parallel tests do not contaminate each other's session state

- **WHEN** `session-mark-done.spec.ts` and `session-edit-lock.spec.ts` run in parallel workers
- **THEN** `session-edit-lock` finds only the seeded `lockedDone` chip because its locator filters by time (20:00) AND status badge, and `session-mark-done` operates on a different session (11:00)

### Requirement: E2E tests on pages with Suspense boundaries SHALL wait for content before asserting

Tests that navigate to pages using React Suspense streaming SHALL include an explicit wait for the Suspense boundary to resolve before running assertions. The wait MUST use Playwright's `expect().toBeVisible()` on a locator that matches the resolved content (e.g., `patient-list` OR `patient-list-empty`), NOT `page.waitForLoadState()` alone.

#### Scenario: Patient listing test waits for Suspense resolution

- **WHEN** `patient-listing.spec.ts` navigates to `/pacientes` in `beforeEach`
- **THEN** the hook waits until either `patient-list` or `patient-list-empty` test ID is visible before returning control to the test

#### Scenario: No silent test skip due to Suspense race

- **WHEN** patient listing tests run in CI with slower DB response times
- **THEN** every test runs its assertions (no vacuous `if (hasList)` skip) because the `beforeEach` guarantees the content is loaded

### Requirement: E2E assertions SHALL use Playwright auto-wait instead of manual visibility checks

Tests SHALL NOT use the pattern `.isVisible().catch(() => false)` to conditionally skip assertions. Instead, tests SHALL use `expect(locator).toBeVisible()` which includes Playwright's built-in auto-wait and retry mechanism. Conditional assertion blocks (`if (hasList) { ... }`) that can silently skip all assertions SHALL be replaced with direct assertions when the test state is deterministic.

#### Scenario: Add button assertion is direct

- **WHEN** `patient-listing.spec.ts` tests the "+ Novo Paciente" button visibility
- **THEN** the test uses `await expect(page.getByTestId('patient-add-button')).toBeVisible()` directly, without `.catch(() => false)` wrapping

### Requirement: Shared Playwright fixture SHALL expose database access for test setup

The seeded E2E suite SHALL provide a Playwright fixture (`db`) via `test.extend()` that exposes a `postgres.js` connection to the Testcontainers database. Test files that need direct DB access for setup/teardown SHALL import `{ test, expect }` from the fixture module instead of `@playwright/test`.

#### Scenario: Test file uses db fixture for session reset

- **WHEN** `session-cancel.spec.ts` needs to reset the cancellable session before each test
- **THEN** it imports `{ test, expect }` from `../setup/db-fixture` and calls `await db.resetSession(SEED_SESSIONS.cancellable.id, { status: 'scheduled', ... })` in `beforeEach`
