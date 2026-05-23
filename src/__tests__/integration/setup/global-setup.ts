import { applyMigrations, bootPostgres } from '@/__tests__/e2e/_shared/postgres-container';

// Vitest global setup: boots a single Postgres container for the entire test
// process, applies Drizzle migrations, and exposes the connection string via
// `process.env.DATABASE_URL` so individual tests can build their own clients
// without re-discovering the host/port.
export default async function globalSetup() {
  const { connectionString } = await bootPostgres();
  await applyMigrations(connectionString);
  process.env.DATABASE_URL = connectionString;
  process.env.LOG_LEVEL = 'silent';
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'integration-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'integration-service-key';
  // Stream SDK — dummy values for integration tests that import serverEnv
  // transitively. The real Stream client is mocked in tests that need it.
  process.env.NEXT_PUBLIC_STREAM_API_KEY ??= 'integration-stream-public-key';
  process.env.STREAM_API_KEY ??= 'integration-stream-api-key';
  process.env.STREAM_API_SECRET ??= 'integration-stream-api-secret';
  process.env.STREAM_WEBHOOK_SECRET ??= 'integration-stream-webhook-secret';

  return async () => {
    // No teardown — `.withReuse()` keeps the container alive between runs.
    // Use `docker rm -f` manually if you need a clean slate.
  };
}
