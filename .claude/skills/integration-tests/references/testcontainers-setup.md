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

Use `supabase/postgres` para fidelidade com produção (extensões `pgcrypto`, `uuid-ossp`, `pgjwt`, `pg_graphql`, `supabase_vault` já presentes):

```ts
new PostgreSqlContainer('supabase/postgres:15.6.1.146')
  .withDatabase('hubrityp_test')
  .withUsername('postgres')
  .withPassword('postgres')
  .withReuse() // habilita TESTCONTAINERS_REUSE_ENABLE=true entre runs
```

Postgres "vanilla" (`postgres:16-alpine`) é mais leve mas exige `CREATE EXTENSION` manual e não tem helpers do Supabase (`auth.uid()`, schema `auth`). Não use vanilla se a feature depende de RLS — use `supabase/postgres`.

## `globalSetup` — sobe container uma vez por run

```ts
// __tests__/integration/setup/global-setup.ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

let container: StartedPostgreSqlContainer;

export async function setup({ provide }: { provide: (k: string, v: string) => void }) {
  container = await new PostgreSqlContainer('supabase/postgres:15.6.1.146')
    .withDatabase('hubrityp_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .withReuse()
    .start();

  const url = container.getConnectionUri();

  // Aplica schema do Supabase (auth.users, etc.) — necessário antes das migrations do app
  await applySupabaseBootstrap(url);

  // Aplica migrations Drizzle
  const client = new Client({ connectionString: url });
  await client.connect();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: './drizzle' });
  await client.end();

  provide('DATABASE_URL', url);
}

export async function teardown() {
  // Com .withReuse(), o container persiste entre runs; pare apenas em CI.
  if (process.env.CI) await container?.stop();
}

async function applySupabaseBootstrap(url: string) {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(`CREATE SCHEMA IF NOT EXISTS auth;`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE,
      created_at timestamptz DEFAULT now()
    );
  `);
  await client.query(`CREATE ROLE authenticated NOLOGIN;`).catch(() => {});
  await client.query(`CREATE ROLE anon NOLOGIN;`).catch(() => {});
  await client.query(`GRANT USAGE ON SCHEMA public TO authenticated, anon;`);
  await client.end();
}
```

Se a imagem `supabase/postgres` já cria roles `authenticated`/`anon` e schema `auth`, o `applySupabaseBootstrap` pode ser reduzido a verificações idempotentes.

## Acessando dentro do teste

```ts
// __tests__/integration/setup/db.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { inject } from 'vitest';
import * as schema from '@/lib/db/schema';

const pool = new Pool({ connectionString: inject('DATABASE_URL') });
export const db = drizzle(pool, { schema });
export const rawPool = pool;
```

`inject()` lê o que `globalSetup.provide()` registrou — type-safe via augmentation:

```ts
// vitest-env.d.ts
declare module 'vitest' {
  export interface ProvidedContext {
    DATABASE_URL: string;
  }
}
```

## `vitest.integration.config.ts`

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globalSetup: ['./__tests__/integration/setup/global-setup.ts'],
    setupFiles: ['./__tests__/integration/setup/setup.ts'],
    include: ['**/*.int.{test,spec}.{ts,tsx}'],
    pool: 'forks',                  // isolamento real entre arquivos
    poolOptions: { forks: { singleFork: false, maxForks: 4 } },
    testTimeout: 30_000,            // I/O com Postgres é mais lento
    hookTimeout: 60_000,            // migrations no globalSetup
    clearMocks: true,
    restoreMocks: true,
  },
});
```

Pool `forks` evita compartilhamento de módulos com estado (clientes pg, MSW handlers) entre arquivos. Threads compartilham memória — pode vazar.

## `setup.ts` por arquivo (não global)

```ts
// __tests__/integration/setup/setup.ts
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
    "test:integration": "vitest run -c vitest.integration.config.ts",
    "test:integration:watch": "vitest -c vitest.integration.config.ts",
    "test:all": "npm run test:unit && npm run test:integration"
  }
}
```

## Solução de problemas

- **`Cannot find module 'pg-native'`**: ignore — `pg` tenta carregar otimização nativa, fallback funciona.
- **`Address already in use`**: container anterior não parou; `docker ps` + `docker rm -f`.
- **`role "authenticated" does not exist`**: imagem vanilla — troque para `supabase/postgres` ou crie o role no bootstrap.
- **Lentidão na primeira execução**: pull da imagem. Considere `docker pull supabase/postgres:15.6.1.146` no `postinstall`.
