## MODIFIED Requirements

### Requirement: Integration test runner is operational

The system SHALL provide an `npm run test:integration` script backed by a separate Vitest configuration (`vitest.integration.config.ts`) that boots a Postgres container via Testcontainers and applies Drizzle migrations before any test runs. Integration test files MUST live under `src/__tests__/integration/`, MUST use the suffix `*.int.test.ts`, and MUST NOT be picked up by the unit runner.

#### Scenario: Integration runner discovers `.int.test.ts` files

- **WHEN** a developer runs `npm run test:integration`
- **THEN** Vitest discovers files matching `src/__tests__/integration/**/*.int.test.ts` and runs them against a Testcontainers-managed Postgres

#### Scenario: Unit runner ignores integration tests

- **WHEN** a developer runs `npm run test:unit`
- **THEN** files under `src/__tests__/integration/` are not executed

#### Scenario: First run boots the container in under 30 seconds on a warm cache

- **WHEN** `npm run test:integration` runs after at least one prior run on the same machine
- **THEN** the Testcontainers Postgres container boots within ~10 seconds (with `.withReuse()`)

### Requirement: Migrations are applied before tests run

The system SHALL apply all Drizzle migrations under `src/shared/db/migrations/` to the test database in the Vitest `globalSetup` before any test file executes. The `globalSetup` MUST live at `src/__tests__/integration/setup/global-setup.ts` and MUST consume the shared Postgres container module from `src/__tests__/e2e/_shared/postgres-container.ts` (the same module the seeded e2e suite uses).

#### Scenario: Schema is present at test start

- **WHEN** the first integration test runs
- **THEN** querying `information_schema.tables` for `health_pings` returns the row, and RLS is already enabled

#### Scenario: Failure to migrate aborts the suite

- **WHEN** a migration in `src/shared/db/migrations/` contains invalid SQL
- **THEN** `globalSetup` fails and Vitest exits with a non-zero code without running any test

#### Scenario: Postgres container module is shared with seeded e2e

- **WHEN** the integration `globalSetup` boots Postgres
- **THEN** it imports `bootPostgres` and `applyMigrations` from `@/__tests__/e2e/_shared/postgres-container`; the seeded e2e `globalSetup` imports from the same module

### Requirement: RLS-aware connection helpers exist

The system SHALL provide helpers `runAsUser(jwt)` and `runAsService()` under `src/__tests__/integration/setup/`. `runAsUser` MUST set the connection's `request.jwt.claims` so that RLS policies treat the connection as that user. `runAsService` MUST open a connection that bypasses RLS for fixture setup.

#### Scenario: `runAsUser` enforces RLS

- **WHEN** a test calls `await runAsUser(userA, db => db.select().from(healthPings))`
- **THEN** the query returns only rows where `owner_id = userA`

#### Scenario: `runAsService` bypasses RLS

- **WHEN** a test calls `await runAsService(db => db.insert(healthPings).values({ ownerId: userA, ... }))`
- **THEN** the insert succeeds regardless of any policy `WITH CHECK` clause

### Requirement: Typed factories generate valid rows

The system SHALL provide at least one factory under `src/__tests__/integration/factories/` that constructs valid `health_pings` insert payloads. The factory MUST derive its types from the Drizzle schema so that schema changes surface as type errors in tests.

#### Scenario: Factory output type-checks against the schema

- **WHEN** a test calls `healthPingFactory.build({ ownerId: userA })` and inserts the result via Drizzle
- **THEN** the call type-checks and the row is accepted by the database

#### Scenario: Schema change surfaces as a type error

- **WHEN** a contributor renames a column in `src/shared/db/schema/health/tables.ts`
- **THEN** any factory that referenced the old column name fails `npm run typecheck`

### Requirement: A working RLS test ships in this wave

The system SHALL include at least one integration test under `src/__tests__/integration/` asserting that the owner-scoped RLS policy on `health_pings` blocks cross-owner reads, allows owner reads, and permits service-role reads.

#### Scenario: RLS test exists and passes

- **WHEN** `npm run test:integration` runs against the merged change
- **THEN** the RLS test for `health_pings` passes, demonstrating all three behaviors (owner allowed, non-owner blocked, service-role bypass)
