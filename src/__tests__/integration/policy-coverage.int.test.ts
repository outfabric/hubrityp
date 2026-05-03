import { readFile } from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

// Lint test: every table declared under src/shared/db/schema/**/tables.ts
// must have at least one matching `CREATE POLICY ... ON <table>` line in
// src/shared/db/migrations/**.sql. Forgetting RLS on a new table is a
// security bug; this test makes the omission a CI failure rather than a
// code-review near-miss.
//
// See src/shared/db/migrations/README.md for the canonical owner-scoped
// policy template.
const ROOT = path.resolve(__dirname, '../../..');

async function findTableNamesInSchema(): Promise<string[]> {
  const files = await fg('src/shared/db/schema/**/tables.ts', { cwd: ROOT, absolute: true });
  const names = new Set<string>();
  // pgTable('<name>', ...) is the Drizzle DSL convention.
  const pattern = /pgTable\(\s*['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`]/g;

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      names.add(match[1]!);
    }
  }
  return Array.from(names).sort();
}

async function findTablesWithPolicies(): Promise<string[]> {
  const files = await fg('src/shared/db/migrations/**/*.sql', { cwd: ROOT, absolute: true });
  const tablesWithPolicies = new Set<string>();
  const pattern = /CREATE\s+POLICY\b[^;]+\bON\s+["`]?([a-zA-Z_][a-zA-Z0-9_]*)["`]?/gi;

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      tablesWithPolicies.add(match[1]!);
    }
  }
  return Array.from(tablesWithPolicies).sort();
}

describe('RLS policy coverage', () => {
  it('every Drizzle table has at least one CREATE POLICY in src/shared/db/migrations', async () => {
    const tables = await findTableNamesInSchema();
    const tablesWithPolicies = await findTablesWithPolicies();

    expect(tables.length, 'schema must declare at least one table').toBeGreaterThan(0);

    const missing = tables.filter((t) => !tablesWithPolicies.includes(t));
    expect(missing, `tables missing RLS policies: ${missing.join(', ')}`).toEqual([]);
  });
});
