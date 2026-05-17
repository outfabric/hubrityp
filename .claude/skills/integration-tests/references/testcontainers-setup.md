# Setup with Testcontainers (Postgres + Drizzle)

## Installation

```bash
npm i -D vitest @testcontainers/postgresql testcontainers \
        drizzle-orm drizzle-kit pg \
        msw @mswjs/data
```

- `@testcontainers/postgresql` — Postgres-specific wrapper (waits for ready healthcheck).
- `testcontainers` — required as peer of the subpackage above.
- `pg` — TCP driver used by Drizzle in the test runner (Node).
- `msw` — HTTP interception in tests that touch UI/external integrations.

## Container image

Two equally valid choices:

- **`supabase/postgres:15.6.1.146`** — maximum fidelity (`pgcrypto`, `uuid-ossp`, `pgjwt`, `pg_graphql`, `supabase_vault` extensions pre-installed; `auth` schema partially populated by the entrypoint). Large image (~2GB) and the entrypoint is painful in CI without `JWT_SECRET`.
- **`postgres:16-alpine`** + manual bootstrap — light (~80MB), fast boot. The minimal pieces of `auth` (roles `authenticated`/`anon`/`service_role`, `auth` schema, `auth.uid()` function) are installed programmatically. **This is what HubrityP uses today** in `src/__tests__/e2e/_shared/postgres-container.ts`.

The choice lives in ONE place only: `src/__tests__/e2e/_shared/postgres-container.ts`. Both the integration `globalSetup` and the seeded e2e import from there — do not duplicate.

## Shared container module

```ts
// src/__tests__/e2e/_shared/postgres-container.ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export const POSTGRES_IMAGE = 'postgres:16-alpine';

export async function bootPostgres() {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withUsername('postgres')
    .withPassword('postgres')
    .withDatabase('postgres')
    .withStartupTimeout(60_000)
    .withReuse()
    .start();

  const connectionString = container.getConnectionUri();
  await bootstrapAuthSchema(connectionString); // roles + auth schema + auth.uid()
  return { container, connectionString };
}

export async function applyMigrations(connectionString: string) {
  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: './src/shared/db/migrations' });
    // Grant authenticated/anon/service_role basic CRUD on every public table
    // so RLS is the only barrier (not table privileges).
  } finally {
    await sql.end();
  }
}
```

> **Where it lives**: `src/__tests__/e2e/_shared/postgres-container.ts`. The `e2e/_shared` name is historical — the module serves **integration + e2e**, but lives under `e2e/` because it was extracted from the e2e layer and kept there so the seeded e2e can import without crossing the `integration/` boundary. If the set of consumers ever grows beyond integration + seeded e2e, it's worth promoting to `src/__tests__/_shared/`.

## Integration `globalSetup`

```ts
// src/__tests__/integration/setup/global-setup.ts
import { applyMigrations, bootPostgres } from '@/__tests__/e2e/_shared/postgres-container';

export default async function globalSetup() {
  const { connectionString } = await bootPostgres();
  await applyMigrations(connectionString);
  process.env.DATABASE_URL = connectionString;
  process.env.LOG_LEVEL = 'silent';

  return async () => {
    // No teardown — `.withReuse()` keeps the container alive between runs.
  };
}
```

The function does NOT need to return the URL via `provide()` if the tests read directly from `process.env.DATABASE_URL`. But if you want type-safety via `inject('DATABASE_URL')`, declare:

```ts
// vitest-env.d.ts
declare module 'vitest' {
  export interface ProvidedContext {
    DATABASE_URL: string;
  }
}
```

And in globalSetup: `provide('DATABASE_URL', connectionString)`.

## Accessing inside the test

```ts
// src/__tests__/integration/setup/db.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@/shared/db/schema';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL not set — globalSetup must run before tests import this module.');
}

const pool = new Pool({ connectionString: url, max: 5 });
export const db = drizzle(pool, { schema });
export const rawPool = pool;
```

## `vitest.integration.config.ts`

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./src/__tests__/integration/setup/global-setup.ts'],
    setupFiles: ['./src/__tests__/integration/setup/setup.ts'],
    include: ['src/__tests__/integration/**/*.int.test.ts'],
    exclude: [
      'node_modules',
      '.next',
      'src/__tests__/e2e',
      'coverage',
    ],
    pool: 'forks',
    poolOptions: { forks: { singleFork: false, maxForks: 4 } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false, // serial across files to avoid cross-talk in the pool
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      'server-only': path.resolve(rootDir, 'src/__tests__/stubs/server-only.ts'),
    },
  },
});
```

The `forks` pool avoids sharing stateful modules (pg clients, MSW handlers) across files. Threads share memory — can leak.

> **`server-only` stub**: the `server-only` package throws on any require outside Next's bundler. The alias above points to `src/__tests__/stubs/server-only.ts` (no-op) so server modules (that import `server-only`) are testable outside Next.

## `setup.ts` per file (not global)

```ts
// src/__tests__/integration/setup/setup.ts
import { afterAll, beforeAll } from 'vitest';
import { server } from './msw-server';
import { rawPool } from './db';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(async () => {
  server.close();
  await rawPool.end();
});
```

`onUnhandledRequest: 'error'` forces any HTTP call outside MSW handlers to fail the test — protects against leaked network.

## Reuse in local dev

`.withReuse()` keeps the container between runs with a hash based on the configuration. To ensure caching:

```bash
# ~/.testcontainers.properties (or via env)
testcontainers.reuse.enable=true
```

In CI, force `process.env.CI === 'true'` to disable reuse and stop the container on teardown — ephemeral runners.

## Scripts in `package.json`

```json
{
  "scripts": {
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:integration:watch": "vitest --config vitest.integration.config.ts",
    "test:all": "npm run test:unit && npm run test:integration"
  }
}
```

## Troubleshooting

- **`Cannot find module 'pg-native'`**: ignore — `pg` tries to load native optimization, fallback works.
- **`Address already in use`**: previous container did not stop; `docker ps` + `docker rm -f`.
- **`role "authenticated" does not exist`**: the `_shared/postgres-container.ts` bootstrap did not run — confirm that `bootPostgres()` was called before `applyMigrations()`.
- **Slow first run**: pulling the image. Consider `docker pull postgres:16-alpine` on `postinstall`.
