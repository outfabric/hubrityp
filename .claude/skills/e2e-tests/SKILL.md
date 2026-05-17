---
name: e2e-tests
description: Best practices for writing E2E tests in TypeScript + Next.js using Playwright (with Testcontainers Postgres when the test requires a real database). Use whenever you need to create, review or refactor end-to-end user-flow tests — authentication, browser CRUD, scheduling, WhatsApp reminders, prescription generation, billing/PIX, telepsychology, medical records — or when the user asks to "create an E2E test", "smoke test", "flow test", "test via browser", configure Playwright, handle `storageState`/auth reuse, mock external APIs via `page.route()`, or cover a critical flow before a PR.
---

# E2E Tests (Playwright + Testcontainers)

Skill for the `fullstack-developer` subagent to produce E2E tests that validate **the user flow in the browser**, against the real Next.js application and a real Postgres. Focus on **critical flows** of HubrityP, not broad coverage — E2E is expensive, keep it lean.

## Scope

Use Playwright to validate:

- **Critical end-to-end flows**: signup/login, patient CRUD, scheduling, WhatsApp reminder, digital prescription, PIX billing, telepsychology session, medical records (list in `references/critical-flows-hubrityp.md`).
- Behaviors that depend on the **real browser**: redirects, session, cookies, navigation between routes, RSC hydration.
- Post-deploy smoke tests (fast subset in production/staging with a test auth).

Do not use E2E for:

- Pure logic, validators, helpers → **`unit-tests`**.
- Server Actions/Route Handlers against the DB → **`integration-tests`**.
- Isolated validation of RLS or Drizzle queries → **`integration-tests`**.

The pyramid holds: many unit tests, several integration tests, **few E2E** (~1 per critical journey).

## Two E2E suites (and two Playwright configs)

HubrityP runs E2E in **two separate suites**, each with its own config:

| Suite | Config | Test directory | Auth | When |
|---|---|---|---|---|
| **seeded** (`@<domain>` tags) | `playwright.seeded.config.ts` | `src/__tests__/e2e/seeded/` | Mock GoTrue + cookie via `storageState` (programmatic) | Default — every critical journey |
| **real** (`@auth-real`) | `playwright.real.config.ts` | `src/__tests__/e2e/real/` | Real Supabase stack (`supabase start`) | Smoke of the real auth flow (signup/refresh/logout) — once per release |

Commands:

```bash
npm run test:e2e:seeded    # default suite — Playwright + Testcontainers Postgres + mock GoTrue
npm run test:e2e:real      # requires `npx supabase start` running; validates the real auth path
```

> **Port conflict**: the two suites do not run in parallel. Both need `127.0.0.1:54321` (the local Supabase port that `next build` inlines into `NEXT_PUBLIC_SUPABASE_URL` in the edge bundle). Stop one before starting the other. See "Critical notes" block below.

## Test stack and architecture

| Layer | Tool | Function |
|---|---|---|
| Browser driver | `@playwright/test` | Chromium/Firefox/WebKit, web-first assertions, auto-wait |
| App under test | Next.js via the config's `webServer` | `npm run build && npm run start` on a dedicated port |
| Database | `@testcontainers/postgresql` (`postgres:16-alpine` in HubrityP) | Postgres container with Drizzle migrations applied + minimal bootstrap of the `auth` schema |
| Shared container | `src/__tests__/e2e/_shared/postgres-container.ts` | Same module used by the integration runner — single source of boot |
| Auth (seeded suite) | Mock GoTrue + `auth.setup.ts` doing a programmatic signin and saving `storageState` | Reused across all tests via dependent project |
| Auth (real suite) | `supabase start` + cookies issued by the real GoTrue | No global `storageState` — each test operates on the `supabase start` DB |
| External integrations (Twilio, Asaas, Receita Saúde) | `page.route()` in the fixture | Intercepted before leaving the browser |
| Test data | Node helpers that write straight to the DB via Drizzle | Fast, outside the browser |

## Decision: Testcontainers vs `supabase start` for E2E

| Criterion | Testcontainers Postgres-only (seeded suite) | `supabase start` (real suite) |
|---|---|---|
| Real auth (gotrue) | No — simulated by mock GoTrue + cookie | Yes |
| Real storage | No — mocked in `page.route()` | Yes |
| CI boot speed | Fast (~5–10s) | Slow (~30–60s) |
| Fidelity | Medium | High |
| Per-run isolation | Excellent (`.withReuse()`) | Shared |

**Default for this skill:** seeded suite (Testcontainers Postgres + mock GoTrue + cookie via `@supabase/ssr`). The real suite is reserved for a single smoke spec per release.

## File structure

```
playwright.seeded.config.ts                            # config for the default suite
playwright.real.config.ts                              # config for the @auth-real suite
src/
  __tests__/
    e2e/
      _shared/
        postgres-container.ts                          # bootPostgres + applyMigrations (shared with integration)
      seeded/
        setup/
          start-server.ts                              # webServer wrapper: boot Postgres + mock GoTrue + spawn `next start`
          global-setup.ts                              # Playwright globalSetup: seed users + base data
          global-teardown.ts
          auth.setup.ts                                # programmatic signin -> storageState (.auth/state.json)
          seed-state.ts                                # serializes metadata for auth.setup.ts to read
          mock-gotrue.ts                               # HTTP server that emulates GoTrue
          .auth/                                       # generated at runtime (gitignored): state.json, seed-state.json
        tags.json                                      # mapping file->domain tag
        auth.spec.ts                                   # domain specs
        smoke.spec.ts
        ...
      real/
        setup/
          global-setup.ts
          global-teardown.ts
          credentials.ts
        auth.spec.ts                                   # @auth-real, against `supabase start`
```

The `.spec.ts` suffix is the Playwright standard (not to be confused with `.test.ts` / `.int.test.ts` from Vitest).

## Principles

1. **User flows, not pages**: a test covers a journey (`schedule consultation`), not an isolated screen.
2. **Semantic locator**: `getByRole`, `getByLabel`, `getByText`. **Never** fragile CSS selectors. `data-testid` only as a last resort and always stable.
3. **No `sleep`/`waitForTimeout`**: use the locators' auto-wait (`expect(...).toBeVisible()`) or `page.waitForURL`/`page.waitForResponse` when you need a specific event.
4. **Auth once per worker**: the setup project generates `storageState` at `src/__tests__/e2e/seeded/setup/.auth/state.json`; each test starts logged in in <100ms via `test.use({ storageState: STORAGE_STATE_PATH })`.
5. **Data via direct DB**, not via UI: need to create a patient for a scheduling test? `db.insert(pacientes)`. Registering via the form in every test wastes time and widens the failure surface.
6. **Mock external integrations in `page.route()`**: Twilio, Asaas, Receita Saúde. The database stays real.
7. **Per-test isolation**: TRUNCATE in the fixture's `beforeEach` (same pattern as the integration skill), except seed users that back the `storageState`.
8. **Fail fast and loud**: no `try/catch` that hides errors; trace + screenshot + video automatic on failure.

## Canonical example

```ts
// src/__tests__/e2e/seeded/agendamento.spec.ts
import { expect, test } from '@playwright/test';
import { STORAGE_STATE_PATH } from './setup/seed-state';
import { createPaciente } from './helpers/db';

test.use({ storageState: STORAGE_STATE_PATH });

test.describe('@agenda scheduling a consultation', () => {
  test('psychologist schedules a consultation and sees it on the agenda', async ({ page }) => {
    const dr = { id: '00000000-0000-4000-8000-000000000001' };
    await createPaciente({ psicologoId: dr.id, nome: 'Maria Silva' });

    await page.goto('/agenda');
    await page.getByRole('button', { name: /nova consulta/i }).click();

    await page.getByLabel(/paciente/i).click();
    await page.getByRole('option', { name: 'Maria Silva' }).click();
    await page.getByLabel(/data/i).fill('2026-06-01');
    await page.getByLabel(/horário/i).fill('14:00');
    await page.getByRole('button', { name: /confirmar/i }).click();

    await expect(page.getByText(/consulta agendada/i)).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Maria Silva' })
    ).toBeVisible();
  });
});
```

## Antipatterns

- Testing everything: every bug gets an E2E. Result: a 30-min suite in CI. Bug → unit + integration; journey → E2E.
- `page.waitForTimeout(2000)` to "wait for the page to load".
- CSS selectors (`page.locator('.btn-primary > span')`).
- Login via UI in every test (slow and flaky).
- Sharing a patient/appointment between tests (`test.describe.serial` is a code smell — signals a poorly modeled dependency).
- Sprinkling `data-testid` everywhere "preventively" — only where role/label do not suffice.
- Screenshot snapshots for content validation (use text/role assertions; reserve screenshots for visual regression with `toHaveScreenshot()` in calibrated cases).
- Calling Twilio/Asaas/Receita Saúde for real — **a flaky test in CI becomes the habit of re-running until it passes**.
- Moving Postgres boot or external mock to `globalSetup` — Playwright spins up `webServer` BEFORE `globalSetup`, so the Next runtime env will be incomplete. Boot inside the `start-server.ts` wrapper (see "Critical notes").

## Critical notes (real gotchas)

> These gotchas live here because they have burned the team once. Before touching `playwright.seeded.config.ts`, `playwright.real.config.ts`, `start-server.ts` or anything involving `supabase.auth.getUser()` on the server, re-read.

### `NEXT_PUBLIC_*` is inlined into the edge runtime at build time

`src/middleware.ts` runs on the edge runtime, and Next inlines the value of `NEXT_PUBLIC_SUPABASE_URL` into the bundle at `next build` time. You cannot override it via `webServer.env` at runtime — the middleware will always hit the host/port that the build saw. That's why the mock GoTrue of the seeded suite must listen on the **same hardcoded port** the build knows (`127.0.0.1:54321`, same as `supabase start`). The canonical helper in `src/__tests__/e2e/seeded/setup/mock-gotrue.ts` (`startMockGotrue({ port })`) accepts an override but defaults to `54321`. Consequence: the two suites (seeded and real) **do not run concurrently** — they fight for the port.

### Playwright starts `webServer` BEFORE `globalSetup`

Verifiable in `node_modules/playwright/lib/runner/tasks.js::createGlobalSetupTasks`. Anything that `globalSetup` writes into `process.env` (dynamic URL of the Testcontainers Postgres, ephemeral mock port) is invisible to the spawned Next.js — `webServer.env` is captured at config-load. Canonical workaround: `src/__tests__/e2e/seeded/setup/start-server.ts` does the dynamic boot (Postgres + mock GoTrue) and only then `exec`s `next start`, ensuring a complete env at the right moment. This reusable pattern applies to any future suite that needs ephemeral resources before the server.

### `playwright.real.config.ts` calls `execSync` at top-level

Same problem as the previous section in another disguise. Since `webServer.env` is captured at config-load and the `@auth-real` suite depends on URLs/keys that only exist after `npx supabase start`, `playwright.real.config.ts` calls `execSync('npx supabase status -o json')` synchronously at top-level — _not_ in `globalSetup`. **Do not try to "fix" by moving to `globalSetup`**: it will look cleaner and break as described above, because the spawned Next does not see the vars.

## Detailed references

Load as the task requires:

- `references/setup.md` — `playwright.seeded.config.ts`, `playwright.real.config.ts`, `webServer`, projects, project dependencies, integration with Testcontainers via `_shared/postgres-container.ts`.
- `references/auth-storage-state.md` — `auth.setup.ts`, programmatic signin with `@supabase/ssr` against mock GoTrue, cookie scope, real vs seeded suite.
- `references/locators-interactions.md` — locator hierarchy, auto-wait, `expect.poll`, form and table patterns.
- `references/network-mocking.md` — `page.route()` for Twilio, Asaas, Gemini, Receita Saúde; verifying requests; `routeFromHAR` for complex flows.
- `references/test-data.md` — factories that write straight to the DB via Drizzle, isolation between tests, immutable seed users.
- `references/critical-flows-hubrityp.md` — prioritized list of journeys that should have E2E and those that should not.
- `references/ci-artifacts.md` — trace viewer, screenshots, videos, retries, sharding in CI.

## Templates

- `assets/playwright.config.ts` — **legacy**: HubrityP uses `playwright.seeded.config.ts` + `playwright.real.config.ts` at the repo root. Use the real configs as a reference instead of this asset.
- `assets/global-setup.ts` — boots the container, applies migrations, creates seed users.
- `assets/auth.setup.ts` — programmatic signin → `storageState`.
- `assets/db-helpers.ts` — Drizzle client and factories.
- `assets/test-base.ts` — extended fixture with `dr` (logged-in psychologist) and default network mocks.
- `assets/example.e2e.spec.ts` — ready-to-use spec skeleton.
