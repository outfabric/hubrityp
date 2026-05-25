import { execSync } from 'node:child_process';

import { defineConfig, devices } from '@playwright/test';

// Dedicated Playwright config for the `@auth-real` suite.
//
// This config is INTENTIONALLY standalone — it does NOT spread the seeded
// `playwright.seeded.config.ts`. The seeded config wires:
//   • a `setup` project that depends on the mock-GoTrue webServer wrapper,
//   • a custom `command: npx tsx src/__tests__/e2e/seeded/setup/start-server.ts`
//     that boots Testcontainers Postgres + the in-process mock GoTrue.
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
// As a consequence, `npm run test:e2e:seeded` (mock-GoTrue suite) and
// `npm run test:e2e:real` cannot run concurrently — they both bind a server
// to port 54321. Running them sequentially in CI is fine; locally, stop one
// before the other.

type SupabaseStatus = {
  API_URL: string;
  DB_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
};

type StatusResult =
  | { ok: true; status: SupabaseStatus }
  | { ok: false; stderr: string; message: string };

function tryReadSupabaseStatus(): StatusResult {
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
    // error. Surface it so callers can decide whether to retry (e.g. by
    // booting the stack on-demand) or fail with a useful diagnostic.
    const stderr = (err as { stderr?: Buffer | string }).stderr;
    const stderrText = stderr ? String(stderr).trim() : '';
    return { ok: false, stderr: stderrText, message: (err as Error).message };
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
    ok: true,
    status: {
      API_URL: apiUrl,
      DB_URL: dbUrl,
      ANON_KEY: anonKey,
      SERVICE_ROLE_KEY: serviceRoleKey,
    },
  };
}

function bootSupabase(): void {
  // First boot pulls Docker images and can take 60–90s; warm boots are
  // ~10–20s. We inherit stdio so the developer can see CLI progress instead
  // of staring at a silent terminal — a long unexplained pause here was a
  // common source of "is it stuck?" confusion before this hook existed.
  //
  // Routes through `npm run supabase:start` so the `-x` exclusion list
  // (realtime/studio/postgres-meta/edge-runtime/logflare/vector) stays the
  // single source of truth in package.json — the app does not use any of
  // those services, and skipping them saves ~700MB–1GB of RAM per boot.
  console.log('[auth-real] Supabase stack not running — booting via `npm run supabase:start`...');
  execSync('npm run supabase:start', { stdio: 'inherit' });
}

function readSupabaseStatus(): SupabaseStatus {
  const first = tryReadSupabaseStatus();
  if (first.ok) {
    return first.status;
  }

  // The CLI failed. Boot the stack on-demand and retry once. We mark the
  // boot with `AUTH_REAL_STARTED_BY_TEST=1` so `globalTeardown` knows it is
  // safe to shut the stack back down — without the flag, we would tear down
  // a stack the developer started manually for unrelated dev work.
  try {
    bootSupabase();
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr;
    const stderrText = stderr ? String(stderr).trim() : '';
    throw new Error(
      '`npx supabase start` failed. Is Docker running?\n' +
        (stderrText ? `Underlying stderr:\n${stderrText}\n` : '') +
        `(Original error: ${(err as Error).message})`,
    );
  }
  process.env.AUTH_REAL_STARTED_BY_TEST = '1';

  const second = tryReadSupabaseStatus();
  if (second.ok) {
    return second.status;
  }
  throw new Error(
    'Supabase status still unavailable after `npx supabase start` succeeded.\n' +
      (second.stderr ? `Underlying stderr:\n${second.stderr}\n` : '') +
      `(Original error: ${second.message})`,
  );
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
  testDir: './src/__tests__/e2e/real',
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
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-real' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-real' }]],
  outputDir: 'test-results-real',
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
      // Stream SDK — dummy values so the Zod env validation in
      // `src/shared/env/` passes at module-evaluation time.
      NEXT_PUBLIC_STREAM_API_KEY: 'e2e-real-stream-public-key',
      STREAM_API_KEY: 'e2e-real-stream-api-key',
      STREAM_API_SECRET: 'e2e-real-stream-api-secret',
      STREAM_WEBHOOK_SECRET: 'e2e-real-stream-webhook-secret',
      // Gemini AI transcription — dummy key so env validation passes.
      GEMINI_API_KEY: 'e2e-real-gemini-api-key',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'production',
    },
  },
  globalSetup: './src/__tests__/e2e/real/setup/global-setup.ts',
  globalTeardown: './src/__tests__/e2e/real/setup/global-teardown.ts',
});
