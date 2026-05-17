---
name: integration-tests
description: Best practices for writing integration tests in TypeScript + Next.js with Vitest, React Testing Library and Testcontainers (real Postgres in a Docker container, with Drizzle migrations and Supabase RLS applied). Use whenever you need to create, review or refactor tests that cross real boundaries — Server Actions or Route Handlers against real Postgres, Drizzle queries against the real schema, RLS policy validation, or integrated UI flows (RTL with real providers and MSW for HTTP). Applies when the user asks to "test against real DB", "validate RLS", "integration test", "mock network via MSW", "test Server Action end to end", configure Testcontainers, or when a new feature requires integration coverage before the PR.
---

# Integration tests (Vitest + RTL + Testcontainers)

Skill for the `fullstack-developer` subagent to produce integration tests in HubrityP. Focus: **exercise real boundaries** (Postgres with schema/RLS applied, Server Actions calling real Drizzle) and **isolated external dependencies** (HTTP via MSW, queues and email mocked at the edges).

## Scope

Use this test level to validate:

- Server Actions and Route Handlers against real Postgres (Drizzle + migrations applied).
- Drizzle queries and composition of joins/transactions.
- **Supabase RLS policies** with `auth.uid()` set via simulated JWT claims.
- Integrated UI flows in RTL (real providers: TanStack Query, Theme, Toaster), with HTTP intercepted by MSW.
- Received webhooks (Twilio, Asaas, Receita Saúde) — real Route Handler, real payload, real DB, outbound integrations mocked.

Do not use this level for:

- Pure logic, validators, helpers → **Vitest unit** (skill `unit-tests`).
- Full navigation flow in the browser, screenshots, multi-tab → **Playwright E2E**.
- Performance/load → dedicated tool, out of scope.

## Why Testcontainers (and not just the local Supabase CLI)

| Criterion | `supabase start` (CLI) | Testcontainers (`@testcontainers/postgresql`) |
|---|---|---|
| Isolation between test files | Shared, manual | Container per suite (or `globalSetup`) |
| CI speed | Good (1 boot) | Very good with `reuse` enabled |
| Fidelity to Supabase Postgres | High (same stack) | High with `supabase/postgres` image |
| Required for daily local dev | Yes — do not replace | No — only for tests |
| Safe parallelism | Limited | Yes, via schema-per-suite |

**Rule of thumb:** Testcontainers for the integration suite (CI and dev). `supabase start` remains the development environment (Studio UI, Auth, Storage, Realtime). Both coexist.

## Recommended structure

All tests live **centralized** under `src/__tests__/`. Integration uses the `.int.test.ts` suffix so Vitest's filter picks up only this layer.

```
vitest.config.ts                                  # unit (fast, no container)
vitest.integration.config.ts                      # integration (globalSetup + container)
src/
  __tests__/
    integration/
      setup/
        global-setup.ts                           # Vitest globalSetup: calls bootPostgres + applyMigrations
        db.ts                                     # Drizzle client / openClient() for the container
        run-as-user.ts                            # RLS helper: SET LOCAL role + jwt.claims
        run-as-service.ts                         # bypasses RLS to prepare data
        msw-server.ts                             # MSW server for mocking external HTTP
      factories/
        health-pings.ts                           # typed factory from the Drizzle schema
      api-health.int.test.ts                     # example: Route Handler against real DB
      auth-signin.int.test.ts                    # example: domain Server Action
      app/(app)/pacientes/                        # mirror of the source when the test is for a route
        actions.int.test.ts
    e2e/
      _shared/
        postgres-container.ts                     # CONTAINER SHARED between integration and seeded e2e
      seeded/...
      real/...
    stubs/
      server-only.ts                              # no-op for `server-only` imports
src/
  modules/<domain>/server/...                     # Server Actions under test
  shared/db/schema/...                            # Drizzle schema targeted by migrations
```

> **Shared Postgres container**: `src/__tests__/e2e/_shared/postgres-container.ts` is the single module that boots Postgres + bootstraps the `auth` schema + runs Drizzle migrations. Both `vitest.integration.config.ts` (via `src/__tests__/integration/setup/global-setup.ts`) and the seeded e2e (via `src/__tests__/e2e/seeded/setup/start-server.ts`) import from there. Do not duplicate: if you need to touch the boot, touch it there.

## Standard workflow (lean flow)

1. **Identify the boundary under test**: Server Action? Route Handler? Query? Integrated component?
2. **Boot the environment once** via `globalSetup`: Postgres container with `supabase/postgres` (or `postgres:16-alpine` + manual bootstrap of the `auth` schema, which is what `_shared/postgres-container.ts` does today), Drizzle migrations applied, extensions enabled.
3. **Isolate data between tests** with the chosen strategy (see `references/data-isolation.md`). Default: `TRUNCATE` in `beforeEach` of the touched tables — fast and predictable.
4. **Mock only external integrations** (Twilio, Resend, Receita Saúde). The DB is real.
5. **For RLS**, connect as `authenticated` and set `request.jwt.claims` at session level. See `references/rls-supabase.md`.
6. **For integrated UI**, use RTL with real providers and MSW as the network layer. See `references/ui-integration-rtl.md`.

## Principles

1. **The DB is the source of truth**: never mock Drizzle or the Postgres client in integration tests — it defeats the purpose.
2. **Determinism > speed**: prefer explicit `TRUNCATE` over relying on execution order.
3. **RLS coverage is mandatory** for any Server Action that touches a table with a policy. Test at least: owner reads, owner writes, **another psychologist does NOT read**, **another psychologist does NOT write**.
4. **MSW on the network, no monkeypatching**: replace `fetch` with an MSW handler; keeps the code under test identical to production.
5. **Typed factories** (`createPaciente()`, `createAgendamento()`) reusable across all suites — derive types from the Drizzle schema (`InferInsertModel`, `NewHealthPing`, etc.).
6. **Fail for a clear reason**: if an RLS test breaks, it should be obvious whether it was the query or the policy.
7. **Do not log PII in test output**: configure Pino with level `silent` in the global setup.

## Canonical example (Server Action against real DB, with RLS)

```ts
// src/__tests__/integration/app/(app)/pacientes/actions.int.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/__tests__/integration/setup/db';
import { runAsUser } from '@/__tests__/integration/setup/run-as-user';
import { truncateAll } from '@/__tests__/integration/setup/run-as-service';
import { criarPaciente, listarPacientes } from '@/modules/pacientes/server/actions';
import { createPsicologo } from '@/__tests__/integration/factories/psicologo';

describe('pacientes — integration', () => {
  beforeEach(() => truncateAll(db, ['pacientes', 'psicologos']));

  it('psychologist only sees their own patients (RLS)', async () => {
    const dr_a = await createPsicologo();
    const dr_b = await createPsicologo();

    await runAsUser(dr_a.id, () =>
      criarPaciente({ nome: 'Maria', cpf: '529.982.247-25' })
    );

    const pacientesDoB = await runAsUser(dr_b.id, () => listarPacientes());

    expect(pacientesDoB).toEqual([]);
  });
});
```

> **Imports**: the `@/*` alias resolves to `src/*` (post-`reorganize-folder-structure`). The Server Action under test comes from the module (`@/modules/pacientes/server/actions`), not from the route shell at `@/app/(app)/.../actions` — the shell is just a `'use server'` wrapper that delegates.

## Antipatterns

- Mocking `db` or `drizzle` in an integration test.
- Sharing data between tests ("the previous test creates the patient the next one uses").
- Using `process.env.DATABASE_URL` pointing to Supabase staging/production.
- Forgetting `await container.stop()` in teardown — leaks the container between runs.
- Testing integrated UI by hitting the real network (without MSW) — flaky in CI.
- Huge DOM snapshots — break on irrelevant Tailwind changes.
- Validating RLS by testing "whether the SQL policy exists" instead of proving the **behavior**: another user gets an empty list, or a `42501` error.
- Importing from the module barrel (`@/modules/auth`) inside a Client Component — drags `server-only` into the bundle. For Server Actions used in forms, import from the route shell (`@/app/(auth)/login/actions`); for server-side use, the barrel is OK.

## Detailed references

Load as the task requires:

- `references/testcontainers-setup.md` — `globalSetup` backed by `@/__tests__/e2e/_shared/postgres-container`, container image, `auth` schema bootstrap, Drizzle migrations (`src/shared/db/migrations`), container reuse, test env.
- `references/data-isolation.md` — comparison: TRUNCATE vs transaction with rollback vs schema-per-suite. When to use each.
- `references/rls-supabase.md` — recipes for connecting as `authenticated`, setting `request.jwt.claims`, `runAsUser` helper, mandatory cases.
- `references/server-actions-routes.md` — testing Server Actions and Route Handlers (webhooks) against real DB, mocks for external boundaries.
- `references/ui-integration-rtl.md` — RTL with real providers, MSW for the network, integration with Server Actions.
- `references/factories.md` — typed factories from the Drizzle schema, generation of realistic data.

## Templates

- `assets/vitest.integration.config.ts` — config separate from unit, with `globalSetup`, larger timeout and `pool: 'forks'`.
- `assets/global-setup.ts` — calls `bootPostgres()` + `applyMigrations()` from the shared module and exposes `DATABASE_URL` via `process.env`.
- `assets/db.ts` — single Drizzle client reused in tests.
- `assets/rls.ts` — `runAsUser`, `truncateAll` helpers.
- `assets/msw-server.ts` — MSW bootstrap for Node (test env).
- `assets/example.integration.test.ts` — ready-to-use skeleton.
