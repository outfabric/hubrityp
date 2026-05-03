## MODIFIED Requirements

### Requirement: Integration job runs Testcontainers against Docker

The system SHALL configure the `integration` CI job with Docker available on the runner and SHALL run `npm run test:integration` after `npm ci`. The job MUST exercise the integration suite at `src/__tests__/integration/` (not at the legacy root-level `__tests__/integration/`).

#### Scenario: Docker is available

- **WHEN** the `integration` job starts
- **THEN** the runner has Docker installed (default on `ubuntu-latest`) and `docker info` succeeds

#### Scenario: Integration job applies migrations and runs the suite

- **WHEN** the `integration` job runs
- **THEN** Vitest globalSetup boots Postgres via Testcontainers (using the shared module under `src/__tests__/e2e/_shared/`), applies migrations from `src/shared/db/migrations/`, runs every `*.int.test.ts` under `src/__tests__/integration/`, and reports the suite result

### Requirement: E2E job builds and runs the app, executes the suite

The system SHALL configure the `e2e` CI job to run `npm ci`, install browsers (cached), build the app via `npm run build`, and execute `npm run test:e2e:seeded`. The job MUST exercise the seeded suite under `src/__tests__/e2e/seeded/` via `playwright.seeded.config.ts`.

#### Scenario: E2E job runs Playwright seeded suite

- **WHEN** the `e2e` job runs
- **THEN** Playwright `webServer` starts the production server, runs every `*.spec.ts` under `src/__tests__/e2e/seeded/`, and reports the result

#### Scenario: Playwright HTML report is uploaded on failure

- **WHEN** the `e2e` job fails
- **THEN** the workflow uploads the `playwright-report/` directory as an artifact attached to the job for inspection
