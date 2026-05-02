# HubrityP

SaaS para psicólogos autônomos brasileiros. Plataforma única para agenda, prontuário, lembretes WhatsApp, receita e cobrança.

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

| Environment     | Tooling                                            | When                                                                                                        |
| --------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Development** | Supabase CLI (`npm run supabase:start`)            | Running the app via `npm run dev` or `docker compose up`. Full stack: Postgres + GoTrue + Storage + Studio. |
| **Tests** (any) | `@testcontainers/postgresql` + `supabase/postgres` | `npm run test:integration` and `npm run test:e2e`. Postgres-only, fast boot, schema-isolated.               |

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
npm run db:generate   # regenerate SQL after editing db/schema/**
```

When you create a new table, append the matching RLS policy SQL to the generated migration — see `db/migrations/README.md` for the canonical owner-scoped template.

### Run the app

```bash
npm run dev                # native (recommended)
# or
docker compose up          # containerized; bridges into the Supabase CLI network
```

Open <http://localhost:3000>.

## Environment variables

All variables consumed by the app are validated by `lib/env.ts` (Zod). Boot fails fast if anything is missing or malformed. Direct `process.env.*` access outside `lib/env.ts` is blocked by ESLint.

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
npm run test:unit           # Vitest, unit
npm run test:integration    # Vitest + Testcontainers Postgres (RLS, policy lint, env lint)
npm run test:e2e            # Playwright (Testcontainers + built app)
```

Pre-commit hooks (Husky + lint-staged) run `eslint --fix`, `prettier --write` on staged files and then `tsc --noEmit` project-wide. Do not bypass with `--no-verify`.

## Scripts

| Script                     | Purpose                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`              | Start Next.js dev server on `localhost:3000`.                                                                         |
| `npm run build`            | Production build.                                                                                                     |
| `npm run start`            | Serve the production build.                                                                                           |
| `npm run lint`             | ESLint flat config (Next core-web-vitals + TS type-checked).                                                          |
| `npm run format`           | Prettier `--write` over the repo.                                                                                     |
| `npm run format:check`     | Prettier `--check` (no rewrites).                                                                                     |
| `npm run typecheck`        | `tsc --noEmit` strict mode.                                                                                           |
| `npm run check`            | `lint && format:check && typecheck`.                                                                                  |
| `npm run test:unit`        | Vitest run (jsdom for `*.test.tsx`, node for `*.test.ts`).                                                            |
| `npm run test:integration` | Vitest + Testcontainers Postgres (`*.int.test.ts`).                                                                   |
| `npm run test:e2e`         | Playwright (boots app + Testcontainers, runs `e2e/*.spec.ts`).                                                        |
| `npm run test:e2e:real`    | Playwright `@auth-real` suite against a real Supabase stack started via `npx supabase start` (must be running first). |
| `npm run supabase:start`   | Boot the local Supabase stack via the CLI.                                                                            |
| `npm run supabase:stop`    | Stop the local Supabase stack.                                                                                        |
| `npm run supabase:reset`   | Destroy + recreate the local DB.                                                                                      |
| `npm run db:generate`      | Regenerate SQL migrations from `db/schema/**`.                                                                        |
| `npm run db:migrate`       | Apply pending migrations to the configured database.                                                                  |
| `npm run db:push`          | Push schema directly (prototyping only — bypasses migration history).                                                 |
| `npm run db:studio`        | Open Drizzle Studio.                                                                                                  |

## Project layout

`app/` (App Router) · `components/` · `lib/` (env, logger, supabase helpers) · `db/` (Drizzle schema + migrations) · `__tests__/integration/` · `e2e/` (Playwright) · `openspec/` (change docs).

## Documentation

- Engineering contract & domain context: [`CLAUDE.md`](./CLAUDE.md).
- Dev cycle workflow: [`docs/dev-cycle.md`](./docs/dev-cycle.md).
- RLS policy template: [`db/migrations/README.md`](./db/migrations/README.md).
