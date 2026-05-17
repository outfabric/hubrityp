# Data isolation between tests

A shared container needs a strategy to avoid contamination between tests. Three options, in order of preference:

## 1. TRUNCATE in `beforeEach` (default)

```ts
// src/__tests__/integration/setup/rls.ts
import { sql } from 'drizzle-orm';
import type { db as Db } from './db';

const TABELAS = [
  'agendamentos',
  'pacientes',
  'psicologos',
  'auth.users',
] as const;

export async function truncateAll(db: typeof Db) {
  await db.execute(
    sql.raw(`TRUNCATE ${TABELAS.join(', ')} RESTART IDENTITY CASCADE;`)
  );
}
```

**When to use:** default. Simple, predictable, easy to debug.

**Trade-offs:** ~5–20ms per test; requires maintaining the table list.

**Tip:** generate the list dynamically from `information_schema` if the schema grows a lot:

```ts
const { rows } = await db.execute(sql`
  SELECT table_schema || '.' || table_name AS qname
  FROM information_schema.tables
  WHERE table_schema IN ('public', 'auth')
    AND table_type = 'BASE TABLE'
    AND table_name <> 'schema_migrations'
`);
```

## 2. Transaction with rollback

```ts
beforeEach(async (ctx) => {
  ctx.tx = await db.transaction(async (tx) => tx, { isolationLevel: 'serializable' });
});
afterEach(async (ctx) => {
  await ctx.tx.rollback();
});
```

**When to use:** very large suites where each `TRUNCATE` has become a bottleneck.

**Trade-offs:**
- The code under test **must** receive the injected tx — cannot open a new connection.
- Does not work if the function under test uses internal `BEGIN/COMMIT` (e.g., nested `db.transaction()` becomes a savepoint, OK; but `pg` on a separate pool, NO).
- Unworkable if the assertion needs to read on **another** connection.

## 3. Schema/database per test file

```ts
// global-setup creates; each file gets a unique name
const schemaName = `test_${randomUUID().replace(/-/g, '')}`;
await db.execute(sql.raw(`CREATE SCHEMA ${schemaName};`));
// configure search_path for this schema
```

**When to use:** aggressive parallelism (`maxForks: 8+`) + long tests.

**Trade-offs:** high complexity, more painful debugging, schema creation cost.

## Sequences and reference data

Use `RESTART IDENTITY` in TRUNCATE to reset `serial`/`bigserial`. For seed tables (e.g., `tipos_consulta`), `INSERT` in `beforeEach` or exclude from TRUNCATE with `EXCEPT`.

## Time-travel

Use `vi.useFakeTimers({ now: ... })` or inject a `clock` provider. Do not depend on Postgres `now()` in assertions — set it explicitly:

```ts
await db.insert(agendamentos).values({
  /* ... */ criadoEm: new Date('2026-05-01T10:00:00-03:00'),
});
```

## Parallelism

With `pool: 'forks'` each file runs in an isolated process, but all hit the **same container**. If the test creates/reads in distinct tables, parallelism is safe. If it shares a table and uses TRUNCATE, **one test can truncate the state of another**. Solutions:

1. Limit `maxForks: 1` for the suite (slower, always safe). It's the default in HubrityP's `vitest.integration.config.ts` via `fileParallelism: false`.
2. Use schema-per-file (option 3 above).
3. Mark suites that share a table with `describe.sequential` (Vitest >= 1.4) — does not resolve across files, only within.

**Practical recommendation:** start with `fileParallelism: false` + TRUNCATE. Move up only if the suite gets slow enough to justify the complexity.

## File / Storage cleanup

If the feature uses Supabase Storage, mock the Storage client at the boundary level (do not boot MinIO in the container). Storage is integration-of-integration — out of scope for unit tests and most integration tests.
