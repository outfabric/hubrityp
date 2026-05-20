// Offline validator for src/shared/db/migrations/meta/_journal.json.
//
// Drizzle's migrator (drizzle-orm/pg-core/dialect.js) decides what to apply
// with:
//   if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
// where lastDbMigration.created_at is MAX(__drizzle_migrations.created_at)
// in the database and migration.folderMillis is journalEntry.when. If any
// newer journal entry has `when` <= a previously applied entry, the migrator
// silently drops it — `migrations applied.` prints, but the SQL never runs
// and the table never exists. This script catches that drift offline,
// before it reaches CI/Vercel.
import fs from 'node:fs';
import path from 'node:path';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const journalPath = path.join(process.cwd(), 'src/shared/db/migrations/meta/_journal.json');

if (!fs.existsSync(journalPath)) {
  console.error(`✖ Journal not found at ${journalPath}`);
  process.exit(1);
}

const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as Journal;
const sorted = [...journal.entries].sort((a, b) => a.idx - b.idx);

const violations: string[] = [];
let prev: JournalEntry | undefined;
for (const cur of sorted) {
  if (prev && cur.when <= prev.when) {
    violations.push(
      `idx=${cur.idx} tag=${cur.tag} when=${cur.when} (${new Date(cur.when).toISOString()}) ` +
        `<= idx=${prev.idx} tag=${prev.tag} when=${prev.when} (${new Date(prev.when).toISOString()})`,
    );
  }
  prev = cur;
}

if (violations.length > 0) {
  console.error(
    `✖ _journal.json has ${violations.length} ordering violation(s):\n` +
      violations.map((v) => `  - ${v}`).join('\n') +
      `\n\nDrizzle's migrator silently skips entries whose \`when\` is not ` +
      `strictly greater than the previously applied one. Fix the offending ` +
      `\`when\` values in src/shared/db/migrations/meta/_journal.json ` +
      `(changing \`when\` does NOT invalidate the migration hash — Drizzle ` +
      `hashes the .sql file contents, not the journal).`,
  );
  process.exit(1);
}

console.log(`✓ ${journal.entries.length} migration(s) in journal: ordering OK.`);
