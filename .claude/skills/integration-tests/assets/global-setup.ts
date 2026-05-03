// Vitest globalSetup for the integration suite.
//
// Delegates the actual Postgres boot + Drizzle migrations to the SHARED
// container module at `src/__tests__/e2e/_shared/postgres-container.ts`,
// which is also consumed by the seeded e2e suite. Keep them aligned: any
// change to the bootstrap (schema `auth`, roles, GRANTs) belongs there, not
// here.
import { applyMigrations, bootPostgres } from '@/__tests__/e2e/_shared/postgres-container';

export async function setup({
  provide,
}: {
  provide: (key: string, value: string) => void;
}) {
  const { connectionString } = await bootPostgres();
  await applyMigrations(connectionString);

  provide('DATABASE_URL', connectionString);
  process.env.DATABASE_URL = connectionString;
  process.env.LOG_LEVEL = 'silent';
}

export async function teardown() {
  // No teardown — `.withReuse()` keeps the container alive between runs in
  // dev. In CI the container is GC'd with the runner. If you need a clean
  // slate locally, `docker rm -f` the container manually.
}
