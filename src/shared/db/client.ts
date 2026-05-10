import 'server-only';

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/shared/db/schema';
import { serverEnv } from '@/shared/env';

// App-level Drizzle client. A single `postgres` pool (max 1 connection per
// invocation) is held at module scope so each Route Handler / Server Action
// shares one connection within a Node process. Vercel Functions are
// single-tenant per invocation, so a small pool keeps cold-start churn low
// without exhausting Supabase's connection limit.
//
// Tests inject DATABASE_URL via the integration globalSetup before importing
// this module; production reads the validated `serverEnv.DATABASE_URL`.
const sql = postgres(serverEnv.DATABASE_URL, { max: 1, prepare: false });

export type AppDb = PostgresJsDatabase<typeof schema>;

export const db: AppDb = drizzle(sql, { schema });
