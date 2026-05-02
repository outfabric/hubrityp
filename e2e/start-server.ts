// E2E web server bootstrap.
//
// This file is the `webServer.command` referenced by `playwright.config.ts`.
// Why a wrapper instead of `npm run start` directly:
//
//   Playwright starts the `webServer` plugin BEFORE running `globalSetup`
//   (see `node_modules/playwright/lib/runner/tasks.js::createGlobalSetupTasks`).
//   That means values produced by `globalSetup` — the dynamic Testcontainers
//   Postgres URL, the ephemeral mock GoTrue port — cannot reach the spawned
//   Next.js server through `webServer.env`. Both `lib/env.ts` (Zod-validated)
//   and `lib/db` would crash on missing `DATABASE_URL` / `NEXT_PUBLIC_*`.
//
// Solution: do the dynamic boot here, set the env explicitly, then exec the
// production Next.js server. The downstream `globalSetup` only needs to
// READ the resulting `seed-state.json` to seed the database and run the
// auth setup.
//
// The mock GoTrue is started in this same process and stays attached for
// the server's lifetime; when Playwright kills this process at end-of-run,
// the mock is GC'd along with everything else.
import { spawn } from 'node:child_process';

import { applyMigrations, bootPostgres } from '../__tests__/integration/setup/postgres-container';

import { buildFixedJwt, startMockGotrue } from './mock-gotrue';
import { writeSeedState } from './seed-state';

// Stable seed identity. Picking a fixed UUID (rather than `randomUUID()`)
// keeps assertions in `auth.spec.ts` deterministic and lets reused
// Testcontainers (`.withReuse()`) skip re-inserting the row across runs.
const SEED_USER_ID = '00000000-0000-4000-8000-000000000001';
const SEED_EMAIL = 'seed@example.com';

// Mock GoTrue must bind to a STABLE port. Next.js inlines `NEXT_PUBLIC_*`
// into the edge bundle at build time, so the middleware (edge runtime) is
// hardcoded to whatever URL the build saw. We use Supabase's standard
// local port `54321` because that is also the value `lib/env/client.ts`
// validates for, and the e2e CI build step provides as a placeholder.
const MOCK_GOTRUE_PORT = 54321;

async function main(): Promise<void> {
  // Boot Postgres and apply Drizzle migrations. With `.withReuse()` this
  // is essentially a no-op on subsequent local runs.
  const { connectionString } = await bootPostgres();
  await applyMigrations(connectionString);

  // Build a syntactically-valid JWT whose payload matches the seeded user.
  // The mock does not verify the signature; any non-empty third segment is
  // enough for `decodeJWT()` consumers in supabase-js. `exp` is set far in
  // the future so `setSession` does not detour through `_callRefreshToken`.
  const nowSec = Math.floor(Date.now() / 1000);
  const accessToken = buildFixedJwt({
    sub: SEED_USER_ID,
    email: SEED_EMAIL,
    aud: 'authenticated',
    role: 'authenticated',
    exp: nowSec + 60 * 60 * 24 * 30,
    iat: nowSec,
  });
  const refreshToken = 'mock-refresh-token';

  const nowIso = new Date().toISOString();
  const mock = await startMockGotrue({
    fixedToken: accessToken,
    port: MOCK_GOTRUE_PORT,
    user: {
      id: SEED_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: SEED_EMAIL,
      email_confirmed_at: nowIso,
      phone: '',
      confirmed_at: nowIso,
      last_sign_in_at: nowIso,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: nowIso,
      updated_at: nowIso,
    },
  });

  // Persist seed metadata so `globalSetup` (which seeds rows) and
  // `auth.setup.ts` (which writes the storageState) can pick it up
  // without coordinating through environment variables.
  await writeSeedState({
    userId: SEED_USER_ID,
    email: SEED_EMAIL,
    accessToken,
    refreshToken,
    supabaseUrl: mock.url,
    databaseUrl: connectionString,
  });

  // Hand off to `next start` with the resolved env. We use `inherit` for
  // stdio so Next's logs surface in Playwright's webServer panel; we do
  // NOT detach, so Playwright's normal SIGTERM cycle reaps the child.
  const child = spawn('npx', ['next', 'start'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      NEXT_PUBLIC_SUPABASE_URL: mock.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'e2e-service-key',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'production',
    },
  });

  // Forward termination signals so Playwright's gracefulShutdown reaches
  // Next via the same path it would with `next start` directly.
  const forward = (signal: NodeJS.Signals) => () => {
    if (!child.killed) child.kill(signal);
  };
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));

  child.on('exit', (code) => {
    // Best-effort: stop the mock cleanly so the port is released.
    void mock.close().finally(() => process.exit(code ?? 0));
  });
}

main().catch((err: unknown) => {
  console.error('[e2e/start-server] fatal:', err);
  process.exit(1);
});
