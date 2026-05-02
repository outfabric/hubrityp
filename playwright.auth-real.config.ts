import { execSync } from 'node:child_process';

import { defineConfig, devices } from '@playwright/test';

// Dedicated Playwright config for the `@auth-real` suite.
//
// This config is INTENTIONALLY standalone — it does NOT spread the default
// `playwright.config.ts`. The default config wires:
//   • a `setup` project that depends on the mock-GoTrue webServer wrapper,
//   • a custom `command: npx tsx e2e/start-server.ts` that boots
//     Testcontainers Postgres + the in-process mock GoTrue.
//
// Both are explicitly the wrong target for the auth-real suite, which
// exercises the real Supabase stack started via `supabase start`. We
// therefore re-declare the small set of options that are still relevant
// (baseURL, retries, the chromium project) and define our own webServer +
// global hooks.
//
// Why supabase status is read at CONFIG-LOAD time (not in `globalSetup`):
// Playwright launches the `webServer` plugin BEFORE running `globalSetup`
// (see `node_modules/playwright/lib/runner/tasks.js::createGlobalSetupTasks`).
// The values passed to `webServer.env` are captured at config-load time —
// nothing `globalSetup` writes to `process.env` can reach the spawned Next
// server. We therefore discover the API URL, anon/service-role keys, and DB
// URL HERE, by shelling out to `npx supabase status -o json`. If supabase
// is not running, the JSON parse fails and we surface a clear error before
// Playwright even starts.
//
// Crucial port note: `NEXT_PUBLIC_SUPABASE_URL` is inlined into the edge
// bundle at BUILD time. The wave-3 build pins it to `http://127.0.0.1:54321`,
// which is also the default address `supabase start` exposes. This is the
// one shared invariant between the two e2e suites — the runtime env handed
// to `next start` below MUST match the build-time URL on port 54321 or the
// edge middleware will hit the wrong host.
//
// As a consequence, `npm run test:e2e` (mock-GoTrue suite) and
// `npm run test:e2e:real` cannot run concurrently — they both bind a server
// to port 54321. Running them sequentially in CI is fine; locally, stop one
// before the other.

type SupabaseStatus = {
  API_URL: string;
  DB_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
};

function readSupabaseStatus(): SupabaseStatus {
  // The Supabase CLI prints diagnostic warnings ("Stopped services: ...") on
  // stderr and the structured payload on stdout. We capture stdout only.
  let raw: string;
  try {
    raw = execSync('npx supabase status -o json', {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err) {
    // `execSync` attaches the child process's stderr (Buffer) on the thrown
    // error. Surface it explicitly — without this, `(err as Error).message`
    // collapses to "Command failed: ..." and the actual diagnostic from the
    // Supabase CLI is silently dropped, defeating debuggability.
    const stderr = (err as { stderr?: Buffer | string }).stderr;
    const stderrText = stderr ? String(stderr).trim() : '';
    throw new Error(
      'Supabase stack is not running. Run `npx supabase start` before `npm run test:e2e:real`.\n' +
        (stderrText ? `Underlying stderr:\n${stderrText}\n` : '') +
        `(Original error: ${(err as Error).message})`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Unable to parse \`supabase status -o json\` output. Got: ${raw.slice(0, 200)} ` +
        `(Original error: ${(err as Error).message})`,
    );
  }

  const apiUrl = parsed.API_URL;
  const dbUrl = parsed.DB_URL;
  const anonKey = parsed.ANON_KEY;
  const serviceRoleKey = parsed.SERVICE_ROLE_KEY;

  if (
    typeof apiUrl !== 'string' ||
    typeof dbUrl !== 'string' ||
    typeof anonKey !== 'string' ||
    typeof serviceRoleKey !== 'string' ||
    !apiUrl ||
    !dbUrl ||
    !anonKey ||
    !serviceRoleKey
  ) {
    throw new Error(
      `Supabase status JSON is missing required keys (API_URL, DB_URL, ANON_KEY, SERVICE_ROLE_KEY). Got: ${JSON.stringify(parsed)}`,
    );
  }

  return {
    API_URL: apiUrl,
    DB_URL: dbUrl,
    ANON_KEY: anonKey,
    SERVICE_ROLE_KEY: serviceRoleKey,
  };
}

const status = readSupabaseStatus();

// Stash on `process.env` so `globalSetup` can read the same values without
// shelling out a second time. These names are deliberately prefixed
// `AUTH_REAL_*` to make their scope obvious in logs.
process.env.AUTH_REAL_SUPABASE_URL = status.API_URL;
process.env.AUTH_REAL_SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.AUTH_REAL_SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
process.env.AUTH_REAL_DATABASE_URL = status.DB_URL;

export default defineConfig({
  testDir: './e2e-auth-real',
  testMatch: ['**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // The auth-real suite has a single test today and the seeded user is a
  // shared resource (one row in `auth.users`). Forcing a single worker keeps
  // the test deterministic if more cases are added later that mutate the
  // same user — until then the cap is a no-op.
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-auth-real' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-auth-real' }]],
  outputDir: 'test-results-auth-real',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: status.DB_URL,
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      LOG_LEVEL: 'silent',
      NODE_ENV: 'production',
    },
  },
  globalSetup: './e2e-auth-real/global-setup.ts',
  globalTeardown: './e2e-auth-real/global-teardown.ts',
});
