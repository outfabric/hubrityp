# e2e-auth-real-suite Specification

## Purpose
Define the dedicated Playwright suite that exercises the full sign-in /
sign-out handshake against a real Supabase stack started via `supabase start`,
keeping it isolated from the default Postgres-only e2e suite both at runtime
and in CI. Created by archiving change `smoke-health-feature`.

## Requirements

### Requirement: Separate Playwright suite exercises real GoTrue handshake

The system SHALL provide a Playwright invocation distinct from the default e2e suite that runs against a real Supabase stack started via `supabase start` and validates the full sign-in / sign-out handshake against GoTrue.

#### Scenario: Suite runs against `supabase start`, not Testcontainers

- **WHEN** the `@auth-real` suite executes
- **THEN** the test target is the local Supabase stack started via `supabase start` (not the Postgres-only Testcontainers used by the default suite)

#### Scenario: npm script invokes the dedicated config

- **WHEN** a developer runs `npm run test:e2e:real`
- **THEN** Playwright loads `playwright.auth-real.config.ts` (or equivalent) and only executes tests under `e2e-auth-real/`

### Requirement: User is seeded via Supabase Admin API

The system SHALL seed the test user for the `@auth-real` suite via `supabase.auth.admin.createUser` (with `email_confirm: true`) inside the suite's `globalSetup`. The credentials MUST be exposed to the test as fixture data.

#### Scenario: Setup creates a confirmed user

- **WHEN** `globalSetup` runs
- **THEN** a user with a known email and password exists in `auth.users` with `email_confirmed_at` set, and the credentials are made available to the Playwright fixture context

#### Scenario: Setup is idempotent

- **WHEN** the suite runs twice in a row against the same `supabase start` instance
- **THEN** both runs succeed without manual cleanup (e.g., the setup deletes any prior user with the same email before creating a fresh one)

### Requirement: Full real-auth flow is covered

The system SHALL include at least one Playwright test in `e2e-auth-real/` tagged `@auth-real` that performs the complete login → dashboard → logout flow against the real stack.

#### Scenario: Full handshake passes

- **WHEN** the test runs
- **THEN** the following sequence completes successfully: visit `/login`, fill the form with the seeded credentials, submit, observe redirect to `/dashboard`, observe the greeting element with the seeded email, click logout, observe redirect to `/login`

#### Scenario: Failure produces an HTML report

- **WHEN** any step in the flow fails
- **THEN** Playwright writes an HTML report under `playwright-report-auth-real/` and the workflow uploads it as an artifact

### Requirement: CI runs the real suite as a gated job

The system SHALL extend `.github/workflows/ci.yml` with a new job `e2e-real` that depends on the `e2e` job passing. The job MUST start `supabase start`, run `npm run test:e2e:real`, and stop Supabase in a `if: always()` step.

#### Scenario: e2e-real runs only after e2e passes

- **WHEN** the `e2e` job fails on a PR
- **THEN** `e2e-real` does not run

#### Scenario: e2e-real cleans up Supabase on failure

- **WHEN** the test step in `e2e-real` fails
- **THEN** the workflow still runs `supabase stop` to release Docker resources

#### Scenario: PR cannot merge without e2e-real green

- **WHEN** branch protection on `main` is configured to require `e2e-real`
- **THEN** a PR with a failing `e2e-real` job cannot be merged

### Requirement: Tag registry reflects the active suite

The system SHALL update `e2e/tags.json` so that the `@auth-real` entry's description marks it as active in this wave (no longer "reserved for wave 3").

#### Scenario: Registry marks @auth-real active

- **WHEN** a contributor reads `e2e/tags.json` after this wave merges
- **THEN** the entry for `@auth-real` describes it as the dedicated real-GoTrue suite, not as reserved
