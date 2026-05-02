// drizzle.config.ts is a CLI-only file consumed by `drizzle-kit` outside the
// Next.js bundle. It must not import `server-only` (which always throws in a
// raw Node context). The ESLint exemption for this file in
// `eslint.config.mjs` permits the direct `process.env.DATABASE_URL` read.
import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Run `supabase start` and copy the DB URL into .env.local.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/**/tables.ts',
  out: './db/migrations',
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
