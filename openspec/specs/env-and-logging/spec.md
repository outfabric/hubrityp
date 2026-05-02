# env-and-logging Specification

## Purpose

Defines how HubrityP validates environment variables, exposes them safely to server vs client code, redacts sensitive data in logs, and provides Supabase auth helpers across all execution contexts. Created by archiving change `bootstrap-data-and-tests`.

## Requirements

### Requirement: Environment variables are validated at boot

The system SHALL parse `process.env` through Zod schemas in `lib/env.ts` and export two objects: `serverEnv` (full set, server-only) and `clientEnv` (only `NEXT_PUBLIC_*` keys). Validation MUST run on module load and throw with a descriptive error if any required variable is missing or malformed.

#### Scenario: Missing required server var aborts boot

- **WHEN** the Next.js server starts with `SUPABASE_URL` (or any required server var) absent from `process.env`
- **THEN** `lib/env.ts` throws a Zod error naming the missing variable and the server fails to start

#### Scenario: Malformed URL is rejected

- **WHEN** `SUPABASE_URL` is set to a non-URL value
- **THEN** `lib/env.ts` throws a Zod error indicating the field that failed validation

#### Scenario: `serverEnv` is unreachable from the client bundle

- **WHEN** any client component imports `serverEnv` from `lib/env`
- **THEN** the build (or an ESLint rule) reports an error preventing the import

### Requirement: `process.env` access is centralized

The system SHALL forbid direct access to `process.env.*` outside `lib/env.ts`. ESLint configuration MUST report any violation.

#### Scenario: Direct env access in feature code is blocked

- **WHEN** a contributor writes `process.env.SUPABASE_URL` in a file under `app/`, `components/`, or `lib/` (other than `lib/env.ts`)
- **THEN** `npm run lint` reports an error

### Requirement: `.env.example` lists every required variable

The system SHALL maintain `.env.example` listing every variable consumed by `lib/env.ts`, with a brief inline comment per variable describing its purpose.

#### Scenario: New variable forces example update

- **WHEN** a contributor adds a new key to `serverEnv` or `clientEnv` without updating `.env.example`
- **THEN** the integration test suite includes a check comparing the keys parsed by `lib/env.ts` against the keys present in `.env.example` and fails on mismatch

### Requirement: Pino logger redacts sensitive paths

The system SHALL provide a Pino logger in `lib/logger.ts` configured with redaction paths that cover at minimum: `*.cpf`, `*.email`, `*.phone`, `*.password`, `*.token`, `*.jwt`, `headers.authorization`, `headers.cookie`, `body.message`, `transcription`, `note`. The logger level MUST be configurable via `serverEnv.LOG_LEVEL`.

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

The system SHALL provide three modules under `lib/supabase/`: `server.ts` (RSC + Server Actions), `client.ts` (`'use client'` components), and `middleware.ts` (Next.js root middleware). Each module MUST construct a Supabase client via `@supabase/ssr` and read `clientEnv.NEXT_PUBLIC_SUPABASE_URL` and `clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY`.

#### Scenario: Server Component obtains session via `lib/supabase/server`

- **WHEN** a Server Component imports `createServerClient` from `lib/supabase/server` and calls `supabase.auth.getUser()`
- **THEN** the client is constructed using request cookies and returns the session if present

#### Scenario: Root middleware refreshes the session cookie

- **WHEN** any HTTP request is made to a route covered by `middleware.ts`
- **THEN** `lib/supabase/middleware.createMiddlewareClient` is used to refresh the session cookie and the response carries the updated cookie if applicable

#### Scenario: Middleware does not redirect in this wave

- **WHEN** an unauthenticated request hits any route during wave 2
- **THEN** the middleware returns the response unchanged (no redirect) — auth gating is introduced in wave 3
