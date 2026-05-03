# Setup do Playwright + Testcontainers

## Instalação

```bash
npm i -D @playwright/test @testcontainers/postgresql testcontainers \
        drizzle-orm postgres
npx playwright install --with-deps chromium
```

`--with-deps` instala bibliotecas do sistema necessárias no Linux/CI. Em dev local pode ser só `npx playwright install chromium`.

## Os dois Playwright configs

O HubrityP separa as duas suítes em **dois configs na raiz do repo**, cada um com seu `testDir`:

| Config | `testDir` | Suíte | webServer |
|---|---|---|---|
| `playwright.seeded.config.ts` | `./src/__tests__/e2e/seeded` | Mock GoTrue + storageState | Wrapper `start-server.ts` que boota Postgres + mock GoTrue + spawn `next start` |
| `playwright.real.config.ts` | `./src/__tests__/e2e/real` | Real Supabase (`supabase start`) | `npm run start` direto, com env injetado a partir de `npx supabase status -o json` lido em config-load |

Comandos:

```bash
npm run test:e2e:seeded
npm run test:e2e:real     # exige `npx supabase start` rodando
```

> **Conflito de porta**: as duas suítes não rodam concorrentemente — ambas usam `127.0.0.1:54321`. Pare uma antes da outra.

## `playwright.seeded.config.ts` (suíte default)

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/__tests__/e2e/seeded',
  testMatch: ['**/*.spec.ts', '**/*.setup.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // The wrapper boots Testcontainers Postgres + mock GoTrue and only then
    // spawns `next start`. Doing the boot inside `globalSetup` would not
    // work — Playwright starts `webServer` before `globalSetup`.
    command: 'npx tsx src/__tests__/e2e/seeded/setup/start-server.ts',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  globalSetup: './src/__tests__/e2e/seeded/setup/global-setup.ts',
  globalTeardown: './src/__tests__/e2e/seeded/setup/global-teardown.ts',
});
```

Pontos chave:

- **`webServer.command`** aponta para o wrapper `start-server.ts` (não `npm run start` direto). O wrapper boota o container Postgres compartilhado + mock GoTrue antes de spawn `next start`, garantindo que o env do Next tenha `DATABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` resolvidos.
- **`globalSetup`** roda **depois** do `webServer`. Use só para seed de dados (após o container já existir).
- **`projects`**: `setup` autentica e salva `storageState` em `src/__tests__/e2e/seeded/setup/.auth/state.json`; o `chromium` não declara `storageState` no nível do projeto — testes opt-in via `test.use({ storageState: STORAGE_STATE_PATH })` (importado de `./setup/seed-state.ts`). Padrão por opt-in evita falhas em testes anônimos (ex.: redirect para `/login`).
- **`fullyParallel: true`** com `workers: 2` no CI; ajuste se a suite começar a brigar pelo DB.
- **`retries: 2` no CI**: reduz flakiness de rede/timing. Se um teste passa só com retry, **investigue** — ele provavelmente está mal escrito.

## `playwright.real.config.ts` (suíte `@auth-real`)

A suíte real é deliberadamente standalone — NÃO espalha o seeded config. Ela:

- Lê `npx supabase status -o json` no top-level (em config-load) para descobrir `API_URL`, `DB_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`.
- Rejeita iniciar se `supabase start` não estiver rodando, com mensagem acionável.
- Usa `webServer.command: 'npm run start'` direto (sem wrapper) — o env vem inteiro do supabase status.
- `outputDir: 'test-results-real'` e `playwright-report-real` para não colidir com a suíte seeded.

```ts
// playwright.real.config.ts (resumido — ver o config real para o execSync de supabase status)
export default defineConfig({
  testDir: './src/__tests__/e2e/real',
  testMatch: ['**/*.spec.ts'],
  workers: 1,
  outputDir: 'test-results-real',
  // ...
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    env: {
      DATABASE_URL: status.DB_URL,
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      LOG_LEVEL: 'silent',
      NODE_ENV: 'production',
    },
  },
  globalSetup: './src/__tests__/e2e/real/setup/global-setup.ts',
  globalTeardown: './src/__tests__/e2e/real/setup/global-teardown.ts',
});
```

## O wrapper `start-server.ts`

```ts
// src/__tests__/e2e/seeded/setup/start-server.ts (resumido)
import { spawn } from 'node:child_process';
import { applyMigrations, bootPostgres } from '@/__tests__/e2e/_shared/postgres-container';
import { startMockGotrue, buildFixedJwt } from './mock-gotrue';
import { writeSeedState } from './seed-state';

async function main() {
  const { connectionString } = await bootPostgres();
  await applyMigrations(connectionString);

  const accessToken = buildFixedJwt({ sub: SEED_USER_ID, email: SEED_EMAIL, /* ... */ });
  const mock = await startMockGotrue({ port: 54321, fixedToken: accessToken, user: { /* ... */ } });
  const supabaseUrl = `http://127.0.0.1:${mock.port}`;

  await writeSeedState({
    userId: SEED_USER_ID,
    email: SEED_EMAIL,
    accessToken,
    refreshToken: 'mock-refresh-token',
    supabaseUrl,
    databaseUrl: connectionString,
  });

  const child = spawn('npx', ['next', 'start'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'e2e-service-key',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'production',
    },
  });
  // ... forward signals, exit cleanly
}
```

## Container compartilhado

`bootPostgres` + `applyMigrations` vivem em `src/__tests__/e2e/_shared/postgres-container.ts` e são consumidos por **dois caminhos**:

1. `vitest.integration.config.ts` → `src/__tests__/integration/setup/global-setup.ts` (suíte de integração).
2. `playwright.seeded.config.ts` → `src/__tests__/e2e/seeded/setup/start-server.ts` (suíte e2e seeded).

Mude o boot/bootstrap LÁ — não duplique nesta suíte.

## Scripts no `package.json`

```json
{
  "scripts": {
    "test:e2e:seeded": "playwright test --config playwright.seeded.config.ts",
    "test:e2e:real": "playwright test --config playwright.real.config.ts"
  }
}
```

## Diferenças de ambiente

- **Dev local**: `webServer.reuseExistingServer: true` permite ter `next start` em outro terminal e reaproveitar.
- **CI**: força build/start fresco a cada run; sem reuse de container; `workers: 2` é seguro com TRUNCATE entre testes.
- **PR preview**: opcionalmente rodar smoke subset apontando `baseURL` para a URL do preview da Vercel + `globalSetup` que nem sobe container (testes não precisam de DB próprio).

## `.gitignore`

```
src/__tests__/e2e/seeded/setup/.auth/
playwright-report*/
test-results*/
playwright/.cache/
```

Storage de auth contém tokens de seed users — não comitar.
