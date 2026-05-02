# Design — bootstrap-data-and-tests

## Context

`bootstrap-foundation` left a Next.js 16 app running with strict TypeScript, lint, format, pre-commit hooks, a working unit-test runner, and a CI gate that runs `lint + typecheck + test:unit` on every PR. It has no persistent data and no integration or e2e test infrastructure.

Every HubrityP feature touches Postgres with Row Level Security, so wave 2 must establish the data layer canon — Supabase local for development, Drizzle ORM for the schema, an RLS policy template, validated environment variables, the LGPD-compliant logger, and the two remaining test stacks (integration via Testcontainers, e2e via Playwright). It must also extend the CI workflow to run those new test layers on every PR.

The wave is performed manually (not via `/dev-cycle`) because the orchestrator depends on the integration and e2e infrastructure introduced here. The smoke feature in wave 3 will be the first real exercise of `/dev-cycle`.

The skills `integration-tests` and `e2e-tests` already prescribe a hybrid model: `supabase start` for local development (full CLI, real auth and storage), and `@testcontainers/postgresql` with the `supabase/postgres` image for tests (fast boot, schema-level isolation, no auth/storage). This wave instantiates that contract.

The downstream change `smoke-health-feature` will introduce the first real auth UI and a separate `@auth-real` e2e suite that requires `supabase start` + gotrue. This wave reserves the namespace for that suite but does not introduce its CI job (no test exists yet to justify one).

## Goals / Non-Goals

**Goals:**
- Provide a reproducible local Supabase environment via the official CLI.
- Establish the Drizzle ORM canon: schema location, migration workflow, RLS policy template, single example table (`health_pings`) that exercises the full pattern.
- Provide validated environment variables via Zod with a strict server/client split.
- Provide `@supabase/ssr` helpers (`server`, `client`, `middleware`) plus the root `middleware.ts` for session refresh.
- Provide a Pino logger with LGPD-compliant redaction.
- Provide a working integration test stack: Vitest config, Testcontainers globalSetup, RLS-aware helpers (`runAsUser`, `runAsService`), one passing test that proves cross-owner reads are blocked.
- Provide a working e2e test stack: Playwright config with `webServer` and `globalSetup`, simulated auth via `storageState`, one passing smoke test against `/`.
- Extend CI with two new jobs (integration, e2e) running on every PR.
- Reserve `@auth`, `@auth-real`, `@health` tags in `e2e/tags.json` for downstream changes to use.

**Non-Goals:**
- Domain tables (psychologist, patient, appointment, payment, etc.) — those arrive per feature change.
- Login/signup/dashboard UI — wave 3 owns the first auth UI.
- The `@auth-real` e2e suite and its CI job — wave 3 introduces both together with a real test.
- Inngest, Resend, Twilio, Gemini, Asaas, Stream.io.
- Observability (OpenTelemetry, Sentry).
- Rate limiting, advanced CSP hardening (e.g., script nonces).
- Data seeding strategy beyond the single example table.

## Decisions

### D1 — Local Supabase via CLI, Testcontainers Postgres for tests (hybrid)

Local dev uses the official Supabase CLI (`supabase start`), which boots a complete local stack (Postgres, GoTrue, Storage, Realtime, Studio) on Docker. Tests use a Postgres-only container via `@testcontainers/postgresql` with the `supabase/postgres` image. The two coexist; CI uses Testcontainers exclusively for speed. `supabase start` is a developer-machine concern.

**Rationale:** the integration-tests skill already states this preference. Testcontainers boots in ~5–10s with `.withReuse()` and supports schema-level parallelism; `supabase start` boots in ~30–60s and is shared, so it does not parallelize cleanly across test files. For dev, the loss of the real Studio/Auth UI in tests is acceptable because tests simulate auth via JWT claims at the connection level.

**Alternatives considered:** a pure docker-compose with hand-rolled Postgres + GoTrue + Storage. Rejected because `supabase` CLI handles the same plumbing officially and survives Supabase upgrades.

### D2 — Drizzle schema layout: `db/schema/<domain>/{tables,policies}.ts` + barrel

Schema files are organized by domain (`db/schema/auth/`, `db/schema/health/` for the example table). Each domain folder exports `tables.ts` (table definitions) and `policies.ts` (raw SQL strings for RLS policies, attached at migration generation). A root `db/schema/index.ts` re-exports all tables for Drizzle's relational API.

**Rationale:** mirrors the "structure code by domain, not technical type" rule in `CLAUDE.md`. Splitting `tables` and `policies` keeps the Drizzle DSL for shape and raw SQL for policies (Drizzle has no first-class RLS DSL as of early 2026, so we accept the split). When a new feature change adds a `patients` capability, it creates `db/schema/patients/{tables,policies}.ts` and updates the barrel.

**Alternatives considered:** monolithic `db/schema.ts`. Rejected because it forces every change to touch the same file, generating spurious merge conflicts.

### D3 — RLS template: owner-scoped via `auth.uid()`

Every table tied to a single owner uses the same template:
```sql
ALTER TABLE health_pings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner can select" ON health_pings
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_id);
CREATE POLICY "owner can insert" ON health_pings
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "owner can update" ON health_pings
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "owner can delete" ON health_pings
  FOR DELETE TO authenticated
  USING (auth.uid() = owner_id);
```
Every owner-scoped table in future changes copies this exact pattern, swapping `health_pings` and `owner_id`. Multi-tenant patterns (psychologist owning multi-patient records) extend the template (extra clause checking ancestor ownership), but the base shape stays.

**Rationale:** consistency over cleverness. A reviewer should be able to verify RLS correctness in seconds.

**Alternatives considered:** a Drizzle plugin that generates policies. Rejected as premature — pure SQL is auditable, and the lack of a mature plugin in early 2026 outweighs the ergonomic benefit.

### D4 — Migrations: drizzle-kit `generate` + manual policy SQL

Use `drizzle-kit generate` for table DDL. Append RLS policy SQL **manually** to the generated migration file (Drizzle does not generate it). A `db/migrations/README.md` documents the manual append step. A linter check (custom Vitest test in this wave) asserts every table referenced from `db/schema/**/tables.ts` has at least one corresponding `CREATE POLICY ... ON <table>` line in `db/migrations/**`.

**Rationale:** policies are part of the schema. Forgetting them is a security bug; forgetting tests for them is also a security bug. The lint test makes "RLS missing" a CI failure rather than a code-review near-miss.

### D5 — Env validation: `lib/env.ts` with `serverEnv` and `clientEnv`

A single `lib/env.ts` exports two parsed objects. `clientEnv` only contains keys prefixed `NEXT_PUBLIC_*`; `serverEnv` contains everything else and throws at boot if a value is missing or malformed. Each schema is a Zod `z.object({...})`. Tests assert the schemas reject empty strings and obvious typos.

`process.env` is referenced **only** in `lib/env.ts`. ESLint rule (added here) bans `process.env.*` access elsewhere in the codebase.

**Rationale:** matches `CLAUDE.md` exactly. Centralizing access also makes it trivial to add fail-fast validation and to swap providers later.

### D6 — Auth helpers: `@supabase/ssr` thin wrappers

Three modules in `lib/supabase/`:
- `server.ts` exports `createServerClient()` — uses `cookies()` from `next/headers`, runs in RSC and Server Actions.
- `client.ts` exports `createBrowserClient()` — runs in `'use client'` components.
- `middleware.ts` exports `createMiddlewareClient(request, response)` — used by root `middleware.ts` for session refresh.

Every consumer creates the client at the boundary (per request); we do not memoize globally to avoid leaking sessions across requests.

The root `middleware.ts` calls `supabase.auth.getUser()` to refresh the session cookie on every navigation. It does **not** redirect — auth-gating routes is a per-feature concern that wave 3 will introduce.

**Rationale:** `@supabase/ssr` is the canonical Next 16 + Supabase pattern (replacing the deprecated `@supabase/auth-helpers-nextjs`). It satisfies the CLAUDE.md "use established library" rule.

### D7 — Pino logger with redaction

`lib/logger.ts` exports a configured Pino logger. Redaction paths cover: `*.cpf`, `*.email`, `*.phone`, `*.password`, `*.token`, `*.jwt`, `headers.authorization`, `headers.cookie`, `body.message`, `transcription`, `note` (free-text fields commonly carrying clinical content).

Logger level: `info` in production, `debug` in development, `silent` in tests. The level is read from `serverEnv.LOG_LEVEL` with a sensible default.

**Rationale:** redaction at the logger boundary makes accidental PII logging impossible from inside feature code, satisfying LGPD requirements.

### D8 — Vitest integration config: separate file, suffix `*.int.test.ts`

A second Vitest config (`vitest.integration.config.ts`) registers a `globalSetup` that boots the Testcontainers Postgres, applies migrations via Drizzle, and exports the connection string into `process.env.DATABASE_URL` for the test process. The unit config from wave 1 is unchanged.

File suffix `*.int.test.ts` ensures the unit runner ignores integration tests. CI runs `npm run test:integration` separately from `test:unit`.

`globalSetup` uses `.withReuse()` so consecutive runs share the container and only re-apply migrations diffs; first boot is ~10s, subsequent ~1s.

**Rationale:** cleanly separates concerns and keeps the unit suite fast.

### D9 — Integration helpers: `runAsUser`, `runAsService`, factories

Helpers in `__tests__/integration/setup/`:
- `runAsUser(jwt)` — opens a connection where `request.jwt.claims` is set; queries within the callback execute under that JWT and RLS is enforced.
- `runAsService()` — opens a service-role connection (RLS bypass) for setup/teardown of fixtures.
- A factory module per schema domain (e.g., `__tests__/integration/factories/health-pings.ts`) generates valid rows derived from the Drizzle schema types.

**Rationale:** every integration test will need these. Standardizing them once removes test-by-test reinvention.

### D10 — Playwright config: `webServer` + `globalSetup`, single project

`playwright.config.ts` runs `npm run build && npm run start` via `webServer`, with `reuseExistingServer: true` in dev. `globalSetup` boots Testcontainers (same image as integration) and applies migrations + a small seed (one user + one `health_ping`).

Single Playwright project (`chromium`) for now; multi-browser deferred until justified. `auth.setup.ts` performs a programmatic signin by writing the simulated `supabase.auth.token` cookie into `storageState`. Tests that need an authenticated session import that `storageState`; the smoke test in this wave is anonymous.

`e2e/tags.json` is a registry: `{ "@health": "Health endpoints", "@auth": "Auth flow (default suite, simulated)", "@auth-real": "Auth flow (wave 3, real gotrue)" }`. Tags are applied via Playwright's `test.describe` and matched via `--grep`.

**Rationale:** Playwright's `globalSetup` is the lowest-friction way to share a Testcontainers instance across all e2e tests. The simulated cookie approach is the e2e-tests skill's documented default and works without a real auth service.

### D11 — CI: extend single workflow with two jobs

`ci.yml` grows from one job (`quality`) to three (`quality`, `integration`, `e2e`). All run on `ubuntu-latest`, all gated on `quality` passing first via `needs:`. Caching:
- Node modules: `actions/setup-node@v4` `cache: npm`.
- Playwright browsers: `actions/cache@v4` keyed on `package-lock.json` hash, path `~/.cache/ms-playwright`.
- Testcontainers images: rely on Docker layer cache — no explicit cache action, since containers boot from base images already on the runner image.

E2e job runs on every PR (per the explicit alignment decision earlier in this thread). First-run timing is unknown; we'll observe and tighten if it exceeds ~10 minutes.

**Rationale:** the matrix-vs-jobs split is a wash; jobs are clearer when each uses different services. Three jobs running in parallel after `quality` fits a typical PR runtime budget.

### D12 — Docker compose: minimal, supplements `supabase start`

`docker-compose.yml` only contains the Next.js dev container with the Supabase local network bridged in. Developers run `supabase start` separately (it manages its own containers via the CLI's compose file). Compose's value-add is one-liner dev parity with future contributors who don't want to install the Node toolchain locally.

**Rationale:** duplicating Supabase in our compose file would diverge from the CLI's official topology and break on every CLI upgrade. Bridge in, don't replicate.

### D13 — Reserve `@auth-real` namespace, defer the suite

Add `@auth-real` to `e2e/tags.json` with a one-line description noting "introduced in wave 3 — see smoke-health-feature change". Do not write a Playwright project for it yet, and do not add a CI job for it. Wave 3 introduces both alongside its real test.

**Rationale:** registering the tag now makes the future addition smaller and signals to anyone reading `tags.json` that it is intentionally absent here.

## Risks / Trade-offs

- **Schema and RLS template are a hard contract** → every future domain table will copy `health_pings`. Reverting the convention later means migrating every table. Mitigation: the template is mechanical; review the example and the linter test carefully before merging.
- **Manual RLS-SQL append to migrations** → easy to forget. Mitigation: the lint test (D4) catches missing policies.
- **`supabase start` developer machine cost** → Docker memory and disk. Mitigation: `supabase stop` documented; mention in README.
- **Testcontainers image pull on first CI run** → adds 30–60s to first PR. Mitigation: subsequent runs hit the runner image cache.
- **CI runtime grows from ~1min to ~5–10min** → slower iteration on PRs. Mitigation: e2e parallelism via `fullyParallel: true`, `workers: 4`. If still too slow, consider sharding e2e in a follow-up.
- **`globalSetup` boots Testcontainers twice** (once for integration, once for e2e) → wasted 5–10s. Mitigation: accept; coordinating across runners is more complex than the savings warrant.
- **Pino redaction is path-based** — a structurally novel field carrying PII would not be redacted automatically. Mitigation: code review + add new paths whenever a new sensitive field is introduced. Document the redaction list in `lib/logger.ts`.
- **`@supabase/ssr` cookie API changes** between Supabase major versions → could break helpers. Mitigation: pin Supabase JS SDK to a known-good range; surface in dependabot/renovate config when introduced.

## Migration Plan

No prior state to migrate. Rollback is `git revert`. The wave's outputs are local-only until the resulting PR is merged; CI will exercise the new jobs and surface failures before merge.

A failed wave-2 PR can be reverted cleanly because no production data exists yet.

## Open Questions

- **Pin a specific Supabase CLI version in the README?** Argument for: prevents version drift across contributors. Argument against: forces manual updates. **Recommendation:** document the minimum version in `README.md` and revisit if version skew bites us.
- **Vercel Postgres or stay 100% Supabase for prod?** Out of scope here, but the schema layout assumes Supabase Postgres in prod. Decision deferred.
- **Should `runAsUser` write `request.jwt.claims` or use a real JWT signed with the Supabase JWT secret?** Real JWT is more faithful but more setup. **Recommendation:** start with `set local request.jwt.claims = '{"sub": "<uuid>"}'` (faster, no secret needed); upgrade to real JWT only if a test requires it.
