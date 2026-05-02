import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

let container: StartedPostgreSqlContainer | undefined;

export default async function globalSetup() {
  container = await new PostgreSqlContainer('supabase/postgres:15.6.1.146')
    .withDatabase('hubrityp_e2e')
    .withUsername('postgres')
    .withPassword('postgres')
    .withReuse()
    .start();

  const url = container.getConnectionUri();
  process.env.E2E_DATABASE_URL = url;

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(`CREATE ROLE authenticated NOLOGIN;`).catch(() => undefined);
  await client.query(`CREATE ROLE anon NOLOGIN;`).catch(() => undefined);
  await client.query(`GRANT USAGE ON SCHEMA public TO authenticated, anon;`);
  await client.query(`
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON ALL TABLES IN SCHEMA public TO authenticated;
  `);
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: './drizzle' });
  await client.end();

  return async () => {
    if (process.env.CI) await container?.stop();
  };
}
