# code-organization Specification

## Purpose
TBD - created by archiving change reorganize-folder-structure. Update Purpose after archive.
## Requirements
### Requirement: Application code lives under `src/`

The system SHALL place all application code under `src/`. The Next.js App Router root MUST be `src/app/`. The Next.js root middleware MUST be `src/middleware.ts`. Configuration files (`next.config.ts`, `tsconfig.json`, `package.json`, `eslint.config.mjs`, `playwright.*.config.ts`, `vitest.*.config.ts`, `vitest.setup.ts`, `drizzle.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `components.json`) MAY remain at the repository root. The TypeScript path alias `@/*` MUST resolve to `./src/*`.

#### Scenario: Application root is `src/app/`

- **WHEN** the Next.js dev server boots
- **THEN** it loads the App Router from `src/app/` (Next.js auto-detects the `src/` convention) and serves `/` from `src/app/page.tsx`

#### Scenario: Path alias points at `src/`

- **WHEN** any file imports `from '@/modules/auth/lib/login-input-schema'`
- **THEN** the import resolves to `src/modules/auth/lib/login-input-schema.ts` and `npm run typecheck` succeeds

#### Scenario: No application code lives at the repository root outside `src/`

- **WHEN** a contributor adds a new component, helper, schema, Server Action, or middleware
- **THEN** the file lives under `src/` (in `app/`, `modules/<domain>/`, `shared/`, or `__tests__/`); it does not live at the repository root

### Requirement: Domain code is organized under `src/modules/<domain>/`

The system SHALL place all domain code under `src/modules/<domain>/`. Each module MUST follow this internal layout:

- `components/` — React components owned by the domain (Server and Client Components)
- `server/` — Server Action implementations and other server-only domain logic
- `lib/` — pure helpers, Zod schemas, mappers, branded types
- `index.ts` — public API of the module (the only file other modules and route shells should import from)

A module MAY omit `components/`, `server/`, or `lib/` if it does not need them, but `index.ts` MUST always exist. Modules MUST NOT import from each other except via `index.ts` (no deep imports across modules). Modules MAY import from `src/shared/`. `src/shared/` MUST NOT import from `src/modules/`.

#### Scenario: Module exposes only its public API

- **WHEN** code outside `src/modules/auth/` needs `signIn` or `LoginForm`
- **THEN** it imports from `@/modules/auth` (the module's `index.ts`), not from `@/modules/auth/server/login` or `@/modules/auth/components/login-form`

#### Scenario: Cross-module deep imports are forbidden

- **WHEN** `src/modules/<other>/server/foo.ts` writes `import { internalHelper } from '@/modules/auth/lib/internal-helper'`
- **THEN** the ESLint `no-restricted-imports` rule reports an error directing the contributor to either widen the auth `index.ts` exports or move `internal-helper` to `src/shared/`

#### Scenario: Shared cannot depend on modules

- **WHEN** any file under `src/shared/` writes `import { foo } from '@/modules/<any>'`
- **THEN** the ESLint rule reports an error (`src/shared/` is the dependency root, not a peer of modules)

### Requirement: Route files in `src/app/` are thin shells that delegate to modules

The system SHALL keep `src/app/` as a routing shell. `page.tsx`, `layout.tsx`, `route.ts`, and `actions.ts` files inside `src/app/` MUST delegate non-trivial logic to `src/modules/<domain>/`. Server Actions exported by `src/app/<route>/actions.ts` MUST be `'use server'` wrappers around functions imported from `@/modules/<domain>/server/`.

#### Scenario: Route page imports components from a module

- **WHEN** a contributor reads `src/app/(auth)/login/page.tsx`
- **THEN** the page is a Server Component that imports `<LoginForm/>` from `@/modules/auth` and composes the route layout; it does not contain UI markup beyond layout-level composition

#### Scenario: Route action delegates to module server function

- **WHEN** a contributor reads `src/app/(auth)/login/actions.ts`
- **THEN** the file declares `'use server'` and exports `signIn` (and `signOut` where applicable) as wrappers that call the matching function from `@/modules/auth/server/`; the action body is at most one or two lines that pass `formData` through

### Requirement: Cross-module concerns live under `src/shared/`

The system SHALL place all cross-module infrastructure under `src/shared/` with this layout:

- `src/shared/ui/` — shadcn/ui primitives (replaces the prior `components/ui/`)
- `src/shared/lib/` — `utils.ts` (`cn()`), `logger.ts` (Pino), and other framework-agnostic helpers
- `src/shared/env/` — Zod-validated env modules: `serverEnv`, `clientEnv`, `schemas.ts`, `client.ts`
- `src/shared/supabase/` — Supabase clients for browser, server, and middleware contexts
- `src/shared/db/` — Drizzle runtime client (`client.ts`), schema (`schema/<domain>/`), and migrations (`migrations/`)

Adding a new top-level subdirectory under `src/shared/` is permitted when a concern is genuinely cross-module and does not fit one of the above; new subdirectories MUST be documented in the module-organization section of the project root `README.md`.

#### Scenario: shadcn primitives are imported from `@/shared/ui`

- **WHEN** any source file imports a shadcn primitive (`Button`, `Input`, `Card`, `Label`)
- **THEN** the import path is `@/shared/ui/<primitive>` (matching `components.json` `aliases.components`); no module imports `@/components/ui/*`

#### Scenario: Supabase clients are imported from `@/shared/supabase`

- **WHEN** any module needs a Supabase client (server, browser, or middleware context)
- **THEN** it imports from `@/shared/supabase/{server,client,middleware}` (not from `@/lib/supabase/*`); the same module is consumable by future modules without re-export

#### Scenario: Validated env objects are imported from `@/shared/env`

- **WHEN** any source file needs `serverEnv` or `clientEnv`
- **THEN** it imports from `@/shared/env`; direct `process.env.*` access remains forbidden by ESLint (with the same exception list documented in the env-and-logging spec)

### Requirement: Tests are centralized under `src/__tests__/`

The system SHALL centralize all test files under `src/__tests__/` with this layout:

- `src/__tests__/unit/` — Vitest unit tests (`*.test.ts`, `*.test.tsx`); the directory tree mirrors `src/modules/` and `src/shared/`
- `src/__tests__/integration/` — Vitest integration tests (`*.int.test.ts`); contains `setup/` (globalSetup, db, rls, msw helpers) and `factories/`
- `src/__tests__/e2e/_shared/` — modules shared by both integration and e2e suites (notably `postgres-container.ts`)
- `src/__tests__/e2e/seeded/` — Playwright suite with mock GoTrue (`*.spec.ts`); contains `setup/` (auth.setup, global-setup, global-teardown, start-server, mock-gotrue)
- `src/__tests__/e2e/real/` — Playwright suite against `supabase start` (`*.spec.ts`); contains `setup/` (global-setup, global-teardown, credentials)
- `src/__tests__/stubs/` — runtime stubs imported by test configs (e.g., `server-only.ts`)

Colocated `*.test.ts` files alongside source under `src/modules/` or `src/shared/` MUST NOT exist. The `__tests__` name is intentional: the `@/*` alias resolves to `src/*`, so `from '@/__tests__/integration/setup/db'` works without a separate `@tests/*` alias.

#### Scenario: Vitest unit runner finds tests under `src/__tests__/unit/`

- **WHEN** a developer runs `npm run test:unit`
- **THEN** Vitest discovers `*.test.ts(x)` files only under `src/__tests__/unit/` and not under `src/modules/` or `src/shared/`

#### Scenario: Test imports use the `@` alias

- **WHEN** a test file imports a setup helper or a module under test
- **THEN** the import uses `@/__tests__/...` or `@/modules/...` (no relative imports crossing the `src/__tests__/` boundary)

#### Scenario: `_shared` is reachable from both integration and seeded e2e

- **WHEN** the integration globalSetup or the seeded e2e globalSetup needs the Postgres container module
- **THEN** both import from `@/__tests__/e2e/_shared/postgres-container`

### Requirement: Operational scripts live under `scripts/`

The system SHALL place CLI scripts (Drizzle migration runner, future seeders, RLS verifiers, one-off operational tools) under a top-level `scripts/` directory. Scripts MUST NOT live under `src/` (they are not application code) and MUST NOT live under `src/shared/db/` (the data-layer subdirectory is for runtime client + schema, not CLI tooling).

#### Scenario: Migration script lives in `scripts/`

- **WHEN** a developer runs `npm run db:migrate`
- **THEN** the npm script invokes `tsx scripts/db-migrate.ts`; the file is not under `src/`

#### Scenario: Future operational scripts follow the convention

- **WHEN** a contributor adds a new operational CLI (e.g., `seed-fixtures.ts`)
- **THEN** the file lives under `scripts/` and the matching `package.json` script invokes it via `tsx scripts/<name>.ts`

### Requirement: Documentation lives under `docs/`

The system SHALL nest all human-readable documentation under `docs/`. This includes `docs/prd/` (product requirements documents), `docs/design-system/` (design tokens, testid conventions), `docs/dev-cycle.md` (the orchestrator workflow), and any future capability documentation produced by `/dev-cycle` or `/opsx:archive`. The `prd/` directory MUST NOT exist at the repository root.

#### Scenario: PRDs are reachable under `docs/prd/`

- **WHEN** a contributor opens product requirements
- **THEN** the files are under `docs/prd/` (not at the repository root); links from `CLAUDE.md` or the root `README.md` point at `docs/prd/`

### Requirement: Production build excludes test sources

The system SHALL configure `next.config.ts` `outputFileTracingExcludes` so that the production bundle never traces files under `**/__tests__/**`. This is defense-in-depth: test files are not imported from any route, but the explicit exclusion guarantees that a future stray import cannot leak test-only modules into the deployed bundle.

#### Scenario: Production build does not include test files

- **WHEN** `npm run build` completes
- **THEN** no file under `src/__tests__/` appears in the `.next/` server or client output trace

