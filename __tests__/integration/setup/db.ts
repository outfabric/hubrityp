// Shared connection helpers used by both runAs* helpers. Each helper opens
// its own short-lived `postgres` connection so concurrent tests don't share
// session state (PostgreSQL `SET LOCAL` only persists inside a transaction).
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/db/schema';

export type Db = PostgresJsDatabase<typeof schema>;

export function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The integration globalSetup must run before tests import this module.',
    );
  }
  return url;
}

export function openClient() {
  const sql = postgres(getConnectionString(), { max: 1 });
  const db = drizzle(sql, { schema });
  return { sql, db };
}
