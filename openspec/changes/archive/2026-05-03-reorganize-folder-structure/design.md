## Context

The repository today places application code, the data layer, four test directories, and 12+ config files at the root. The two production capabilities implemented so far — `auth` and `health` — already exhibit the symptoms the `CLAUDE.md` engineering standard warned about: helpers and Supabase clients live in a flat `lib/`, Server Actions live in `app/(auth)/login/actions.ts` next to the route, and there is no `modules/<domain>/` to anchor future capabilities. Tests are split across:

- `__tests__/integration/` — Vitest + Testcontainers (canonical)
- `e2e/` — Playwright with mock GoTrue, Testcontainers Postgres
- `e2e-auth-real/` — Playwright with real `supabase start` stack
- `*.test.ts` colocated next to source in `lib/` and `app/`
- `test/stubs/` — single-file helper

Two Playwright configs exist (`playwright.config.ts`, `playwright.auth-real.config.ts`); the second's intent is only legible after reading 30 lines of comments. The data layer is split between `db/` (Drizzle convention: schema + migrations + CLI) and `lib/db/index.ts` (runtime client). The Drizzle CLI script `db/migrate.ts` is the only non-application TypeScript file living in `db/`.

The change does the structural work now, while only two domains exist. Doing it after billing, scheduling, prontuário, and telepsicologia land would multiply the cost (more files to move, more imports to rewrite, more reviewers).

The shape of the target was settled during `/opsx:explore`. This design document records the decisions and surfaces the migration sequencing, not the exploration that produced them.

## Goals / Non-Goals

**Goals:**

- Adopt `src/` as the application root so `next.config.ts`, `tsconfig.json`, ESLint, and the test runners all converge on a single application tree.
- Establish `src/modules/<domain>/` as the canonical home for domain code, with `auth/` and `health/` as the seed modules. Each module owns its `components/`, `server/` (Server Action implementations), `lib/` (validators, mappers, branded types), and a public `index.ts`.
- Establish `src/shared/` as the home for cross-module concerns: `ui/` (shadcn primitives), `lib/` (utils, logger), `env/` (validated env), `supabase/` (Supabase clients used by any module), `db/` (Drizzle client + schema + migrations).
- Make the route layer (`src/app/`) a thin shell. `page.tsx` files compose components from modules; `actions.ts` files re-export `'use server'` functions from `src/modules/<domain>/server/`.
- Centralize all test code under `src/__tests__/{unit,integration,e2e/{_shared,seeded,real},stubs}/`. The `seeded` and `real` subdirectories make the e2e split self-documenting. The shared `_shared/postgres-container.ts` is reachable from both integration and seeded e2e suites.
- Move the migration CLI script out of `src/` (it is a tool, not application code) into `scripts/db-migrate.ts`.
- Rename Playwright configs to `playwright.seeded.config.ts` and `playwright.real.config.ts` so the split is visible in the file tree.
- Move `prd/` into `docs/prd/` so all human-readable documentation lives under `docs/`.
- Keep `git mv` history for every file moved (no copy-then-delete).

**Non-Goals:**

- No changes to product behavior. HTTP routes (`/`, `/login`, `/dashboard`, `/api/health`, `/api/me`), database schema, RLS policies, env-var names, and CLI command names (other than `test:e2e` → `test:e2e:seeded`) all stay identical.
- No new dependencies. No version bumps. No refactor inside any module beyond what the move requires.
- No introduction of placeholder modules for future capabilities (`scheduling/`, `billing/`, `patients/`, ...). The convention is documented; pasta vazia is YAGNI.
- No retroactive cleanup of `lib/test-utils/mock-gotrue.ts` beyond moving it to its callers — its API stays the same.
- No CI architecture changes (the three-job `quality` → `integration` + `e2e` shape is preserved). Only the file paths inside the workflow change.
- No migration to Turbopack-only or any Next.js feature beyond what is already in use.

## Decisions

### Decision: Adopt `src/` as the application root

`src/` is officially supported by Next.js as an alternative to root-level `app/`. Today the root has 16 entries with 5 dedicated to test configs alone. Moving application code under `src/` leaves the root for tooling, configs, docs, and the test runners' configs.

**Alternatives considered:**

- *Keep flat root.* Lower migration cost but does not address the conflation of application and tooling at the root, which is the underlying complaint.
- *Use `app/` at root with a sibling `modules/`, `shared/`, `__tests__/` at root.* Saves one path level but keeps tooling configs interleaved with source. The marginal gain from skipping `src/` is small once the alias `@/*` already abstracts the depth.

**Why this decision:** Conventional, documented, and creates a clean boundary between "things the editor + bundler care about" (under `src/`) and "things the developer + CI care about" (the rest).

### Decision: `src/modules/<domain>/` with route shells delegating to module servers

Server Actions colocated in `app/(auth)/login/actions.ts` are idiomatic Next.js, but they conflict with the `CLAUDE.md` mandate to "estruture código por domínio". The compromise: route files stay in `src/app/` (Next.js requires it) but become thin shells. Each route file imports from `src/modules/<domain>/`:

```
src/app/(auth)/login/page.tsx           → imports <LoginForm/> from @/modules/auth
src/app/(auth)/login/actions.ts         → 'use server' wrapper that calls login() from @/modules/auth/server/login
src/modules/auth/components/login-form.tsx
src/modules/auth/server/login.ts        → real action body (DB calls, Supabase calls, validation)
src/modules/auth/lib/login-input-schema.ts
src/modules/auth/index.ts               → re-exports the public API
```

**Alternatives considered:**

- *All logic stays in `app/(auth)/login/actions.ts`.* Idiomatic Next.js but defeats the modules-by-domain rule and forces every future capability to keep its logic next to its route, which fragments domain ownership.
- *Route file is a single `export { default } from '@/modules/auth/pages/login'`.* Minimal app/ surface but loses the readability of the route tree mirroring the URL tree.

**Why this decision:** Route files remain self-evident in `src/app/`, but real domain logic is reachable from one place per module. Cross-module reuse becomes straightforward (`import { signIn } from '@/modules/auth'`).

### Decision: `src/shared/` for cross-module concerns, including `supabase/` and `db/`

`supabase/` (clients for browser, server, and middleware) and `db/` (Drizzle client + schema + migrations) are not auth-specific. Any future module (billing, scheduling, prontuário) will use both. Placing them in `src/modules/auth/` would force re-exports from every consumer; placing them at `src/shared/` makes the dependency direction explicit (modules depend on shared; shared never depends on modules).

**Why this decision:** Single owner for infrastructure-style code; modules consume but never extend it.

### Decision: Consolidate the data layer at `src/shared/db/`, move the CLI to `scripts/`

`db/schema/` and `db/migrations/` belong with `db/client.ts` so a single import path covers schema, client, and migrations metadata. The Drizzle CLI script (`db/migrate.ts` today) is operational code, not application code — it moves to `scripts/db-migrate.ts`. `drizzle.config.ts` is updated to point `schema` and `out` at the new locations.

**Alternatives considered:**

- *Keep `db/` at root* (Drizzle's documented convention). Keeps Drizzle defaults but preserves the visual collision with `lib/db/`.
- *Rename root `db/` to `drizzle/`*. Removes the collision but diverges from upstream docs and most StackOverflow answers.

**Why this decision:** Consolidation eliminates the split. The Drizzle config is one line of change and isolates the divergence from the upstream default.

### Decision: Centralize all tests under `src/__tests__/{unit,integration,e2e/{_shared,seeded,real},stubs}/`

The user opted for centralized tests over Next.js-recommended colocation. The trade-off: every component edit requires flipping between `src/modules/<domain>/components/foo.tsx` and `src/__tests__/unit/modules/<domain>/components/foo.test.tsx`, but the test tree mirrors the source tree exactly and a single `src/__tests__/` glob covers every test file in the repo.

**`src/__tests__/` (not `tests/` at root) is intentional.** Keeping tests under `src/` means the `@/*` alias resolves to `src/*` and `from '@/__tests__/integration/setup/db'` works without adding a separate `@tests/*` alias. The trade-off is that `__tests__/` historically connotes colocation; here it is the centralized canonical location. This is documented in the integration-tests skill update.

**`_shared/postgres-container.ts`** sits under `src/__tests__/e2e/` because both the integration runner and the seeded e2e runner consume it. Placing it at `src/__tests__/_shared/` is also defensible (closer to integration), but the integration globalSetup is the only consumer outside e2e and the prefix-underscore folder naming convention is inherited from Next.js private folders.

**`next build` and `__tests__/`:** `next build` traces files reachable from routes. Test files are not imported from any route, so they are dead code from the bundler's perspective. As a defense-in-depth measure, `__tests__` is added to `next.config.ts` `outputFileTracingExcludes` so the production bundle never includes test sources even if a stray import sneaks in.

**Alternatives considered:**

- *Keep colocation* (Next.js + skill default). Closer to source but disperses test files across the entire `src/` tree, making "where do my tests live" non-obvious.
- *`tests/` at root* (rather than `src/__tests__/`). Free-standing but loses the alias convenience and adds a top-level entry alongside `src/`.

**Why this decision:** The user wants one canonical location; under `src/` with the `__tests__/` name keeps the alias clean.

### Decision: Rename Playwright configs to surface the split

`playwright.seeded.config.ts` and `playwright.real.config.ts` make the difference between the two suites visible in `ls`. The `auth-real` name was historical (the suite started as auth-only); `real` is the more general label as the suite grows.

**Why this decision:** Self-documenting filenames cost nothing once we are already touching the configs.

### Decision: `prd/` moves into `docs/prd/`

PRDs are documentation; nesting them under `docs/` consolidates all human-readable docs in one tree. `.temp/` stays gitignored (already partially is).

### Decision: Migration order is configs-first, then mass-mv, then codemod, then refactor, then verify

`npm run check` and the four test commands must stay green at every commit boundary. Order:

1. Add `src/` + `scripts/` + new test layout as empty skeletons (no moves yet).
2. Update configs (`tsconfig`, `vitest`, `playwright`, `drizzle`, `eslint`, `package.json`) to point at the new paths. Configs ALSO retain old paths via `include` arrays where possible to avoid a broken intermediate state, OR each config moves at the same commit as its consumers (cleaner but bigger commits).
3. `git mv` files into the new layout in the order: `lib/` → `src/shared/` and `src/modules/`, `db/` → `src/shared/db/`, `components/ui/` → `src/shared/ui/`, `app/` → `src/app/`, `middleware.ts` → `src/middleware.ts`, `__tests__/integration/` → `src/__tests__/integration/`, `e2e/` → `src/__tests__/e2e/seeded/`, `e2e-auth-real/` → `src/__tests__/e2e/real/`, `test/stubs/` → `src/__tests__/stubs/`, `db/migrate.ts` → `scripts/db-migrate.ts`, `prd/` → `docs/prd/`.
4. Codemod imports: `@/lib/utils` → `@/shared/lib/utils`, `@/lib/logger` → `@/shared/lib/logger`, `@/lib/env` → `@/shared/env`, `@/lib/supabase/*` → `@/shared/supabase/*`, `@/lib/auth/*` → `@/modules/auth/lib/*`, `@/db/schema` → `@/shared/db/schema`, `@/components/ui/*` → `@/shared/ui/*`. Use `ts-morph` or a `sed` pipeline; verify with `npm run typecheck` after each rename batch.
5. Refactor `app/(auth)/login/{login-form,actions}.tsx` and `app/(app)/actions.ts` into the shell-vs-module split. This is the only step that is not a pure move.
6. Update `components.json` (shadcn alias) to `@/shared/ui` and re-run `npx shadcn` only if necessary (no new components added in this change).
7. Update skills (`integration-tests`, `e2e-tests`, `unit-tests`) and docs (`docs/dev-cycle.md`, `.claude/commands/dev-cycle.md`, `.claude/commands/opsx/archive.md`, `README.md`, `CLAUDE.md`).
8. Update `.github/workflows/*.yml` test-path references.
9. Verify: `npm run check` + `npm run test:unit` + `npm run test:integration` + `npm run test:e2e:seeded` + `npm run test:e2e:real` (the last requires `npx supabase start`).

## Risks / Trade-offs

- **Risk: a migration step leaves the repo in a state where `npm run check` fails for arbitrary reasons (missing import, broken alias).** → Mitigation: each tasks.md step is a self-contained unit ending in `npm run check`. The order in the Migration section is engineered so configs are aware of new paths before files arrive (or move in the same commit). If a step breaks, only that step's files are in flight.
- **Risk: the `git mv` history breaks because some files cross the rename threshold.** → Mitigation: do moves in small batches (one module or one shared subdirectory per commit) so individual files have small content changes between move and edit. Verify with `git log --follow` on at least three sample files post-merge.
- **Risk: codemod silently misses an import edge case (template literals, dynamic `import()`, JSDoc paths, ESLint rule paths in `eslint.config.mjs`).** → Mitigation: `npm run typecheck` is the primary safety net (catches missing modules); `npm run lint` catches the ESLint config; manual grep for `from '@/lib/'`, `from '@/db/'`, `from '@/components/'` after the codemod confirms zero matches.
- **Risk: `playwright.seeded.config.ts` and `playwright.real.config.ts` already use port 54321 and cannot run concurrently.** → Mitigation: pre-existing constraint, documented in the existing `playwright.auth-real.config.ts` header. Carry the comment forward verbatim.
- **Risk: the auth shell→module refactor changes the import graph in a way that breaks Server Action wiring (Next.js requires `'use server'` to be the top of the file that exports the action).** → Mitigation: keep `'use server'` directives in the route-level `actions.ts` shells; the module's `server/login.ts` is a regular module that the shell wraps. Verified pattern: route action body is `export async function signIn(formData) { 'use server'; return signInImpl(formData); }` where `signInImpl` lives in the module.
- **Risk: the integration-tests skill currently shows colocation examples (`app/(app)/pacientes/actions.int.test.ts`); updating it without breaking other agents that read it.** → Mitigation: rewrite the skill's "Estrutura recomendada" section in the same change; the skill is a dependency of the `fullstack-developer` agent, but agents read fresh on every invocation, so there is no caching concern.
- **Risk: CI breaks because `.github/workflows/*.yml` references old paths (`__tests__/integration/...`, `e2e/...`).** → Mitigation: review every workflow file in the change; verify locally with `act` (or by reading the diff) before pushing.
- **Trade-off: centralized tests vs. colocation.** Accepted: the user prefers a single canonical location over editor proximity. The cost is a few extra editor jumps per session; the benefit is unambiguous coverage scans and a smaller `src/modules/` tree.
- **Trade-off: `src/` adds one level to every import path.** Accepted: the `@/*` alias absorbs the path depth in source code; only the editor file tree is one level deeper.
- **Trade-off: scripts/ at the root is a new top-level directory.** Accepted: `scripts/db-migrate.ts` is the only entry today; the directory documents the convention for future operational scripts (seeders, one-off migrations, RLS verifiers).

## Migration Plan

The full step-by-step ordering is in `tasks.md`. The high-level shape:

1. Skeleton + configs first.
2. Mass `git mv` in dependency-safe order (leaves first: `shared/lib`, `shared/env`, then `shared/supabase`, then `shared/db`, then `modules/auth`, `modules/health`, then `app/`, then `middleware.ts`, then tests, then `prd/`).
3. Codemod imports.
4. Auth shell→module refactor.
5. Skills + docs + CI.
6. Full verification: `npm run check` + four test commands.

Rollback: this is an in-PR change; if verification fails irrecoverably, the PR is closed and the worktree branch dropped (`git worktree remove`).

## Open Questions

- **`lib/test-utils/mock-gotrue.ts` final location.** It is a seeded-e2e-only helper. Proposed: `src/__tests__/e2e/seeded/setup/mock-gotrue.ts`. Confirm during apply.
- **`vitest.setup.ts` location.** Today it lives at the root. It is referenced by `vitest.config.ts`. Two options: stay at root (simple) or move to `src/__tests__/setup.ts` (consistent). Proposed: stay at root because it is config-adjacent, not test-adjacent.
- **`components.json` (shadcn) alias `aliases.components`.** Today: `@/components`. New: `@/shared/ui`. Confirm shadcn re-init is not needed (it is a config-only change; no regenerated files).
