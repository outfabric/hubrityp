## Why

The repository grew organically and now mixes four distinct concerns at the root: application code (`app/`, `components/`, `lib/`), data layer (`db/`, `lib/db/`), tests in four different locations (`e2e/`, `e2e-auth-real/`, `__tests__/`, `test/`, plus `*.test.ts` colocated next to source), and configuration sprawl (12+ config files at root). The `CLAUDE.md` engineering standard mandates "structure code by domain (`modules/billing/`)" but no such structure exists yet — every helper, validator, and Supabase wrapper currently lives in a flat `lib/`. Two Playwright configs (`playwright.config.ts` + `playwright.auth-real.config.ts`) split the e2e surface in a way only revealed by reading their headers, and `db/` (root, Drizzle convention) coexists confusingly with `lib/db/` (runtime client). Reorganizing now — while only `auth` and `health` capabilities are implemented — costs days; reorganizing after billing, scheduling, and prontuário land costs weeks.

## What Changes

- **BREAKING**: Adopt `src/` as the application root. `app/`, `components/`, `lib/`, `db/`, and `middleware.ts` move under `src/`.
- **BREAKING**: Introduce `src/modules/<domain>/` with `auth/` and `health/` as the first two modules. Each module owns its `components/`, `server/`, `lib/`, and a public `index.ts`.
- **BREAKING**: Split `app/(auth)/login/` and `app/(app)/` Server Actions: route files become thin shells that delegate to `src/modules/<domain>/server/`. Components move to `src/modules/<domain>/components/`.
- **BREAKING**: Introduce `src/shared/` for cross-module concerns: `ui/` (shadcn, was `components/ui/`), `lib/` (utils, logger), `env/` (was `lib/env/`), `supabase/` (was `lib/supabase/`), and `db/` (was `db/` + `lib/db/` consolidated).
- **BREAKING**: Consolidate the data layer at `src/shared/db/` with `client.ts`, `schema/`, and `migrations/`. The CLI script `db/migrate.ts` moves to `scripts/db-migrate.ts`.
- **BREAKING**: Centralize all tests under `src/__tests__/` with `unit/`, `integration/`, `e2e/{_shared,seeded,real}/`, and `stubs/`. The colocated `*.test.ts` files in `app/` and `lib/` move into the centralized tree. Playwright configs rename to `playwright.seeded.config.ts` and `playwright.real.config.ts`. Test framework configs update their `include`, `testDir`, and `globalSetup` paths.
- **BREAKING**: `prd/` moves to `docs/prd/`. The `.temp/` working directory is gitignored (already partially is).
- Update `tsconfig.json` `@/*` alias to point at `./src/*`.
- Update `drizzle.config.ts` to read schema and write migrations under `src/shared/db/`.
- Update `eslint.config.mjs` `no-restricted-imports` rule to permit `process.env` access in the new paths (`scripts/db-migrate.ts`, `src/shared/env/client.ts`).
- Update `package.json` scripts: `db:migrate` points at `scripts/db-migrate.ts`; rename `test:e2e` ↔ `test:e2e:seeded` for symmetry with `test:e2e:real`.
- Update `.claude/skills/{integration-tests,e2e-tests,unit-tests}/SKILL.md` and their `assets/`/`references/` to reflect centralized test paths and new aliases.
- Update `docs/dev-cycle.md` and `.claude/commands/dev-cycle.md`/`opsx/archive.md` for any path references.

## Capabilities

### New Capabilities

- `code-organization`: encode the canonical project structure as a first-class capability — `src/` as the application root, `src/modules/<domain>/` as the home for domain code with a documented internal layout (`components/`, `server/`, `lib/`, `index.ts`), `src/shared/` for cross-module concerns (`ui/`, `lib/`, `env/`, `supabase/`, `db/`), `src/__tests__/{unit,integration,e2e/{_shared,seeded,real},stubs}/` for centralized tests, `scripts/` for operational CLI scripts, `docs/` (with `prd/` nested) for human-readable documentation. Future modules and shared concerns inherit these conventions.

### Modified Capabilities

- `app-shell`: relocate `app/` and `middleware.ts` under `src/`; document the `src/` convention as the application root.
- `authentication`: split the login surface so route files (`src/app/(auth)/login/{page,actions}.tsx`) are thin shells that delegate to `src/modules/auth/{components,server,lib}/`; introduce module public API (`src/modules/auth/index.ts`); move shared Supabase clients to `src/shared/supabase/`.
- `dashboard-shell`: relocate logout Server Action to `src/modules/auth/server/`, with the `(app)/` route file delegating to it; relocate the dashboard page under `src/app/(app)/dashboard/`.
- `data-layer`: consolidate Drizzle schema, migrations, and runtime client at `src/shared/db/`; move the migration CLI script to `scripts/db-migrate.ts`; document the new layout as the canonical data-layer location.
- `env-and-logging`: relocate the env validation module to `src/shared/env/` and the logger to `src/shared/lib/`; update the ESLint allow-list for direct `process.env` access.
- `developer-tooling`: update `npm run db:migrate` to invoke `scripts/db-migrate.ts`; rename `test:e2e` to `test:e2e:seeded` for naming symmetry; ensure `npm run check` still gates on the new structure.
- `integration-test-stack`: relocate setup helpers, factories, and `*.int.test.ts` files under `src/__tests__/integration/`; share the Postgres container module with the seeded e2e suite via `src/__tests__/e2e/_shared/postgres-container.ts`; update `vitest.integration.config.ts` `globalSetup`, `include`, and aliases.
- `e2e-test-stack`: relocate the seeded e2e suite under `src/__tests__/e2e/seeded/`; rename `playwright.config.ts` to `playwright.seeded.config.ts`; update `testDir`, `webServer.command`, and the seeded-only mock-GoTrue setup paths.
- `e2e-auth-real-suite`: relocate the suite under `src/__tests__/e2e/real/`; rename `playwright.auth-real.config.ts` to `playwright.real.config.ts`; update `testDir` and global hook paths.
- `ci-pipeline`: update GitHub Actions workflow file references for moved test paths and renamed Playwright configs; preserve the three-job structure (`quality` → `integration` + `e2e`).

`health-endpoints` is intentionally not in this list: its requirements describe HTTP behavior only (request/response shapes, status codes, no PII), all of which are preserved unchanged. The implementation files relocate, but the spec does not need to change.

## Impact

- **Code**: ~40-60 files moved via `git mv` (preserves history); ~20-40 files edited (configs, imports, the auth shell→module refactor); 3 skills + 4-6 docs updated.
- **Imports**: every `from '@/lib/...'`, `from '@/db/...'`, `from '@/components/ui/...'`, `from '@/__tests__/...'` is rewritten to the new paths via codemod (e.g., `jscodeshift`, `ts-morph`, or `sed` for the simpler renames).
- **Configs touched**: `tsconfig.json`, `next.config.ts`, `drizzle.config.ts`, `vitest.config.ts`, `vitest.integration.config.ts`, `vitest.setup.ts`, `playwright.{seeded,real}.config.ts`, `eslint.config.mjs`, `package.json`, `components.json`, `.gitignore`.
- **Skills**: `integration-tests`, `e2e-tests`, `unit-tests` (assets and references included).
- **Docs**: `docs/dev-cycle.md`, `.claude/commands/dev-cycle.md`, `.claude/commands/opsx/archive.md`, root `README.md`, `CLAUDE.md` (paths section under "Estrutura"), and `prd/` README if any.
- **CI**: `.github/workflows/*.yml` test paths and Playwright config references.
- **External dependencies**: none added or removed. Drizzle, Vitest, Playwright, Next.js continue at current versions.
- **Backwards compatibility**: not preserved — this is a single atomic refactor. There are no public consumers of internal paths; the only "external" surface is HTTP endpoints (`/api/health`, `/api/me`, page routes), which keep their URLs.
- **Risk**: medium. Mostly mechanical (`git mv` + codemod), but the auth shell→module refactor and the shared `postgres-container` module across integration + seeded e2e need careful sequencing so `npm run check` and all four test suites stay green at every checkpoint.
