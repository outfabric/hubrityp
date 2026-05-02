import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { healthPings } from '@/db/schema/health/tables';

import { applyMigrations, bootPostgres } from '../__tests__/integration/setup/postgres-container';

// Boots Testcontainers Postgres (same image + `.withReuse()` as integration),
// applies migrations, seeds one auth.users row + one health_ping row, and
// exposes the connection string to the spawned `webServer` via
// `process.env.E2E_DATABASE_URL` (read back by playwright.config.ts).
export default async function globalSetup() {
  const { connectionString } = await bootPostgres();
  await applyMigrations(connectionString);

  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  try {
    const userId = randomUUID();
    // The supabase/postgres image ships an `auth.users` table; insert a
    // minimal row so any FK or RLS rule that references it has a live anchor.
    await sql`
      INSERT INTO auth.users (id, instance_id, aud, role, email)
      VALUES (${userId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seed@example.com')
      ON CONFLICT (id) DO NOTHING;
    `;

    await db
      .insert(healthPings)
      .values({ ownerId: userId, note: 'e2e-seed ping' })
      .onConflictDoNothing();
  } finally {
    await sql.end();
  }

  process.env.E2E_DATABASE_URL = connectionString;
  process.env.DATABASE_URL = connectionString;
  process.env.LOG_LEVEL = 'silent';
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'e2e-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'e2e-service-key';
}
