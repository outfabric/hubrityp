import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { healthPings } from '@/shared/db/schema/health/tables';

import { readSeedState } from './seed-state';

// Playwright runs `globalSetup` AFTER the `webServer` plugin starts (see
// Playwright's `runner/tasks.ts::createGlobalSetupTasks`), so by the time
// we get here the wrapper at `src/__tests__/e2e/seeded/setup/start-server.ts`
// has already:
//
//   • booted the Testcontainers Postgres,
//   • applied Drizzle migrations,
//   • started the mock GoTrue,
//   • written `src/__tests__/e2e/seeded/setup/.auth/seed-state.json`,
//   • spawned `next start` with the resolved env vars.
//
// All this hook does is seed the user + ping rows that the auth and health
// flows rely on. We keep this seeding here (rather than in start-server) so
// failures during seeding surface in Playwright's globalSetup logs and the
// run aborts cleanly instead of leaving the webServer dangling on a
// half-seeded DB.
export default async function globalSetup() {
  const seed = await readSeedState();

  const sql = postgres(seed.databaseUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  try {
    // `auth.users` is bootstrapped by the postgres-container helper — the
    // schema already exists. We seed the deterministic UUID + email the
    // mock GoTrue echoes back from `GET /auth/v1/user`. `ON CONFLICT`
    // keeps the seed idempotent across reused containers.
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email)
      VALUES (
        ${seed.userId},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${seed.email}
      )
      ON CONFLICT (id) DO NOTHING;
    `;

    await db
      .insert(healthPings)
      .values({ ownerId: seed.userId, note: 'e2e-seed ping' })
      .onConflictDoNothing();
  } finally {
    await sql.end();
  }
}
