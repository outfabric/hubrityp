// scripts/db-migrate.ts is a CLI script consumed by `npm run db:migrate`
// outside the Next.js bundle. It must not import `server-only` modules (which
// throw in a raw Node context). The ESLint exemption for this file in
// `eslint.config.mjs` permits the direct `process.env.DATABASE_URL` read.
import 'dotenv/config';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Run `supabase start` and copy the DB URL into .env.local.',
  );
}

const MIGRATIONS_FOLDER = './src/shared/db/migrations';

interface AppliedMigrationRow {
  hash: string;
  created_at: string | number;
}

async function main() {
  // Disable prepared statements so migrations work through Supavisor
  // (Supabase's connection pooler) in transaction mode. Supavisor routes
  // consecutive queries to different PostgreSQL backends, which breaks
  // prepared statements created on one backend and referenced on another.
  const sql = postgres(databaseUrl!, { max: 1, prepare: false });
  const db = drizzle(sql);

  // Guard: detect the silent-skip pattern before delegating to migrate().
  // Drizzle's pg-core dialect filters journal entries with
  //   Number(lastDbMigration.created_at) < migration.folderMillis
  // so any pending migration whose `when` in _journal.json is <=
  // MAX(__drizzle_migrations.created_at) is dropped without error.
  // We replicate that comparison here and abort loudly instead of letting
  // `migrations applied.` print misleadingly.
  const files = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  const applied = await sql<AppliedMigrationRow[]>`
    SELECT hash, created_at
    FROM drizzle.__drizzle_migrations
  `.catch(() => [] as AppliedMigrationRow[]);

  const appliedHashes = new Set(applied.map((r) => r.hash));
  const maxApplied = applied.reduce(
    (acc, r) => (Number(r.created_at) > acc ? Number(r.created_at) : acc),
    0,
  );

  const silentlySkipped = files.filter(
    (m) => !appliedHashes.has(m.hash) && m.folderMillis <= maxApplied,
  );

  if (silentlySkipped.length > 0) {
    const lines = silentlySkipped.map(
      (m) =>
        `  - folderMillis=${m.folderMillis} (${new Date(m.folderMillis).toISOString()}) hash=${m.hash.slice(0, 12)}…`,
    );
    console.error(
      `✖ Aborting: ${silentlySkipped.length} pending migration(s) would be ` +
        `silently skipped by Drizzle (their \`when\` in _journal.json is <= ` +
        `MAX(__drizzle_migrations.created_at) = ${maxApplied}):\n` +
        lines.join('\n') +
        `\n\nFix _journal.json so newer entries have a strictly greater ` +
        `\`when\`, then UPDATE drizzle.__drizzle_migrations to reflect the ` +
        `corrected timestamp on the latest applied row. See ` +
        `scripts/check-migrations.ts for the offline counterpart.`,
    );
    await sql.end();
    process.exit(1);
  }

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  await sql.end();
  console.log('migrations applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
