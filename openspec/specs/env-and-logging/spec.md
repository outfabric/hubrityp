# env-and-logging Specification

## Purpose

Defines how HubrityP validates environment variables, exposes them safely to server vs client code, redacts sensitive data in logs, and provides Supabase auth helpers across all execution contexts. Created by archiving change `bootstrap-data-and-tests`.
## Requirements
### Requirement: Environment variables are validated at boot

The system SHALL parse `process.env` through Zod schemas under `src/shared/env/` and export two objects: `serverEnv` (full set, server-only) and `clientEnv` (only `NEXT_PUBLIC_*` keys). Validation MUST run on module load and throw with a descriptive error if any required variable is missing or malformed. The `src/shared/env/` module MUST expose a public barrel (e.g., `src/shared/env/index.ts`) that re-exports both objects so consumers import from `@/shared/env`.

#### Scenario: Missing required server var aborts boot

- **WHEN** the Next.js server starts with `SUPABASE_URL` (or any required server var) absent from `process.env`
- **THEN** `src/shared/env/` throws a Zod error naming the missing variable and the server fails to start

#### Scenario: Malformed URL is rejected

- **WHEN** `SUPABASE_URL` is set to a non-URL value
- **THEN** `src/shared/env/` throws a Zod error indicating the field that failed validation

#### Scenario: `serverEnv` is unreachable from the client bundle

- **WHEN** any client component imports `serverEnv` from `@/shared/env`
- **THEN** the build (or an ESLint rule) reports an error preventing the import

### Requirement: `process.env` access is centralized

The system SHALL forbid direct access to `process.env.*` outside the validated env modules under `src/shared/env/`. ESLint configuration MUST report any violation. The allow-list for direct access MUST cover only:

- `src/shared/env/**` (the validated modules themselves)
- `scripts/db-migrate.ts` (the relocated migration CLI)
- `drizzle.config.ts` (drizzle-kit config — needs `DATABASE_URL` at config-load time)
- Test setup files under `src/__tests__/integration/setup/**` and `src/__tests__/e2e/{seeded,real}/setup/**` (test runners need to set env before app code loads)

#### Scenario: Direct env access in feature code is blocked

- **WHEN** a contributor writes `process.env.SUPABASE_URL` in a file under `src/app/`, `src/modules/`, or `src/shared/` (other than `src/shared/env/`)
- **THEN** `npm run lint` reports an error

#### Scenario: Allow-list permits the relocated CLI

- **WHEN** `scripts/db-migrate.ts` reads `process.env.DATABASE_URL` directly
- **THEN** `npm run lint` passes (the file is on the allow-list)

### Requirement: `.env.example` lists every required variable

The system SHALL maintain `.env.example` listing every variable consumed by `src/shared/env/`, with a brief inline comment per variable describing its purpose.

#### Scenario: New variable forces example update

- **WHEN** a contributor adds a new key to `serverEnv` or `clientEnv` without updating `.env.example`
- **THEN** the integration test suite includes a check comparing the keys parsed by `src/shared/env/` against the keys present in `.env.example` and fails on mismatch

### Requirement: Pino logger redacts sensitive paths

The system SHALL provide a Pino logger at `src/shared/lib/logger.ts` configured with redaction paths that cover at minimum: `*.cpf`, `*.email`, `*.phone`, `*.password`, `*.token`, `*.jwt`, `headers.authorization`, `headers.cookie`, `body.message`, `transcription`, `note`. The logger level MUST be configurable via `serverEnv.LOG_LEVEL`.

#### Scenario: Logging an object with `email` redacts the value

- **WHEN** a developer calls `logger.info({ user: { email: 'paciente@example.com' } }, 'msg')`
- **THEN** the emitted log entry contains the user object with the email field replaced by the redaction marker (e.g., `[Redacted]`)

#### Scenario: Logging a token redacts the value

- **WHEN** a developer calls `logger.info({ token: 'eyJhbGc...' }, 'msg')`
- **THEN** the emitted log entry replaces the token value with the redaction marker

#### Scenario: Test environment silences the logger

- **WHEN** Vitest (unit or integration) runs
- **THEN** the logger level is `silent` and no log output appears in test stdout

### Requirement: Supabase auth helpers cover all execution contexts

The system SHALL provide three modules under `src/shared/supabase/`: `server.ts` (RSC + Server Actions), `client.ts` (`'use client'` components), and `middleware.ts` (Next.js root middleware). Each module MUST construct a Supabase client via `@supabase/ssr` and read `clientEnv.NEXT_PUBLIC_SUPABASE_URL` and `clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY` from `@/shared/env`.

#### Scenario: Server Component obtains session via `@/shared/supabase/server`

- **WHEN** a Server Component imports `createServerClient` from `@/shared/supabase/server` and calls `supabase.auth.getUser()`
- **THEN** the client is constructed using request cookies and returns the session if present

#### Scenario: Root middleware refreshes the session cookie

- **WHEN** any HTTP request is made to a route covered by `src/middleware.ts`
- **THEN** `@/shared/supabase/middleware.createMiddlewareClient` is used to refresh the session cookie and the response carries the updated cookie if applicable

