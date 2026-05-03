// Playwright globalSetup for the seeded e2e suite.
//
// IMPORTANT: Playwright runs `globalSetup` AFTER it boots `webServer`. By the
// time we get here, `start-server.ts` has already booted the Testcontainers
// Postgres, applied migrations, started the mock GoTrue, and spawned
// `next start` with the resolved env. All this hook does is seed the rows
// the suite depends on (auth users, base data) so the assertions in
// `*.spec.ts` have something to query.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { healthPings } from '@/shared/db/schema/health/tables';
import { readSeedState } from './seed-state';

export default async function globalSetup() {
  const seed = await readSeedState();

  const sql = postgres(seed.databaseUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  try {
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
