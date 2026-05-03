# data-layer Specification

## Purpose

Defines how HubrityP organizes its Postgres schema, generates and applies migrations, and enforces Row Level Security so that every owner-scoped table follows the same auditable pattern. Created by archiving change `bootstrap-data-and-tests`.
## Requirements
### Requirement: Drizzle schema is organized by domain

The system SHALL organize Drizzle schema files under `src/shared/db/schema/<domain>/` with at minimum `tables.ts` (table definitions) and, when applicable, `policies.ts` (raw SQL strings for RLS policies). A barrel `src/shared/db/schema/index.ts` MUST re-export all tables for use with Drizzle's relational API and queries.

#### Scenario: Domain folder structure is followed

- **WHEN** a contributor adds a new table for any future domain
- **THEN** the table definition lives in `src/shared/db/schema/<new-domain>/tables.ts`, the corresponding RLS policy SQL lives in `src/shared/db/schema/<new-domain>/policies.ts`, and the barrel `src/shared/db/schema/index.ts` re-exports the new table

#### Scenario: Example domain (`health`) ships in this wave

- **WHEN** a contributor reads the codebase after this change merges
- **THEN** `src/shared/db/schema/health/tables.ts` defines a `health_pings` table with columns `id` (uuid pk), `owner_id` (uuid → auth.users), `created_at` (timestamptz), and `note` (text), and `src/shared/db/schema/health/policies.ts` declares owner-scoped RLS policy SQL

### Requirement: Migrations are generated and committed

The system SHALL provide npm scripts `db:generate`, `db:migrate`, and `db:push` (for prototyping) backed by `drizzle-kit`. `drizzle.config.ts` MUST point `schema` at `src/shared/db/schema` and `out` at `src/shared/db/migrations`. Generated SQL migrations MUST be committed under `src/shared/db/migrations/`. Every migration that creates a table MUST include the matching RLS policy SQL for that table. The migration runner script MUST live at `scripts/db-migrate.ts` (`npm run db:migrate` invokes `tsx scripts/db-migrate.ts`).

#### Scenario: Generate produces a migration file

- **WHEN** a developer modifies a schema file and runs `npm run db:generate`
- **THEN** drizzle-kit writes a new SQL file under `src/shared/db/migrations/` describing the diff

#### Scenario: Migrate applies pending migrations via the relocated script

- **WHEN** a developer runs `npm run db:migrate` against an empty local database
- **THEN** `tsx scripts/db-migrate.ts` runs and all migrations under `src/shared/db/migrations/` are applied in order; the database schema matches `src/shared/db/schema/`

#### Scenario: Initial migration enables RLS and policies for `health_pings`

- **WHEN** a developer applies the initial migration to a fresh database and runs `\d+ health_pings` (or equivalent)
- **THEN** the table exists, RLS is enabled, and the four owner-scoped policies (select/insert/update/delete) are present

### Requirement: Owner-scoped RLS template is documented and enforced

The system SHALL document, in code comments and in `src/shared/db/migrations/README.md`, the canonical RLS template for owner-scoped tables (the four policies keyed off `auth.uid() = owner_id`). A test in the integration suite MUST assert that every table referenced by `src/shared/db/schema/**/tables.ts` has at least one corresponding `CREATE POLICY ... ON <table>` line in `src/shared/db/migrations/**`.

#### Scenario: New table without policies fails the lint test

- **WHEN** a contributor adds a table to `src/shared/db/schema/<domain>/tables.ts` and runs `npm run test:integration` without adding the matching RLS SQL to a migration
- **THEN** the policy lint test fails with a message naming the table that is missing policies

#### Scenario: Owner-scoped table with all four policies passes

- **WHEN** the test runs against the initial migration set
- **THEN** the test passes because `health_pings` has all four policies declared

### Requirement: RLS blocks cross-owner reads on `health_pings`

The system SHALL enforce that a user can only read their own rows in `health_pings` when the connection is authenticated as that user via Supabase Auth.

#### Scenario: Owner reads their own ping

- **GIVEN** a `health_ping` row inserted with `owner_id = userA`
- **WHEN** a query is executed with the JWT claims set to `sub = userA`
- **THEN** the row is returned

#### Scenario: Non-owner cannot read another user's ping

- **GIVEN** a `health_ping` row inserted with `owner_id = userA`
- **WHEN** a query is executed with the JWT claims set to `sub = userB`
- **THEN** the row is not returned (zero rows)

#### Scenario: Service-role bypass returns all rows

- **WHEN** a query is executed via the service-role client
- **THEN** all rows are returned regardless of ownership

### Requirement: Runtime Drizzle client lives at `src/shared/db/client.ts`

The system SHALL expose the runtime Drizzle client at `src/shared/db/client.ts` (replacing the prior `lib/db/index.ts`). Application code consuming the database MUST import from `@/shared/db/client`. The legacy `db/` directory at the repository root and the legacy `lib/db/` directory MUST NOT exist.

#### Scenario: Application code imports the client from the canonical path

- **WHEN** a Server Action or Route Handler queries the database
- **THEN** it imports the Drizzle client from `@/shared/db/client`; no consumer imports from `@/lib/db/*` or from a root-level `@/db/*`

#### Scenario: Drizzle config aligns with the relocated schema and migrations

- **WHEN** a developer reads `drizzle.config.ts`
- **THEN** the `schema` field points at `src/shared/db/schema` and the `out` field points at `src/shared/db/migrations`

