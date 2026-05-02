# Tasks — bootstrap-data-and-tests

> This change is performed **manually**, not via `/dev-cycle`, because the orchestrator depends on the integration and e2e infrastructure introduced here. Test-layer tags follow the `dev-cycle.md` convention.

## 1. Supabase local (CLI + compose)

- [x] 1.1 Add Supabase CLI as a dev dependency (`supabase`) and document the minimum version in `README.md`
- [x] 1.2 Add `npm run supabase:start` and `npm run supabase:stop` scripts delegating to the CLI
- [x] 1.3 Manual smoke: run `npm run supabase:start` from a clean machine, capture the local API URL, anon key, and service-role key, then run `npm run supabase:stop`
- [x] 1.4 Create `docker-compose.yml` declaring only the Next.js dev container and bridging into the Supabase CLI's network
- [x] 1.5 Manual smoke: with Supabase running, run `docker compose up`, verify the container resolves Supabase Postgres, then `docker compose down`
- [x] 1.6 Update `README.md` with the hybrid model explanation, supabase start/stop/reset paths, Playwright browser install, and full env variable list

## 2. Drizzle schema and RLS pattern

- [x] 2.1 Install `drizzle-orm`, `drizzle-kit`, and `postgres` (or `pg`) as dependencies
- [x] 2.2 Create `drizzle.config.ts` pointing at the local Supabase Postgres connection string from `serverEnv`
- [x] 2.3 Create `db/schema/health/tables.ts` defining `health_pings` (`id` uuid pk, `owner_id` uuid → `auth.users`, `created_at` timestamptz default now, `note` text)
- [x] 2.4 Create `db/schema/health/policies.ts` exporting the four owner-scoped RLS policy SQL strings as a named constant
- [x] 2.5 Create `db/schema/index.ts` re-exporting tables for the relational API
- [x] 2.6 Create `db/migrations/README.md` documenting the manual RLS-SQL append step and the canonical owner-scoped template
- [x] 2.7 Run `npm run db:generate` and append the policies from `db/schema/health/policies.ts` to the resulting migration file
- [x] 2.8 Add scripts `db:generate`, `db:migrate`, `db:push`, `db:studio` to `package.json`
- [x] 2.9 Manual smoke: with `supabase start` running, execute `npm run db:migrate` against the local DB and confirm `health_pings` exists with RLS enabled and four policies

## 3. Environment validation

- [x] 3.1 Install `zod` as a dependency
- [x] 3.2 Create `lib/env.ts` exporting `serverEnv` and `clientEnv` parsed via Zod schemas; include the keys: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LOG_LEVEL`
- [x] 3.3 Add `import 'server-only'` at the top of the `serverEnv` definition file (or split it into a server-only module imported from `lib/env.ts`) so that any client import fails at build time
- [x] 3.4 Update `eslint.config.mjs` with a `no-restricted-syntax` rule banning `process.env.*` access outside `lib/env.ts`
- [x] 3.5 Update `.env.example` listing every variable consumed by `lib/env.ts` with a one-line comment per variable
- [x] 3.6 Add a unit test asserting that `serverEnv` and `clientEnv` parse a valid input and reject a malformed input `[unit]`

## 4. Pino logger with redaction

- [x] 4.1 Install `pino` and `pino-pretty` as dependencies
- [x] 4.2 Create `lib/logger.ts` exporting a configured Pino logger; redaction paths cover `*.cpf`, `*.email`, `*.phone`, `*.password`, `*.token`, `*.jwt`, `headers.authorization`, `headers.cookie`, `body.message`, `transcription`, `note`
- [x] 4.3 Read level from `serverEnv.LOG_LEVEL` (default `info` in prod, `debug` in dev, `silent` in tests via `process.env.NODE_ENV === 'test'`)
- [x] 4.4 Add a unit test asserting redaction for `email`, `cpf`, `token`, and `note` paths `[unit]`

## 5. Supabase auth helpers

- [x] 5.1 Install `@supabase/ssr` and `@supabase/supabase-js` as dependencies
- [x] 5.2 Create `lib/supabase/server.ts` exporting `createServerClient()` reading cookies from `next/headers`
- [x] 5.3 Create `lib/supabase/client.ts` exporting `createBrowserClient()` for `'use client'` components
- [x] 5.4 Create `lib/supabase/middleware.ts` exporting `createMiddlewareClient(request, response)` for use by root middleware
- [x] 5.5 Create root `middleware.ts` calling `getUser()` to refresh the session cookie on every request; do not redirect (auth gating arrives in wave 3)
- [x] 5.6 Add a unit test for the helpers' construction logic that does not call out to a real Supabase instance `[unit]`

## 6. Vitest integration runner + Testcontainers

- [x] 6.1 Install `@testcontainers/postgresql` and `testcontainers` as dev dependencies
- [x] 6.2 Create `vitest.integration.config.ts` with `globalSetup: './__tests__/integration/setup/global-setup.ts'`, `include: ['**/*.int.test.ts']`, environment `node`
- [x] 6.3 Create `__tests__/integration/setup/global-setup.ts` that boots a Postgres container with `.withReuse()`, applies all Drizzle migrations, and exports the connection string into `process.env.DATABASE_URL` for the test process
- [x] 6.4 Create `__tests__/integration/setup/run-as-user.ts` exporting `runAsUser(jwtSub, fn)` that opens a transaction setting `request.jwt.claims` and runs `fn(db)` within it
- [x] 6.5 Create `__tests__/integration/setup/run-as-service.ts` exporting `runAsService(fn)` that opens a service-role connection (no JWT) for fixture setup
- [x] 6.6 Create `__tests__/integration/factories/health-pings.ts` deriving its insert type from the Drizzle schema and providing a `build(overrides)` function
- [x] 6.7 Add `test:integration` script to `package.json` running `vitest run --config vitest.integration.config.ts`
- [x] 6.8 Create `__tests__/integration/health-pings.int.test.ts` covering: owner reads own row, non-owner is blocked, service-role reads all `[integration]`
- [x] 6.9 Create `__tests__/integration/policy-coverage.int.test.ts` asserting that every table in `db/schema/**/tables.ts` has at least one matching `CREATE POLICY ... ON <table>` line in `db/migrations/**` `[integration]`
- [x] 6.10 Create `__tests__/integration/env-coverage.int.test.ts` asserting that every key in `serverEnv` schema and `clientEnv` schema is present in `.env.example` `[integration]`
- [x] 6.11 Manual smoke: `npm run test:integration` passes locally

## 7. Playwright e2e stack

- [x] 7.1 Update `playwright.config.ts` adding `webServer: { command: 'npm run start', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI }`, `globalSetup: './e2e/global-setup.ts'`, `globalTeardown: './e2e/global-teardown.ts'`, `projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]`, `fullyParallel: true`, `workers: process.env.CI ? 2 : 4`
- [x] 7.2 Create `e2e/global-setup.ts` booting Testcontainers Postgres (same image, same `.withReuse()`), applying migrations, seeding one `auth.users` row and one `health_pings` row, and exposing the connection string to the spawned `webServer` via env
- [x] 7.3 Create `e2e/global-teardown.ts` stopping the container if not reused
- [x] 7.4 Create `e2e/auth.setup.ts` that writes the simulated `supabase.auth.token` cookie into `e2e/.auth/state.json`
- [x] 7.5 Create `e2e/tags.json` with keys `@health` ("Health endpoints"), `@auth` ("Auth flow — default suite, simulated"), `@auth-real` ("Auth flow — wave 3, real gotrue")
- [x] 7.6 Create `e2e/smoke.spec.ts` tagged `@health` visiting `/` and asserting 200 + "HubrityP" content `[e2e]`
- [x] 7.7 Add `e2e/.auth/` to `.gitignore`
- [x] 7.8 Manual smoke: `npx playwright install --with-deps chromium`, then `npm run test:e2e` passes locally

## 8. CI expansion

- [x] 8.1 Update `.github/workflows/ci.yml`: keep `quality` job; add `integration` job (`needs: quality`) running `npm run test:integration` with Docker available; add `e2e` job (`needs: quality`) caching `~/.cache/ms-playwright` keyed on `package-lock.json` hash
- [x] 8.2 In `e2e` job: install browsers (cache-aware), build, run `npm run test:e2e`, upload `playwright-report/` as an artifact on failure
- [x] 8.3 Add `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` at the workflow level
- [ ] 8.4 Manual smoke: open a draft PR, confirm all three jobs run, all green, and the e2e artifact slot is wired (deliberately fail one e2e once to confirm the artifact upload, then revert)

## 9. Documentation

- [x] 9.1 Update `README.md`: full env variable list, Supabase CLI install, `supabase start`/`stop`/reset paths, `npx playwright install --with-deps chromium` step, `test:integration` and `test:e2e` scripts, hybrid-model paragraph
- [x] 9.2 Update `docs/dev-cycle.md` if any path established here diverges from references in that doc (`db/schema/**`, `lib/env.ts`, `e2e/tags.json` are explicitly named there as fallback triggers — keep them aligned) — paths already match.
- [x] 9.3 Update `CLAUDE.md` if any decision in `design.md` needs to surface as a project-wide rule (e.g., `process.env` ban — already in CLAUDE.md, but verify ESLint rule wording matches)

## 10. Final validation

- [x] 10.1 Run `npm run check` → exit 0
- [x] 10.2 Run `npm run test:unit` → exit 0
- [x] 10.3 Run `npm run test:integration` → exit 0 (RLS test green, policy-coverage test green, env-coverage test green)
- [x] 10.4 Run `npm run test:e2e` → exit 0 (smoke green)
- [ ] 10.5 Open the PR for this change; CI runs `quality`, `integration`, `e2e` and all are green
- [ ] 10.6 Merge to `main`; `smoke-health-feature` (wave 3) has a clean stack to build on
