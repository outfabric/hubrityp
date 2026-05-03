# e2e-test-stack Specification

## Purpose

Defines how HubrityP runs end-to-end browser tests against the built application, provisions a Postgres + seed via Testcontainers in `globalSetup`, reuses an authenticated `storageState`, and registers tag namespaces for filtering. Created by archiving change `bootstrap-data-and-tests`.

## Requirements

### Requirement: Playwright e2e runner is operational

The system SHALL provide an `npm run test:e2e` script backed by `playwright.config.ts` that builds the Next.js application and starts a production server before running any test. The configuration MUST register `chromium` as the only browser project in this wave.

#### Scenario: E2E runner starts the app and runs tests

- **WHEN** a developer runs `npm run test:e2e` against a clean checkout (with browsers installed)
- **THEN** Playwright spawns `npm run build && npm run start`, waits for the app to respond on `http://localhost:<port>`, runs every `*.spec.ts` under `e2e/`, and shuts the server down on completion

#### Scenario: Chromium-only project in this wave

- **WHEN** a developer reads `playwright.config.ts`
- **THEN** the `projects` array contains exactly one entry for `chromium` (Firefox/WebKit are explicitly out of scope)

#### Scenario: Browser binary is documented

- **WHEN** a new contributor reads `README.md`
- **THEN** the document instructs `npx playwright install --with-deps chromium` as a one-time setup step

### Requirement: E2E `globalSetup` provisions a Postgres container

The system SHALL boot a Testcontainers Postgres in the Playwright `globalSetup`, apply Drizzle migrations, and seed the minimum data required by the smoke test (one user in `auth.users` and one `health_ping` row).

#### Scenario: Test sees a populated database

- **WHEN** the smoke e2e test queries the application's `/api/health` endpoint
- **THEN** the response indicates a successful database ping against the seeded schema

#### Scenario: Container is torn down after the run

- **WHEN** `npm run test:e2e` exits (success or failure)
- **THEN** the Testcontainers-managed container is stopped and removed via `globalTeardown`

### Requirement: Auth state is reusable via `storageState`

The system SHALL provide an `e2e/auth.setup.ts` project that performs a programmatic signin by writing the simulated `supabase.auth.token` cookie into a `storageState` file. Tests requiring an authenticated session MUST load that state via `test.use({ storageState })`.

#### Scenario: Auth setup runs before authenticated tests

- **WHEN** Playwright executes a test that depends on the `auth-setup` project
- **THEN** the dependent test starts with the `storageState` cookies pre-populated

#### Scenario: Smoke test in this wave is anonymous

- **WHEN** the wave-2 smoke test runs
- **THEN** it does not require `storageState` and succeeds without any session

### Requirement: Tag registry exists at `e2e/tags.json`

The system SHALL maintain `e2e/tags.json` as a JSON object mapping tag names to short descriptions. The registry MUST include at minimum `@health` (active) and reserve `@auth` and `@auth-real` (the latter explicitly noted as introduced in wave 3).

#### Scenario: Registry lists active and reserved tags

- **WHEN** a contributor reads `e2e/tags.json` after wave 2 merges
- **THEN** the file contains `@health`, `@auth`, and `@auth-real` keys with one-line descriptions

#### Scenario: A test can be filtered by tag

- **WHEN** a developer runs `npx playwright test --grep @health`
- **THEN** only tests whose `test.describe` title contains `@health` execute

### Requirement: A passing smoke e2e ships in this wave

The system SHALL include at least one passing Playwright test (`e2e/smoke.spec.ts` or equivalent) tagged `@health` that visits `/` and asserts a 200 response and the placeholder content.

#### Scenario: Smoke test passes against the built app

- **WHEN** `npm run test:e2e` runs after wave 2 merges
- **THEN** the smoke test passes, demonstrating the entire pipeline (Testcontainers boot, migrations, app build, app serve, browser navigate, assertion)

### Requirement: Reusable mock GoTrue helper at `lib/test-utils/mock-gotrue.ts`

The system SHALL expose a reusable, in-process mock GoTrue server as a module at
`lib/test-utils/mock-gotrue.ts`. The module MUST export a function `startMockGotrue` (or an
equivalent named export) whose return value, after awaiting, exposes at minimum:

- `port: number` — the port the mock GoTrue is listening on. The implementation MUST default
  to `54321` (the same port a local `supabase start` exposes) so that one Next.js build
  artifact, with `NEXT_PUBLIC_SUPABASE_URL` inlined at build time, can serve both the
  default e2e suite (mock GoTrue) and the `@auth-real` suite (real Supabase) without
  rebuilding.
- `stop(): Promise<void>` — a function that releases the listening socket. After `stop()`
  resolves, the same port MUST be re-bindable.
- `jwt: string` — a valid JWT that the mock will accept on `/auth/v1/user` requests. The
  same JWT MUST be acceptable to a Supabase server-side client created with the mock's
  configuration so that `supabase.auth.getUser()` returns a non-null user.

The mock MUST respond to at least the endpoints `supabase-js` touches during a server-side
`getUser()` flow (`/auth/v1/user`, `/auth/v1/token`) and SHOULD be small enough that future
e2e suites can reach for it without copy-paste.

The existing wrapper `e2e/start-server.ts` MUST import the helper from
`lib/test-utils/mock-gotrue.ts` (the previous `e2e/mock-gotrue.ts` location is removed).

#### Scenario: `startMockGotrue` returns a valid handle

- **WHEN** a test calls `await startMockGotrue()`
- **THEN** the returned object exposes a numeric `port`, a `stop` async function, and a
  `jwt` string with a valid three-segment JWT shape

#### Scenario: `stop()` releases the listening socket

- **WHEN** a test calls `startMockGotrue()` and later awaits the returned `stop()`
- **THEN** a subsequent call to `startMockGotrue()` on the same port succeeds without an
  `EADDRINUSE` error

#### Scenario: `getUser()` succeeds against the mock

- **WHEN** a Supabase server-side client is configured against the mock's URL with the
  helper's `jwt` set as the access token cookie
- **THEN** `supabase.auth.getUser()` returns a user object (not `null`) and does not throw

#### Scenario: e2e auth suite uses the relocated helper

- **WHEN** `npm run test:e2e -- --grep @auth` runs after this change merges
- **THEN** the suite starts (driven by `e2e/start-server.ts` importing the helper from
  `lib/test-utils/mock-gotrue.ts`) and the existing `@auth` cases pass without a
  copy-pasted local mock under `e2e/`
