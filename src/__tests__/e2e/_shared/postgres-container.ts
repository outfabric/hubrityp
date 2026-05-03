// Shared Postgres container used by both the integration runner
// (`vitest.integration.config.ts` globalSetup) and the seeded Playwright
// e2e suite (`src/__tests__/e2e/seeded/setup/global-setup.ts`).
//
// We use the standard `postgres:16-alpine` image (small, fast, reliable)
// rather than `supabase/postgres` (~2GB, finicky entrypoint that requires
// JWT_SECRET et al.). The minimal `auth.uid()` / role surface RLS policies
// depend on is installed programmatically by `bootstrapAuthSchema` below —
// this is the same surface a real Supabase project provides, scoped to
// what our tests actually exercise.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export const POSTGRES_IMAGE = 'postgres:16-alpine';

export interface BootedPostgres {
  container: StartedPostgreSqlContainer;
  connectionString: string;
}

export async function bootPostgres(): Promise<BootedPostgres> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withUsername('postgres')
    .withPassword('postgres')
    .withDatabase('postgres')
    .withStartupTimeout(60_000)
    .withReuse()
    .start();

  const connectionString = container.getConnectionUri();
  await bootstrapAuthSchema(connectionString);
  return { container, connectionString };
}

// Install the minimum Supabase Auth surface that owner-scoped RLS policies
// rely on:
//   - `authenticated` and `anon` roles (named in the policy `TO ...` clause)
//   - `auth.uid()` function returning the JWT subject claim
//   - `auth.users` table referenced by `owner_id` columns
async function bootstrapAuthSchema(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role NOLOGIN BYPASSRLS;
        END IF;
      END$$;

      CREATE SCHEMA IF NOT EXISTS auth;

      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        instance_id uuid,
        aud text,
        role text,
        email text
      );

      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
        LANGUAGE sql STABLE
      AS $func$
        SELECT
          NULLIF(
            current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
            ''
          )::uuid
      $func$;

      GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
    `);
  } finally {
    await sql.end();
  }
}

export async function applyMigrations(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: './src/shared/db/migrations' });

    // Drizzle's migration table is created by the postgres superuser, but the
    // table-level GRANTs the policies depend on aren't issued by `migrate`.
    // Grant the `authenticated` role basic CRUD on every table created by the
    // migrations so RLS — not table privileges — is the only barrier.
    await sql.unsafe(`
      DO $$
      DECLARE
        r record;
      BEGIN
        FOR r IN
          SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        LOOP
          EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, anon, service_role',
            r.tablename
          );
        END LOOP;
      END$$;
    `);
  } finally {
    await sql.end();
  }
}
