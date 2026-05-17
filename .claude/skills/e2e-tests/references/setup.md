# Playwright + Testcontainers setup

## Installation

```bash
npm i -D @playwright/test @testcontainers/postgresql testcontainers \
        drizzle-orm postgres
npx playwright install --with-deps chromium
```

`--with-deps` installs the system libraries required on Linux/CI. In local dev it can be just `npx playwright install chromium`.

## The two Playwright configs

HubrityP separates the two suites into **two configs at the repo root**, each with its own `testDir`:

| Config | `testDir` | Suite | webServer |
|---|---|---|---|
| `playwright.seeded.config.ts` | `./src/__tests__/e2e/seeded` | Mock GoTrue + storageState | `start-server.ts` wrapper that boots Postgres + mock GoTrue + spawns `next start` |
| `playwright.real.config.ts` | `./src/__tests__/e2e/real` | Real Supabase (`supabase start`) | `npm run start` directly, with env injected from `npx supabase status -o json` read at config-load |

Commands:

```bash
npm run test:e2e:seeded
npm run test:e2e:real     # requires `npx supabase start` running
```

> **Port conflict**: the two suites do not run concurrently — both use `127.0.0.1:54321`. Stop one before the other.

## `playwright.seeded.config.ts` (default suite)

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/__tests__/e2e/seeded',
  testMatch: ['**/*.spec.ts', '**/*.setup.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // The wrapper boots Testcontainers Postgres + mock GoTrue and only then
    // spawns `next start`. Doing the boot inside `globalSetup` would not
    // work — Playwright starts `webServer` before `globalSetup`.
    command: 'npx tsx src/__tests__/e2e/seeded/setup/start-server.ts',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  globalSetup: './src/__tests__/e2e/seeded/setup/global-setup.ts',
  globalTeardown: './src/__tests__/e2e/seeded/setup/global-teardown.ts',
});
```

Key points:

- **`webServer.command`** points to the `start-server.ts` wrapper (not `npm run start` directly). The wrapper boots the shared Postgres container + mock GoTrue before spawning `next start`, making sure Next's env has `DATABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` resolved.
- **`globalSetup`** runs **after** `webServer`. Use only for seeding data (after the container already exists).
- **`projects`**: `setup` authenticates and saves `storageState` to `src/__tests__/e2e/seeded/setup/.auth/state.json`; `chromium` does not declare `storageState` at the project level — tests opt in via `test.use({ storageState: STORAGE_STATE_PATH })` (imported from `./setup/seed-state.ts`). Opt-in as default avoids failures in anonymous tests (e.g., redirect to `/login`).
- **`fullyParallel: true`** with `workers: 2` in CI; adjust if the suite starts fighting for the DB.
- **`retries: 2` in CI**: reduces network/timing flakiness. If a test only passes with retry, **investigate** — it is probably poorly written.

## `playwright.real.config.ts` (`@auth-real` suite)

The real suite is deliberately standalone — it does NOT spread the seeded config. It:

- Reads `npx supabase status -o json` at top-level (at config-load) to discover `API_URL`, `DB_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`.
- Refuses to start if `supabase start` is not running, with an actionable message.
- Uses `webServer.command: 'npm run start'` directly (no wrapper) — env comes whole from supabase status.
- `outputDir: 'test-results-real'` and `playwright-report-real` to avoid colliding with the seeded suite.

```ts
// playwright.real.config.ts (summarized — see the real config for the supabase status execSync)
export default defineConfig({
  testDir: './src/__tests__/e2e/real',
  testMatch: ['**/*.spec.ts'],
  workers: 1,
  outputDir: 'test-results-real',
  // ...
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    env: {
      DATABASE_URL: status.DB_URL,
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      LOG_LEVEL: 'silent',
      NODE_ENV: 'production',
    },
  },
  globalSetup: './src/__tests__/e2e/real/setup/global-setup.ts',
  globalTeardown: './src/__tests__/e2e/real/setup/global-teardown.ts',
});
```

## The `start-server.ts` wrapper

```ts
// src/__tests__/e2e/seeded/setup/start-server.ts (summarized)
import { spawn } from 'node:child_process';
import { applyMigrations, bootPostgres } from '@/__tests__/e2e/_shared/postgres-container';
import { startMockGotrue, buildFixedJwt } from './mock-gotrue';
import { writeSeedState } from './seed-state';

async function main() {
  const { connectionString } = await bootPostgres();
  await applyMigrations(connectionString);

  const accessToken = buildFixedJwt({ sub: SEED_USER_ID, email: SEED_EMAIL, /* ... */ });
  const mock = await startMockGotrue({ port: 54321, fixedToken: accessToken, user: { /* ... */ } });
  const supabaseUrl = `http://127.0.0.1:${mock.port}`;

  await writeSeedState({
    userId: SEED_USER_ID,
    email: SEED_EMAIL,
    accessToken,
    refreshToken: 'mock-refresh-token',
    supabaseUrl,
    databaseUrl: connectionString,
  });

  const child = spawn('npx', ['next', 'start'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'e2e-service-key',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'production',
    },
  });
  // ... forward signals, exit cleanly
}
```

## Shared container

`bootPostgres` + `applyMigrations` live in `src/__tests__/e2e/_shared/postgres-container.ts` and are consumed by **two paths**:

1. `vitest.integration.config.ts` → `src/__tests__/integration/setup/global-setup.ts` (integration suite).
2. `playwright.seeded.config.ts` → `src/__tests__/e2e/seeded/setup/start-server.ts` (seeded e2e suite).

Change boot/bootstrap THERE — do not duplicate in this suite.

## Scripts in `package.json`

```json
{
  "scripts": {
    "test:e2e:seeded": "playwright test --config playwright.seeded.config.ts",
    "test:e2e:real": "playwright test --config playwright.real.config.ts"
  }
}
```

## Environment differences

- **Local dev**: `webServer.reuseExistingServer: true` lets you have `next start` in another terminal and reuse it.
- **CI**: forces a fresh build/start on every run; no container reuse; `workers: 2` is safe with TRUNCATE between tests.
- **PR preview**: optionally run a smoke subset pointing `baseURL` to the Vercel preview URL + a `globalSetup` that does not even start a container (tests do not need their own DB).

## `.gitignore`

```
src/__tests__/e2e/seeded/setup/.auth/
playwright-report*/
test-results*/
playwright/.cache/
```

Auth storage contains seed-user tokens — do not commit.
