# Spec — local-development-environment

## ADDED Requirements

### Requirement: Local Supabase stack is reproducible

The system SHALL provide a one-command path to start a local Supabase stack via the official Supabase CLI. The stack MUST expose Postgres, GoTrue, Storage, Realtime, and Studio on localhost.

#### Scenario: Stack boots from a clean machine

- **WHEN** a developer with Docker installed runs `npm run supabase:start` for the first time
- **THEN** the Supabase CLI launches its local containers and reports the local API URL, anon key, and service-role key

#### Scenario: Stack boots reuses prior state

- **WHEN** a developer runs `npm run supabase:start` after previously running it
- **THEN** the CLI reuses the existing containers without re-pulling images and the stack becomes available within ~10 seconds

#### Scenario: README documents the minimum CLI version

- **WHEN** a contributor reads `README.md`
- **THEN** the document states the minimum Supabase CLI version required and the install instructions

### Requirement: Application container shares the Supabase local network

The system SHALL provide a `docker-compose.yml` that runs the Next.js development server in a container and connects to the local Supabase stack via the network exposed by the Supabase CLI.

#### Scenario: Compose-managed app reaches local Postgres

- **WHEN** the Supabase CLI stack is running and a developer runs `docker compose up`
- **THEN** the Next.js container resolves the Supabase Postgres host and successfully connects on the documented port

#### Scenario: Compose file does not duplicate Supabase services

- **WHEN** a contributor inspects `docker-compose.yml`
- **THEN** the file declares only the application service (and any helpers such as a watcher) — it does not redeclare Postgres, GoTrue, Storage, Realtime, or Studio

### Requirement: README documents the hybrid model

The system SHALL document, in `README.md`, that `supabase start` is the development environment and Testcontainers is the test-only environment. The README MUST explain how to start, stop, and reset the local stack and how to install the Playwright browser binary.

#### Scenario: Hybrid model is explained

- **WHEN** a new contributor reads `README.md`
- **THEN** the document explains that local development uses `supabase start` while integration and e2e tests use Testcontainers, and both coexist without conflict

#### Scenario: Reset path is documented

- **WHEN** a developer needs a clean local DB
- **THEN** the README provides a `supabase stop` / `supabase start` reset path and warns that local data is lost
