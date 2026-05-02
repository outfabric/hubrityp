// db/migrate.ts is a CLI script consumed by `npm run db:migrate` outside the
// Next.js bundle. It must not import `server-only` modules (which throw in a
// raw Node context). The ESLint exemption for this file in
// `eslint.config.mjs` permits the direct `process.env.DATABASE_URL` read.
import 'dotenv/config';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Run `supabase start` and copy the DB URL into .env.local.',
  );
}

async function main() {
  const sql = postgres(databaseUrl!, { max: 1 });
  const db = drizzle(sql);

  await migrate(db, { migrationsFolder: './db/migrations' });

  await sql.end();
  console.log('migrations applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
