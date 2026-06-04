// E2E web server bootstrap.
//
// This file is the `webServer.command` referenced by `playwright.seeded.config.ts`.
// Why a wrapper instead of `npm run start` directly:
//
//   Playwright starts the `webServer` plugin BEFORE running `globalSetup`
//   (see `node_modules/playwright/lib/runner/tasks.js::createGlobalSetupTasks`).
//   That means values produced by `globalSetup` — the dynamic Testcontainers
//   Postgres URL, the ephemeral mock GoTrue port — cannot reach the spawned
//   Next.js server through `webServer.env`. Both `src/shared/env/index.ts`
//   (Zod-validated) and `src/shared/db/client.ts` would crash on missing
//   `DATABASE_URL` / `NEXT_PUBLIC_*`.
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

import { applyMigrations, bootPostgres } from '@/__tests__/e2e/_shared/postgres-container';

import { buildFixedJwt, startMockGotrue } from './mock-gotrue';
import { writeSeedState } from './seed-state';

// Stable seed identity. Picking a fixed UUID (rather than `randomUUID()`)
// keeps assertions in `auth.spec.ts` deterministic and lets reused
// Testcontainers (`.withReuse()`) skip re-inserting the row across runs.
const SEED_USER_ID = '00000000-0000-4000-8000-000000000001';
const SEED_EMAIL = 'seed@example.com';
const SEED_PASSWORD = 'Correct-Horse-Battery!';

// Mock GoTrue must bind to a STABLE port. Next.js inlines `NEXT_PUBLIC_*`
// into the edge bundle at build time, so the middleware (edge runtime) is
// hardcoded to whatever URL the build saw. We use Supabase's standard
// local port `54321` because that is also the value `src/shared/env/client.ts`
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
    fixedPassword: SEED_PASSWORD,
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

  // Compose the mock URL from the `port` exposed by the relocated helper's
  // public contract. The handle also exposes a convenience `url`, but we
  // build it ourselves here so this call site stays aligned with the
  // `{ port, stop, jwt }` shape the spec promises.
  const supabaseUrl = `http://127.0.0.1:${mock.port}`;

  // Persist seed metadata so `globalSetup` (which seeds rows) and
  // `auth.setup.ts` (which writes the storageState) can pick it up
  // without coordinating through environment variables.
  await writeSeedState({
    userId: SEED_USER_ID,
    email: SEED_EMAIL,
    accessToken,
    refreshToken,
    supabaseUrl,
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
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'e2e-service-key',
      // Stream SDK — dummy values so the Zod env validation in
      // `src/shared/env/` passes at module-evaluation time.
      NEXT_PUBLIC_STREAM_API_KEY: 'e2e-stream-public-key',
      STREAM_API_KEY: 'e2e-stream-api-key',
      STREAM_API_SECRET: 'e2e-stream-api-secret',
      STREAM_WEBHOOK_SECRET: 'e2e-stream-webhook-secret',
      // Return an in-memory no-op Stream client server-side so the seeded
      // suite never makes real outbound Stream API calls (there is no network
      // path to Stream here). Without this, the patient-join route's defensive
      // `upsertUsers` throws and the route returns 500. See getStreamClient().
      E2E_STREAM_STUB: 'true',
      // Gemini AI transcription — dummy key so env validation passes.
      GEMINI_API_KEY: 'e2e-gemini-api-key',
      // Inngest encryption — dummy key (min 32 chars) so env validation passes.
      INNGEST_ENCRYPTION_KEY: 'e2e-inngest-encryption-key-min-32-chars',
      // Inngest signing — dummy key so the production guard in env/index.ts passes.
      INNGEST_SIGNING_KEY: 'e2e-inngest-signing-key',
      // Inngest — point the event API to a non-routable address so event
      // sends fail fast instead of retrying against the production API for
      // 30+ seconds. This is only needed for Server Actions that
      // fire-and-forget Inngest events (e.g., confirmAudioUpload).
      INNGEST_EVENT_API_BASE_URL: 'http://127.0.0.1:1',
      // Signature hash salt — used for hashing IP/user-agent in consent signing.
      SIGNATURE_HASH_SALT: 'e2e-test-signature-hash-salt-minimum-32-chars',
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
    void mock.stop().finally(() => process.exit(code ?? 0));
  });
}

main().catch((err: unknown) => {
  console.error('[e2e/start-server] fatal:', err);
  process.exit(1);
});
