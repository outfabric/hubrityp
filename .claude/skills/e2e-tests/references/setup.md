# Setup do Playwright + Testcontainers

## Instalação

```bash
npm i -D @playwright/test @testcontainers/postgresql testcontainers \
        drizzle-orm pg
npx playwright install --with-deps chromium
```

`--with-deps` instala bibliotecas do sistema necessárias no Linux/CI. Em dev local pode ser só `npx playwright install chromium`.

## `playwright.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE = resolve(__dirname, 'playwright/.auth/user.json');
const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  outputDir: 'playwright/results',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright/report', open: 'never' }],
    process.env.CI ? ['github'] : ['null'],
  ],
  globalSetup: require.resolve('./e2e/global-setup.ts'),
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npm run build && npm run start -- -p 3100',
    url: `http://localhost:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? '',
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      NODE_ENV: 'test',
    },
  },
});
```

Pontos chave:

- **`globalSetup`** sobe o container Postgres antes do `webServer` e exporta `E2E_DATABASE_URL`.
- **`webServer`** roda o Next.js de produção (`build` + `start`) na porta 3100. Não use `next dev` em E2E — comportamento difere de produção.
- **`projects`**: `setup` autentica e salva `storageState`; `chromium` carrega esse estado em todo teste. Adicione `firefox`/`webkit` apenas para fluxos onde divergência cross-browser importa.
- **`fullyParallel: true`** com `workers: 2` no CI; ajuste se a suite começar a brigar pelo DB.
- **`retries: 2` no CI**: reduz flakiness de rede/timing. Se um teste passa só com retry, **investigue** — ele provavelmente está mal escrito.

## `global-setup.ts`

```ts
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
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: './drizzle' });
  await client.end();

  return async () => {
    if (process.env.CI) await container?.stop();
  };
}
```

`globalSetup` retorna função de teardown. Em CI para o container; em dev local usa `.withReuse()` para boot quase instantâneo.

## Como o `webServer` enxerga o DB

`globalSetup` roda **antes** do `webServer`. A config injeta `DATABASE_URL: process.env.E2E_DATABASE_URL` no env do Next, então o cliente Drizzle do app aponta para o container. Para que isso funcione, o módulo de env validado por Zod do app deve aceitar a URL gerada (sem prefixo de validação restritivo em modo `test`).

## Scripts no `package.json`

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "PWDEBUG=1 playwright test",
    "test:e2e:report": "playwright show-report playwright/report"
  }
}
```

## Diferenças de ambiente

- **Dev local**: `webServer.reuseExistingServer: true` permite `npm run start -- -p 3100` em outro terminal e reaproveitar.
- **CI**: força build/start fresco a cada run; sem reuse de container; `workers: 2` é seguro com TRUNCATE entre testes.
- **PR preview**: opcionalmente rodar smoke subset apontando `baseURL` para a URL do preview da Vercel + `globalSetup` que nem sobe container (testes não precisam de DB próprio).

## `.gitignore`

```
playwright/.auth/
playwright/report/
playwright/results/
test-results/
```

Storage de auth contém tokens de seed users — não comitar.
