# Spec — ci-pipeline

## ADDED Requirements

### Requirement: CI runs unit, integration, and e2e jobs on every PR

The system SHALL extend the GitHub Actions workflow `.github/workflows/ci.yml` to run three jobs on every `pull_request` and every `push` to `main`: `quality` (unit + lint + typecheck), `integration`, and `e2e`. The `integration` and `e2e` jobs MUST be gated on `quality` passing first via the `needs` field.

#### Scenario: Failing unit test blocks downstream jobs

- **WHEN** a contributor opens a PR introducing a failing unit test
- **THEN** the `quality` job fails and `integration` and `e2e` are not executed

#### Scenario: All jobs run when quality passes

- **WHEN** a contributor opens a PR with `quality` passing
- **THEN** `integration` and `e2e` both start and report independent statuses

#### Scenario: All three jobs gate the merge

- **WHEN** any one of `quality`, `integration`, or `e2e` fails on a PR
- **THEN** the PR cannot be merged with the GitHub branch protection configured to require these checks

### Requirement: Integration job runs Testcontainers against Docker

The system SHALL configure the `integration` CI job with Docker available on the runner and SHALL run `npm run test:integration` after `npm ci`.

#### Scenario: Docker is available

- **WHEN** the `integration` job starts
- **THEN** the runner has Docker installed (default on `ubuntu-latest`) and `docker info` succeeds

#### Scenario: Integration job applies migrations and runs the suite

- **WHEN** the `integration` job runs
- **THEN** Vitest globalSetup boots Postgres via Testcontainers, applies migrations, runs every `*.int.test.ts`, and reports the suite result

### Requirement: E2E job caches Playwright browsers

The system SHALL configure the `e2e` CI job to cache `~/.cache/ms-playwright` across runs, keyed by the contents of `package-lock.json` (so that browser versions track the installed Playwright version).

#### Scenario: First run installs browsers, subsequent runs hit cache

- **WHEN** the `e2e` job runs for the first time on a runner image
- **THEN** `npx playwright install --with-deps chromium` downloads the binary and the path is cached

#### Scenario: Subsequent run with same lockfile reuses cache

- **WHEN** the `e2e` job runs for a PR whose `package-lock.json` has not changed since the last run
- **THEN** the Playwright install step skips the download and uses the cached binary

### Requirement: E2E job builds and runs the app, executes the suite

The system SHALL configure the `e2e` CI job to run `npm ci`, install browsers (cached), build the app via `npm run build`, and execute `npm run test:e2e`.

#### Scenario: E2E job runs Playwright

- **WHEN** the `e2e` job runs
- **THEN** Playwright `webServer` starts the production server, runs every `*.spec.ts` under `e2e/`, and reports the result

#### Scenario: Playwright HTML report is uploaded on failure

- **WHEN** the `e2e` job fails
- **THEN** the workflow uploads the `playwright-report/` directory as an artifact attached to the job for inspection
