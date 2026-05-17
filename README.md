# HubrityP

SaaS for Brazilian autonomous psychologists. Single platform for scheduling, medical records, WhatsApp reminders, prescriptions, and billing.

## Prerequisites

- **Node.js 22 LTS** (use `nvm use` — version pinned in `.nvmrc`).
- **npm 10+** (ships with Node 22).
- **Docker** + Docker Compose — required for the local Supabase stack and for Testcontainers (integration + e2e tests).
- **Supabase CLI** ≥ `2.98.0` — installed automatically via `devDependencies` (`npx supabase ...`). A global install also works if you prefer.
- **gh CLI** (for opening PRs).

## Install

```bash
nvm use
npm install
npx playwright install --with-deps chromium   # one-time, only when working on e2e tests
```

## Hybrid local model: `supabase start` for dev, Testcontainers for tests

HubrityP runs on Supabase (Postgres + Auth + Storage + Realtime). Locally we use **two distinct Postgres environments** so dev ergonomics and test isolation never compete:

| Environment     | Tooling                                             | When                                                                                                                      |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Development** | Supabase CLI (`npm run supabase:start`)             | Running the app via `npm run dev` or `docker compose up`. Full stack: Postgres + GoTrue + Storage + Studio.               |
| **Tests** (any) | `@testcontainers/postgresql` + `postgres:16-alpine` | `npm run test:integration` and `npm run test:e2e:seeded`. Postgres-only, fast boot, schema bootstrapped programmatically. |

The two coexist — they listen on different ports and use independent docker networks.

### Boot the local Supabase stack

```bash
npm run supabase:start    # ~30–60s on first boot, ~5–10s on subsequent boots
npm run supabase:stop     # release Docker resources when you're done
npm run supabase:reset    # destroy + recreate local DB (loses local data)
```

The CLI prints the local API URL, anon key, service-role key, and Studio URL on every start. Copy the matching values into `.env.local`:

```bash
cp .env.example .env.local
# then paste the keys printed by `supabase start` into the corresponding entries
```

### Apply the Drizzle schema

```bash
npm run db:migrate    # apply every committed migration to the running local DB
npm run db:studio     # open Drizzle Studio against the local DB
npm run db:generate   # regenerate SQL after editing src/shared/db/schema/**
```

When you create a new table, append the matching RLS policy SQL to the generated migration — see `src/shared/db/migrations/README.md` for the canonical owner-scoped template.

### Run the app

```bash
npm run dev                # native (recommended)
# or
docker compose up          # containerized; bridges into the Supabase CLI network
```

Open <http://localhost:3000>.

## Environment variables

All variables consumed by the app are validated by `src/shared/env/` (Zod). Boot fails fast if anything is missing or malformed. Direct `process.env.*` access outside the env module is blocked by ESLint (with a small allow-list for CLI scripts: `scripts/db-migrate.ts`, `src/shared/env/client.ts`, and the test setup files).

| Variable                        | Scope  | Purpose                                                               |
| ------------------------------- | ------ | --------------------------------------------------------------------- |
| `DATABASE_URL`                  | server | Postgres connection string (Drizzle).                                 |
| `NEXT_PUBLIC_SUPABASE_URL`      | client | Public Supabase API URL (`http://127.0.0.1:54321` locally).           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | Public anon key — safe to ship to the browser.                        |
| `SUPABASE_SERVICE_ROLE_KEY`     | server | Service-role key — RLS bypass, server-only, **never** ship to client. |
| `LOG_LEVEL`                     | server | Pino log level (`debug` \| `info` \| `warn` \| `error` \| `silent`).  |

Copy `.env.example` to `.env.local` and fill it from the Supabase CLI output.

## Quality contract

Every change must pass the same gates locally that CI runs:

```bash
npm run check               # lint + format:check + typecheck (fail-fast)
npm run test:unit           # Vitest, unit (src/__tests__/unit/**)
npm run test:integration    # Vitest + Testcontainers Postgres (src/__tests__/integration/**)
npm run test:e2e:seeded     # Playwright with mock GoTrue + Testcontainers (src/__tests__/e2e/seeded/**)
npm run test:e2e:real       # Playwright against `supabase start` (src/__tests__/e2e/real/**)
```

Pre-commit hooks (Husky + lint-staged) run `eslint --fix`, `prettier --write` on staged files and then `tsc --noEmit` project-wide. Do not bypass with `--no-verify`.

## Scripts

| Script                     | Purpose                                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`              | Start Next.js dev server on `localhost:3000`.                                                                                                                                 |
| `npm run build`            | Production build.                                                                                                                                                             |
| `npm run start`            | Serve the production build.                                                                                                                                                   |
| `npm run lint`             | ESLint flat config (Next core-web-vitals + TS type-checked).                                                                                                                  |
| `npm run format`           | Prettier `--write` over the repo.                                                                                                                                             |
| `npm run format:check`     | Prettier `--check` (no rewrites).                                                                                                                                             |
| `npm run typecheck`        | `tsc --noEmit` strict mode.                                                                                                                                                   |
| `npm run check`            | `lint && format:check && typecheck`.                                                                                                                                          |
| `npm run test:unit`        | Vitest run (jsdom for `*.test.tsx`, node for `*.test.ts`) over `src/__tests__/unit/**`.                                                                                       |
| `npm run test:integration` | Vitest + Testcontainers Postgres (`src/__tests__/integration/**/*.int.test.ts`), uses the shared container at `src/__tests__/e2e/_shared/`.                                   |
| `npm run test:e2e:seeded`  | Playwright `playwright.seeded.config.ts` (mock GoTrue + Testcontainers). Runs `src/__tests__/e2e/seeded/**/*.spec.ts`.                                                        |
| `npm run test:e2e:real`    | Playwright `playwright.real.config.ts` (`@auth-real` suite) against a real Supabase stack started via `npx supabase start` first. Runs `src/__tests__/e2e/real/**/*.spec.ts`. |
| `npm run supabase:start`   | Boot the local Supabase stack via the CLI.                                                                                                                                    |
| `npm run supabase:stop`    | Stop the local Supabase stack.                                                                                                                                                |
| `npm run supabase:reset`   | Destroy + recreate the local DB.                                                                                                                                              |
| `npm run db:generate`      | Regenerate SQL migrations from `src/shared/db/schema/**`.                                                                                                                     |
| `npm run db:migrate`       | Apply pending migrations to the configured database (`scripts/db-migrate.ts`).                                                                                                |
| `npm run db:push`          | Push schema directly (prototyping only — bypasses migration history).                                                                                                         |
| `npm run db:studio`        | Open Drizzle Studio.                                                                                                                                                          |

## Project layout

The application code lives under `src/`. Tooling/configs/docs/scripts live at the root.

```
src/
  app/                                     # Next.js App Router (routes, layouts, route handlers)
    (auth)/login/                          # public auth routes — thin shells delegating to modules
    (app)/dashboard/                       # authenticated app shell
    api/                                   # Route Handlers (e.g. /api/health, /api/me)
  middleware.ts                            # edge middleware (auth gating)
  modules/<domain>/                        # domain code, one folder per capability
    auth/
      components/                          # client/server components owned by this module
      server/                              # Server Action implementations (no `'use server'`)
      lib/                                 # validators, mappers, branded types
      index.ts                             # PUBLIC API of the module — consumers import from here
    health/
  shared/                                  # cross-module concerns (depends on nothing inside modules)
    ui/                                    # shadcn/ui primitives
    lib/                                   # utils, logger
    env/                                   # Zod-validated env (server + client splits)
    supabase/                              # browser/server/middleware Supabase clients
    db/                                    # Drizzle: client.ts + schema/ + migrations/
  __tests__/                               # ALL test code lives here (centralized)
    unit/                                  # Vitest unit tests, mirroring src/ tree
    integration/                           # Vitest + Testcontainers (*.int.test.ts)
      setup/                               # global-setup, db client, runAs helpers
      factories/                           # typed Drizzle factories
    e2e/
      _shared/postgres-container.ts        # SHARED bootstrap module (integration + seeded e2e)
      seeded/                              # Playwright + mock GoTrue + Testcontainers
      real/                                # Playwright against `supabase start`
    stubs/                                 # no-op stubs (e.g. server-only)
scripts/
  db-migrate.ts                            # CLI script for `npm run db:migrate`
docs/                                      # human-readable docs (incl. docs/prd/)
openspec/                                  # OpenSpec change tracker (active + archived)
playwright.seeded.config.ts                # default e2e suite
playwright.real.config.ts                  # @auth-real e2e suite
vitest.config.ts                           # unit
vitest.integration.config.ts               # integration
```

The `@/*` TypeScript alias resolves to `./src/*`. Each module exposes its public API via `src/modules/<domain>/index.ts` — consumers should import from `@/modules/<domain>`, not from internal paths.

> **One important nuance for Client Components**: do NOT import a Server Action from the module barrel (`@/modules/auth`) in a Client Component — the barrel transitively pulls `server-only` into the bundle and the RSC boundary checker fails the build. Instead, import the action from the route shell (`@/app/(auth)/login/actions`), which Next.js compiles into a client-safe RPC stub. Server-side consumers (other server modules, server tests) can use the barrel freely.

## Documentation

- Engineering contract & domain context: [`CLAUDE.md`](./CLAUDE.md).
- Dev cycle workflow: [`docs/dev-cycle.md`](./docs/dev-cycle.md).
- RLS policy template: [`src/shared/db/migrations/README.md`](./src/shared/db/migrations/README.md).
