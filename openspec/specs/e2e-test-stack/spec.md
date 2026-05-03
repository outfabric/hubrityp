# e2e-test-stack Specification

## Purpose

Defines how HubrityP runs end-to-end browser tests against the built application, provisions a Postgres + seed via Testcontainers in `globalSetup`, reuses an authenticated `storageState`, and registers tag namespaces for filtering. Created by archiving change `bootstrap-data-and-tests`.
## Requirements
### Requirement: Playwright e2e runner is operational

The system SHALL provide an `npm run test:e2e:seeded` script backed by `playwright.seeded.config.ts` that builds the Next.js application and starts a production server before running any test. The configuration MUST register `chromium` as the only browser project. The legacy `npm run test:e2e` script and the legacy `playwright.config.ts` filename MUST NOT exist; the seeded suffix is the canonical name and aligns with `test:e2e:real` / `playwright.real.config.ts`.

#### Scenario: E2E runner starts the app and runs tests

- **WHEN** a developer runs `npm run test:e2e:seeded` against a clean checkout (with browsers installed)
- **THEN** Playwright spawns the wrapper that boots Postgres + mock GoTrue and starts the Next.js production server, waits for the app to respond on `http://localhost:<port>`, runs every `*.spec.ts` under `src/__tests__/e2e/seeded/`, and shuts the server down on completion

#### Scenario: Chromium-only project

- **WHEN** a developer reads `playwright.seeded.config.ts`
- **THEN** the `projects` array contains exactly one entry for `chromium` (Firefox/WebKit are explicitly out of scope)

#### Scenario: Browser binary is documented

- **WHEN** a new contributor reads `README.md`
- **THEN** the document instructs `npx playwright install --with-deps chromium` as a one-time setup step

### Requirement: E2E `globalSetup` provisions a Postgres container

The system SHALL boot a Testcontainers Postgres in the seeded Playwright `globalSetup` (`src/__tests__/e2e/seeded/setup/global-setup.ts`), apply Drizzle migrations, and seed the minimum data required by the smoke test (one user in `auth.users` and one `health_ping` row). The `globalSetup` MUST consume the shared Postgres container module from `src/__tests__/e2e/_shared/postgres-container.ts` (the same module the integration runner uses).

#### Scenario: Test sees a populated database

- **WHEN** the smoke e2e test queries the application's `/api/health` endpoint
- **THEN** the response indicates a successful database ping against the seeded schema

#### Scenario: Container is torn down after the run

- **WHEN** `npm run test:e2e:seeded` exits (success or failure)
- **THEN** the Testcontainers-managed container is stopped and removed via `globalTeardown` (`src/__tests__/e2e/seeded/setup/global-teardown.ts`)

#### Scenario: Postgres container module is shared with integration

- **WHEN** the seeded `globalSetup` boots Postgres
- **THEN** it imports `bootPostgres` and `applyMigrations` from `@/__tests__/e2e/_shared/postgres-container` (the same path the integration `globalSetup` uses)

### Requirement: Auth state is reusable via `storageState`

The system SHALL provide `src/__tests__/e2e/seeded/setup/auth.setup.ts` as a Playwright `setup` project that performs a programmatic signin by writing the simulated `supabase.auth.token` cookie into a `storageState` file. Tests requiring an authenticated session MUST load that state via `test.use({ storageState })`.

#### Scenario: Auth setup runs before authenticated tests

- **WHEN** Playwright executes a test that depends on the `auth-setup` project
- **THEN** the dependent test starts with the `storageState` cookies pre-populated

#### Scenario: Anonymous smoke test does not need storageState

- **WHEN** the seeded smoke test runs
- **THEN** it does not require `storageState` and succeeds without any session

### Requirement: Tag registry exists at `e2e/tags.json`

The system SHALL maintain `src/__tests__/e2e/seeded/tags.json` as a JSON object mapping tag names to short descriptions. The registry MUST include at minimum `@health` and `@auth` (the active mock-GoTrue tags). The `@auth-real` tag is documented in the e2e-auth-real-suite spec and MAY be cross-referenced here.

#### Scenario: Registry lists active tags

- **WHEN** a contributor reads `src/__tests__/e2e/seeded/tags.json` after this change merges
- **THEN** the file contains `@health` and `@auth` keys with one-line descriptions

#### Scenario: A test can be filtered by tag

- **WHEN** a developer runs `npx playwright test --config playwright.seeded.config.ts --grep @health`
- **THEN** only tests whose `test.describe` title contains `@health` execute

### Requirement: A passing smoke e2e ships in this wave

The system SHALL include at least one passing Playwright test (`src/__tests__/e2e/seeded/smoke.spec.ts` or equivalent) tagged `@health` that visits `/` and asserts a 200 response and the placeholder content.

#### Scenario: Smoke test passes against the built app

- **WHEN** `npm run test:e2e:seeded` runs after this change merges
- **THEN** the smoke test passes, demonstrating the entire pipeline (Testcontainers boot, migrations, app build, app serve, browser navigate, assertion)

### Requirement: Reusable mock GoTrue helper at `lib/test-utils/mock-gotrue.ts`

The system SHALL expose a reusable, in-process mock GoTrue server as a module at `src/__tests__/e2e/seeded/setup/mock-gotrue.ts`. The module MUST export a function `startMockGotrue` (or an equivalent named export) whose return value, after awaiting, exposes at minimum:

- `port: number` — the port the mock GoTrue is listening on. The implementation MUST default to `54321` (the same port a local `supabase start` exposes) so that one Next.js build artifact, with `NEXT_PUBLIC_SUPABASE_URL` inlined at build time, can serve both the seeded suite (mock GoTrue) and the `@auth-real` suite (real Supabase) without rebuilding.
- `stop(): Promise<void>` — a function that releases the listening socket. After `stop()` resolves, the same port MUST be re-bindable.
- `jwt: string` — a valid JWT that the mock will accept on `/auth/v1/user` requests. The same JWT MUST be acceptable to a Supabase server-side client created with the mock's configuration so that `supabase.auth.getUser()` returns a non-null user.

The mock MUST respond to at least the endpoints `supabase-js` touches during a server-side `getUser()` flow (`/auth/v1/user`, `/auth/v1/token`) and SHOULD be small enough that future e2e suites can reach for it without copy-paste. The seeded `start-server` wrapper (`src/__tests__/e2e/seeded/setup/start-server.ts`) MUST import `startMockGotrue` from the relocated module path. The legacy `lib/test-utils/mock-gotrue.ts` MUST NOT exist after this change.

#### Scenario: `startMockGotrue` returns a valid handle

- **WHEN** a test calls `await startMockGotrue()`
- **THEN** the returned object exposes a numeric `port`, a `stop` async function, and a `jwt` string with a valid three-segment JWT shape

#### Scenario: `stop()` releases the listening socket

- **WHEN** a test calls `startMockGotrue()` and later awaits the returned `stop()`
- **THEN** a subsequent call to `startMockGotrue()` on the same port succeeds without an `EADDRINUSE` error

#### Scenario: `getUser()` succeeds against the mock

- **WHEN** a Supabase server-side client is configured against the mock's URL with the helper's `jwt` set as the access token cookie
- **THEN** `supabase.auth.getUser()` returns a user object (not `null`) and does not throw

#### Scenario: Seeded suite uses the relocated helper

- **WHEN** `npm run test:e2e:seeded -- --grep @auth` runs after this change merges
- **THEN** the suite starts (driven by `src/__tests__/e2e/seeded/setup/start-server.ts` importing the helper from `src/__tests__/e2e/seeded/setup/mock-gotrue.ts`) and the existing `@auth` cases pass without any reference to `lib/test-utils/`

