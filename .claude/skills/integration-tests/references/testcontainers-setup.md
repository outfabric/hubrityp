# Setup com Testcontainers (Postgres + Drizzle)

## Instalação

```bash
npm i -D vitest @testcontainers/postgresql testcontainers \
        drizzle-orm drizzle-kit pg \
        msw @mswjs/data
```

- `@testcontainers/postgresql` — wrapper específico de Postgres (espera healthcheck pronto).
- `testcontainers` — necessário como peer da subpackage acima.
- `pg` — driver TCP usado pelo Drizzle no test runner (Node).
- `msw` — interceptação HTTP nos testes que tocam UI/integrações externas.

## Imagem do container

Duas escolhas igualmente válidas:

- **`supabase/postgres:15.6.1.146`** — fidelidade máxima (extensões `pgcrypto`, `uuid-ossp`, `pgjwt`, `pg_graphql`, `supabase_vault` pré-instaladas; schema `auth` parcialmente populado pelo entrypoint). Imagem grande (~2GB) e entrypoint fica chato em CI sem `JWT_SECRET`.
- **`postgres:16-alpine`** + bootstrap manual — leve (~80MB), boot rápido. As partes mínimas do `auth` (roles `authenticated`/`anon`/`service_role`, schema `auth`, função `auth.uid()`) são instaladas programaticamente. **É o que o HubrityP usa hoje** em `src/__tests__/e2e/_shared/postgres-container.ts`.

A escolha vive em UM lugar só: `src/__tests__/e2e/_shared/postgres-container.ts`. Tanto o `globalSetup` da integração quanto o seeded e2e importam dali — não duplique.

## Módulo compartilhado de container

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
  await bootstrapAuthSchema(connectionString); // roles + schema auth + auth.uid()
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

> **Onde mora**: `src/__tests__/e2e/_shared/postgres-container.ts`. O nome `e2e/_shared` é histórico — o módulo serve **integration + e2e**, mas mora sob `e2e/` porque foi extraído da camada e2e e mantido lá para o seeded e2e poder importar sem cruzar a fronteira `integration/`. Se um dia o conjunto de consumidores crescer além de integration + seeded e2e, vale promover para `src/__tests__/_shared/`.

## `globalSetup` da integração

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

A função NÃO precisa retornar URL via `provide()` se os testes leem direto de `process.env.DATABASE_URL`. Mas se quiser type-safety via `inject('DATABASE_URL')`, declare:

```ts
// vitest-env.d.ts
declare module 'vitest' {
  export interface ProvidedContext {
    DATABASE_URL: string;
  }
}
```

E no globalSetup: `provide('DATABASE_URL', connectionString)`.

## Acessando dentro do teste

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
    fileParallelism: false, // serial entre arquivos para evitar cross-talk no pool
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

Pool `forks` evita compartilhamento de módulos com estado (clientes pg, MSW handlers) entre arquivos. Threads compartilham memória — pode vazar.

> **Stub de `server-only`**: o pacote `server-only` lança em qualquer require fora do bundler do Next. O alias acima aponta para `src/__tests__/stubs/server-only.ts` (no-op) para que módulos de servidor (que importam `server-only`) sejam testáveis fora do Next.

## `setup.ts` por arquivo (não global)

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

`onUnhandledRequest: 'error'` força que qualquer chamada HTTP fora dos handlers MSW falhe o teste — protege contra rede vazada.

## Reuse no dev local

`.withReuse()` mantém o container entre runs com hash baseado na configuração. Para garantir o cache:

```bash
# ~/.testcontainers.properties (ou via env)
testcontainers.reuse.enable=true
```

No CI, force `process.env.CI === 'true'` para desabilitar reuse e parar o container no teardown — runners efêmeros.

## Scripts no `package.json`

```json
{
  "scripts": {
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:integration:watch": "vitest --config vitest.integration.config.ts",
    "test:all": "npm run test:unit && npm run test:integration"
  }
}
```

## Solução de problemas

- **`Cannot find module 'pg-native'`**: ignore — `pg` tenta carregar otimização nativa, fallback funciona.
- **`Address already in use`**: container anterior não parou; `docker ps` + `docker rm -f`.
- **`role "authenticated" does not exist`**: o bootstrap do `_shared/postgres-container.ts` não rodou — confirme que `bootPostgres()` foi chamado antes de `applyMigrations()`.
- **Lentidão na primeira execução**: pull da imagem. Considere `docker pull postgres:16-alpine` no `postinstall`.
