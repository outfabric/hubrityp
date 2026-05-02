# Proposal — bootstrap-data-and-tests

## Why

`bootstrap-foundation` left a Next.js app running with no persistent data and only a unit test runner. Every HubrityP feature touches Postgres with RLS, and `/dev-cycle` requires the integration and e2e test stacks to exist before it can run a feature with `[integration]` or `[e2e]` tags. This wave installs Supabase locally (via the official CLI), Drizzle ORM with a single example table that exercises the RLS pattern, the `@supabase/ssr` helpers, validated environment variables, the LGPD-compliant logger, the integration test stack (Vitest + Testcontainers), and the full e2e stack (Playwright).

It also introduces the data infrastructure required to support a "real auth" e2e suite later (`@auth-real`, scoped to wave 3), but does not yet wire that suite into CI — it does so once a real test exists to run.

This change is performed **manually**, not via `/dev-cycle` — the orchestrator depends on the integration and e2e infrastructure this change introduces.

## What Changes

### Supabase local (hybrid model)
- Install Supabase CLI as a dev dependency or document the global install path.
- npm script `supabase:start` delegating to `supabase start`.
- `docker-compose.yml` minimal: just the Next.js app container plus a bridge to the Supabase local network managed by the CLI. Document in `README.md` that **`supabase start` is the development environment**, while **Testcontainers is the test-only environment** (per the `integration-tests` and `e2e-tests` skill contracts).

### Drizzle ORM + RLS pattern
- `drizzle.config.ts` pointing at the local Supabase Postgres.
- `db/schema/` with **one** example table: `health_pings(id uuid pk, owner_id uuid → auth.users, created_at timestamptz, note text)`.
- RLS policies on `health_pings` scoped by `auth.uid() = owner_id` (select/insert/update/delete). This is the canonical template every future domain table will copy.
- Migrations generated via `drizzle-kit` and committed under `db/migrations/`.
- npm scripts: `db:generate`, `db:migrate`, `db:push`, `db:studio`.

### Validated environment
- `lib/env.ts` exporting `serverEnv` and `clientEnv`, each parsed from `process.env` via Zod schemas. Fails fast at boot if anything is missing.
- Update `.env.example` with all variables required for local Supabase + Drizzle.

### Auth helpers (no UI yet)
- `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/middleware.ts` using `@supabase/ssr`. These satisfy CLAUDE.md's "use established library" rule.
- `middleware.ts` at root performing session refresh on every navigation.
- **No login UI in this wave** — those arrive in wave 3 as the smoke feature.

### LGPD logger
- `lib/logger.ts`: Pino logger with redaction paths covering CPF, email, phone, JWT, message bodies, and any `*.token` fields.

### Integration test stack
- `vitest.integration.config.ts` (separate from unit config; suffix `*.int.test.ts`).
- `__tests__/integration/setup/global-setup.ts` booting a `supabase/postgres` container via `@testcontainers/postgresql`, applying Drizzle migrations, and exposing the connection string.
- Helpers `runAsUser(jwt)` and `runAsService()` for exercising RLS by setting `request.jwt.claims` on the connection.
- A typed factory for `health_pings` derived from the Drizzle schema.
- One example test asserting that RLS blocks cross-owner reads.
- npm script `test:integration`.

### E2E test stack (default: Testcontainers + simulated auth)
- `playwright.config.ts` with `webServer` (`npm run build && npm start`) and `globalSetup` (Testcontainers + seed via Drizzle).
- `e2e/auth.setup.ts` performing programmatic signin via simulated cookie (`supabase.auth.token`), storing `storageState` for reuse — this is the default per the `e2e-tests` skill.
- `e2e/tags.json` registering `@health` (and reserving `@auth`, `@auth-real` namespaces for wave 3).
- One smoke e2e: `/` returns 200 and renders the placeholder.
- npm script `test:e2e`.
- Document `npx playwright install --with-deps chromium` as a one-time setup step.

### CI
- Extend `.github/workflows/ci.yml` with two new jobs alongside the existing unit job:
  - **integration**: requires Docker; runs `npm run test:integration`. Cache Testcontainers images via Docker layer cache.
  - **e2e**: caches `~/.cache/ms-playwright`, runs `npx playwright install --with-deps chromium`, builds the app, runs `npm run test:e2e`. **Runs on every PR** (per the alignment decision).
- All jobs gated on the unit job passing first (fail fast on cheap signals).
- Add `gh auth status` smoke check in a setup step (does not fail the build, just surfaces auth issues for `/dev-cycle` users).

### Documentation
- Update `README.md` with the hybrid Supabase model, the Testcontainers-vs-CLI distinction, the Playwright browser install step, and full env var list.
- Update `docs/dev-cycle.md` only if any path established here diverges from what it already references (`db/schema/**`, `lib/env.ts`, `e2e/tags.json` — all of which are explicitly named as fallback triggers).

## Non-goals

Out of scope for this wave:

- Domain tables (psychologist, patient, calendar, payments, etc.) — they arrive per feature change.
- Login UI, signup UI, password reset — wave 3 owns the first auth UI.
- The `@auth-real` e2e suite (real `supabase start` + gotrue handshake) — wave 3 introduces both the test and its CI job together. This wave only reserves the tag and ensures the CLI is installed.
- Inngest, Resend, Twilio, Gemini, Asaas, Stream.io.
- Observability (OpenTelemetry, Sentry).
- Rate limiting, CSP report-only mode, advanced security headers beyond the wave-1 baseline.

## Impact

### Affected areas
- New top-level directories: `db/`, `__tests__/`, `e2e/`, `lib/supabase/`, plus root files (`drizzle.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`, `middleware.ts`, `docker-compose.yml`).
- CI workflow grows from ~1 minute to ~5–10 minutes per PR (e2e dominates).

### Risk
- **The Drizzle schema layout and the RLS policy template are a hard contract** — every future domain table will be copy-pasted from `health_pings`. Reverting the convention later means migrating every table.
- **Testcontainers topology is also a contract** — its setup helpers (`runAsUser`, `runAsService`, factory generation) are consumed by every integration test. Changing them later means rewriting every integration test.
- **`lib/supabase/*` and `lib/env.ts` are referenced as fallback triggers in `dev-cycle.md`** — touching these in any future change forces a full integration + e2e suite run. That is intentional; just be aware.
- First CI run with e2e enabled will likely require timeout/cache tuning. Budget time for that.

### Decisions frozen by this wave
- ORM: **Drizzle**, schema-first, migrations via `drizzle-kit`.
- Local dev DB: **`supabase start` (CLI)**.
- Test DB: **Testcontainers `supabase/postgres`**.
- Auth library: **`@supabase/ssr`** (satisfies "established library" rule per CLAUDE.md alignment).
- Logger: **Pino with redaction**.
- Env validation: **Zod with `serverEnv` / `clientEnv` split**.
- E2E auth default: **simulated cookie via `storageState`**, with `@auth-real` reserved for the rare cases requiring real gotrue.

### Validation
At the end of this change:
- `npm run supabase:start` boots a local stack reachable from the app.
- `npm run db:migrate` applies the `health_pings` migration with RLS enabled.
- `npm run test:integration` passes (RLS blocks cross-owner reads).
- `npm run test:e2e` passes (smoke against `/`).
- `npm run check` still passes.
- A PR exercising all of the above passes the expanded GitHub Actions workflow with all three test jobs green.
