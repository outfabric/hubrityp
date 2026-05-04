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

### Requirement: `profiles`, `auth_logs`, and `auth_sessions` tables are defined under the `auth` schema domain

The system SHALL define three new tables in `src/shared/db/schema/auth/tables.ts` (creating the `auth` domain folder under `src/shared/db/schema/`): `profiles`, `auth_logs`, `auth_sessions`. The barrel `src/shared/db/schema/index.ts` MUST re-export each new table so Drizzle's relational API and the runtime client see them. RLS policy SQL MUST live in `src/shared/db/schema/auth/policies.ts` (raw SQL strings) so that the policy-lint integration test (Requirement: "Owner-scoped RLS template is documented and enforced") sees the matching policies for every new table.

The `profiles` table MUST have:

- `userId UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE` (PK = FK; no separate `id`).
- `email TEXT NOT NULL` (mirror of `auth.users.email` for query convenience; kept in sync by the trigger).
- `fullName VARCHAR(120) NOT NULL`.
- `crpNumber VARCHAR(20) NOT NULL`.
- `crpUf CHAR(2) NOT NULL`.
- `crpValidatedAt TIMESTAMPTZ`.
- `crpValidatedBy UUID` (admin who validated; nullable until validated).
- `emailVerifiedAt TIMESTAMPTZ`.
- `status TEXT NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification','pending_crp_validation','active','suspended','cancelled'))`.
- `termsAcceptedAt TIMESTAMPTZ NOT NULL`.
- `privacyAcceptedAt TIMESTAMPTZ NOT NULL`.
- `sensitiveDataConsentAt TIMESTAMPTZ NOT NULL`.
- `createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- `updatedAt TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- `UNIQUE (crpNumber, crpUf)`.

The `auth_logs` table MUST have:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- `userId UUID REFERENCES auth.users(id) ON DELETE SET NULL` (nullable for failed signups).
- `event TEXT NOT NULL`.
- `ip INET`.
- `userAgent TEXT`.
- `metadata JSONB NOT NULL DEFAULT '{}'::jsonb`.
- `createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- Index on `(userId, event, createdAt DESC)` for audit queries.

The `auth_sessions` table MUST have:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- `userId UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`.
- `ip INET`.
- `userAgent TEXT`.
- `expiresAt TIMESTAMPTZ NOT NULL`.
- `revokedAt TIMESTAMPTZ`.
- `createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- Index on `(userId, createdAt DESC)`.

#### Scenario: Drizzle schema barrel exposes the new tables

- **WHEN** any file imports from `@/shared/db/schema`
- **THEN** the named exports include `profiles`, `authLogs`, `authSessions` (camelCase Drizzle handles), and the runtime client sees them via the relational API

#### Scenario: `profiles` enforces unique CRP per UF

- **WHEN** an INSERT into `profiles` carries the same `(crpNumber, crpUf)` pair as an existing row
- **THEN** Postgres raises a unique-constraint violation that the `signUp` Server Action maps to `duplicate_crp`

#### Scenario: `profiles.status` rejects unknown values

- **WHEN** an UPDATE attempts to set `status = 'frozen'` (a value not in the enum)
- **THEN** the `CHECK` constraint rejects the write

#### Scenario: `profiles` cascades when `auth.users` row is deleted

- **WHEN** a row in `auth.users` is deleted (e.g., via `supabase.auth.admin.deleteUser` during the duplicate-CRP rollback)
- **THEN** the matching row in `profiles` is removed by the `ON DELETE CASCADE` foreign key

### Requirement: Database trigger creates `profiles` row on `auth.users` insert

The system SHALL provide a SECURITY DEFINER function `public.handle_new_user()` and an `AFTER INSERT` trigger on `auth.users` that materializes a row in `public.profiles`. The function MUST read `raw_user_meta_data` from the new `auth.users` row to populate `fullName`, `crpNumber`, `crpUf`, `termsAcceptedAt`, `privacyAcceptedAt`, `sensitiveDataConsentAt` and MUST set `status = 'pending_verification'` and `email = NEW.email`. The function MUST run with `STRICT` ownership and write only to `profiles` (no other tables). The migration MUST commit the function with a stable owner so SECURITY DEFINER cannot be exploited by ownership flips.

#### Scenario: Signup via Supabase Auth produces a profile row

- **WHEN** `supabase.auth.signUp({ email, password, options: { data: { fullName, crpNumber, crpUf, ... } } })` succeeds
- **THEN** within the same transaction, `profiles` contains a row keyed by the new `auth.users.id` with the metadata fields populated and `status = 'pending_verification'`

#### Scenario: Trigger fails the signup if metadata is missing

- **WHEN** `supabase.auth.signUp` is called without the required metadata fields (e.g., `crpNumber` absent)
- **THEN** the trigger raises an exception, the entire transaction rolls back, and `auth.users` does not retain the partial signup

#### Scenario: Trigger fails on duplicate CRP

- **WHEN** the trigger attempts an INSERT that violates `UNIQUE (crpNumber, crpUf)`
- **THEN** the unique-constraint error propagates back to the Server Action so it can roll back the auth user via `supabase.auth.admin.deleteUser`

### Requirement: Database trigger transitions `profiles.status` on email verification

The system SHALL provide an `AFTER UPDATE` trigger on `auth.users` that observes a transition of `email_confirmed_at` from `NULL` to a non-null value and updates the matching `profiles.status` from `pending_verification` to `pending_crp_validation`. The same trigger MUST mirror `email_confirmed_at` into `profiles.emailVerifiedAt`. The trigger MUST be a no-op for users whose `profiles.status` is no longer `pending_verification` (idempotent).

#### Scenario: Email confirmation transitions status to `pending_crp_validation`

- **WHEN** Supabase Auth sets `auth.users.email_confirmed_at` to `NOW()` for a user whose `profiles.status = 'pending_verification'`
- **THEN** the trigger updates the same `profiles` row to `status = 'pending_crp_validation'` and sets `emailVerifiedAt` to the same timestamp

#### Scenario: Trigger is a no-op for already-active users

- **WHEN** Supabase Auth re-emits an UPDATE with `email_confirmed_at` already populated for a user whose `profiles.status = 'active'`
- **THEN** the trigger leaves `profiles.status` unchanged and does not error

### Requirement: RLS policies for new auth-domain tables

The system SHALL enable Row Level Security on `profiles`, `auth_logs`, and `auth_sessions` and declare the following policies in `src/shared/db/schema/auth/policies.ts` (raw SQL committed alongside the migration):

- `profiles`: `SELECT` and `UPDATE` allowed only when `user_id = auth.uid()`. No `INSERT` policy (only the SECURITY DEFINER trigger writes). No `DELETE` policy (account deletion is service-role only and out of scope here).
- `auth_logs`: `SELECT` allowed only when `user_id = auth.uid()`. No `INSERT`/`UPDATE`/`DELETE` policy (only the service role writes).
- `auth_sessions`: `SELECT` allowed only when `user_id = auth.uid()`. No `INSERT`/`UPDATE`/`DELETE` policy.

The migration MUST `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for each table and the policy-lint integration test MUST pass for each.

#### Scenario: User reads their own profile

- **GIVEN** a profile row with `user_id = userA`
- **WHEN** a query is executed with the JWT claims set to `sub = userA`
- **THEN** the row is returned

#### Scenario: User cannot read another user's profile

- **GIVEN** a profile row with `user_id = userA`
- **WHEN** a query is executed with the JWT claims set to `sub = userB`
- **THEN** the row is not returned (zero rows)

#### Scenario: User cannot update another user's profile

- **GIVEN** a profile row with `user_id = userA`
- **WHEN** an UPDATE is executed with the JWT claims set to `sub = userB` against the row owned by `userA`
- **THEN** Postgres reports zero rows updated and the row remains unchanged

#### Scenario: Direct INSERT into profiles is blocked for end-users

- **WHEN** a query is executed with the JWT claims set to `sub = userA` attempting `INSERT INTO profiles (user_id, ...) VALUES (userA, ...)`
- **THEN** the INSERT is rejected because no INSERT policy exists for end-users (only the trigger function writes)

#### Scenario: Direct INSERT into auth_logs is blocked for end-users

- **WHEN** a query is executed with the JWT claims set to `sub = userA` attempting `INSERT INTO auth_logs (...) VALUES (...)`
- **THEN** the INSERT is rejected (no policy permits user-side writes)

#### Scenario: Service-role bypass returns and writes everything

- **WHEN** queries are executed via the service-role client
- **THEN** SELECT returns all rows for `profiles`, `auth_logs`, `auth_sessions`, and INSERT/UPDATE succeed (RLS is bypassed for the service role)

### Requirement: `getCurrentProfile` is the canonical Drizzle read path for the active profile

The system SHALL expose `getCurrentProfile(supabase): Promise<Profile | null>` from `@/modules/registration` (its implementation lives there but the data layer's contract is that the function uses the configured Drizzle/Supabase client to perform a single PK lookup). The function MUST issue at most one SELECT against `profiles` for the active session and MUST return `null` for unauthenticated requests or for a session whose profile row does not exist yet.

#### Scenario: Returns `Profile` shape for active session

- **WHEN** the function is called for an authenticated user whose profile row exists
- **THEN** the resolved value contains `userId`, `email`, `fullName`, `crpNumber`, `crpUf`, `status`, `emailVerifiedAt`, `crpValidatedAt`, `termsAcceptedAt`, `privacyAcceptedAt`, `sensitiveDataConsentAt`, `createdAt`, `updatedAt`

#### Scenario: Returns `null` outside of the happy path

- **WHEN** the function is called with no Supabase session, or for a session whose `profiles` row is missing
- **THEN** the resolved value is `null` and no exception is thrown

#### Scenario: At most one SELECT per call

- **WHEN** the function executes
- **THEN** the underlying database receives at most one SELECT statement against `profiles` (no extra round trips for joins or counts)
