# integration-test-stack

## Resumo

Define como o HubrityP roda testes de integração contra Postgres real (via Testcontainers), exercita Row Level Security a partir do processo de teste, e provê factories tipadas onde mudanças de schema viram erros de tipo. Após o refactor, toda a suite de integração mora em `src/__tests__/integration/`, e o módulo de boot do Postgres é compartilhado com a suite e2e seeded em `src/__tests__/e2e/_shared/postgres-container.ts`.

## Onde mora o código

- **Suite**:
  - `src/__tests__/integration/*.int.test.ts` — todos os testes de integração. Sufixo `.int.test.ts` é load-bearing: o runner unit explicitamente exclui esse padrão.
  - Arquivos atuais: `api-health.int.test.ts`, `api-me.int.test.ts`, `auth-signin.int.test.ts`, `auth-signout.int.test.ts`, `env-coverage.int.test.ts`, `health-pings.int.test.ts`, `middleware.int.test.ts`, `policy-coverage.int.test.ts`.
- **Setup** (`src/__tests__/integration/setup/`):
  - `global-setup.ts` — boota Postgres via `bootPostgres()` do módulo compartilhado, aplica migrations, exporta `DATABASE_URL` para `process.env`, define defaults de `NEXT_PUBLIC_*` e `SUPABASE_SERVICE_ROLE_KEY`.
  - `db.ts` — `openClient()` retorna `{ sql, db }` (Drizzle sobre `postgres-js`) e `getConnectionString()` lê `DATABASE_URL`.
  - `run-as-user.ts` — `runAsUser(jwtSub, fn)` abre transação, faz `SET LOCAL role = 'authenticated'` + `SET LOCAL request.jwt.claims = '{"sub":...,"role":"authenticated"}'`, executa `fn(tx)` sob RLS.
  - `run-as-service.ts` — `runAsService(fn)` abre conexão como superuser (RLS bypassada por padrão no postgres-js do container).
- **Factories** (`src/__tests__/integration/factories/`):
  - `health-pings.ts` — `healthPingFactory.build(overrides?)` retorna `NewHealthPing` válido. Tipo derivado direto do schema Drizzle (mudança de coluna → erro de tipo no factory).
- **Container compartilhado**:
  - `src/__tests__/e2e/_shared/postgres-container.ts` — `bootPostgres()` (boot + bootstrap auth schema), `applyMigrations()`. Compartilhado com a suite seeded e2e.
- **Stubs**:
  - `src/__tests__/stubs/server-only.ts` — alias Vitest no-op para `import 'server-only'`.
- **Config**:
  - `vitest.integration.config.ts` — `include: ['src/__tests__/integration/**/*.int.test.ts']`, `globalSetup: ['./src/__tests__/integration/setup/global-setup.ts']`, `testTimeout: 30_000`, `hookTimeout: 60_000`, `fileParallelism: false`.

## Superfície pública

- **Script npm**: `npm run test:integration` → `vitest run --config vitest.integration.config.ts`.
- **Imports usados em testes**:
  - `import { runAsUser } from './setup/run-as-user'` ou via path absoluto `@/__tests__/integration/setup/run-as-user`.
  - `import { runAsService } from './setup/run-as-service'`.
  - `import { healthPingFactory } from './factories/health-pings'`.
  - `import { healthPings, type NewHealthPing } from '@/shared/db/schema/health/tables'`.
- **Convention de nomenclatura**: `<feature>.int.test.ts`. O sufixo é o discriminador entre runners — não usar `.test.ts` para integração nem `.int.test.ts` para unit.
- **Reuse de container** (`.withReuse()` no `bootPostgres`): primeira run baixa imagem (`postgres:16-alpine`) e aplica migrations; runs subsequentes na mesma máquina reusam o container com warm cache (~10s boot).

## Comportamento e invariantes

- **Postgres é compartilhado entre testes**: um único container por processo Vitest. Cada teste roda em sua própria conexão (`openClient()` em cada `runAsUser`/`runAsService`), e as `runAs*` envolvem o trabalho em transação com `SET LOCAL` para evitar cross-talk.
- **`fileParallelism: false`**: testes rodam serialmente porque compartilham o pool de conexões. RLS isola via JWT claims dentro de transação, mas paralelismo de arquivos pode causar disputas no pool.
- **Container compartilhado com seeded e2e**: ambos os globalSetups importam `bootPostgres` e `applyMigrations` do MESMO módulo (`@/__tests__/e2e/_shared/postgres-container`). Mudanças no setup de Postgres beneficiam ambas as suites e evitam drift.
- **Bootstrap de Supabase Auth surface**: `bootstrapAuthSchema` (dentro de `bootPostgres`) cria roles `authenticated`/`anon`/`service_role`, schema `auth`, função `auth.uid()` (lê `request.jwt.claims->>'sub'`), tabela `auth.users` mínima. Sem isso, RLS policies não compilam.
- **`migrate` não emite GRANTs**: depois de aplicar migrations, o helper roda um `DO $$ ... LOOP` que `GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated, anon, service_role`. Sem isso, RLS bloqueia tudo (no privilege at table level, RLS doesn't matter).
- **`DATABASE_URL` injetado pelo globalSetup** sobrescreve qualquer valor de `.env.local` durante os testes — garante que rotas de aplicação que importam `serverEnv.DATABASE_URL` falem para o container, não para o DB de dev.
- **Logger silenciado**: `process.env.LOG_LEVEL = 'silent'` no globalSetup. Mantém stdout dos testes limpo.
- **Defaults de `NEXT_PUBLIC_*` e `SUPABASE_SERVICE_ROLE_KEY`** com `??=` evita boot do `serverEnv` falhar caso o dev rode sem `.env.local`.
- **`server-only` neutralizado por alias** (em `vitest.integration.config.ts`): `'server-only': path.resolve(rootDir, 'src/__tests__/stubs/server-only.ts')`. Sem isso, todo módulo guardado por `import 'server-only'` (logger, env server, db client) explode em runtime de teste.

## Testes

- **A própria suite** (`src/__tests__/integration/`) cobre integração de várias capabilities — ver listagem em "Onde mora o código".
- **Lint tests dentro da suite** que validam o estado da árvore:
  - `policy-coverage.int.test.ts` — toda tabela em schema tem RLS em migration.
  - `env-coverage.int.test.ts` — `.env.example` cobre todas as keys de `clientEnvSchema` + `serverEnvSchema`.
- **CI** (`.github/workflows/ci.yml` job `integration`): roda `docker info` (Testcontainers prereq), depois `npm run test:integration`.

## Histórico de changes

- 2026-05-03 reorganize-folder-structure — suite relocada de `__tests__/integration/` para `src/__tests__/integration/`. Módulo de Postgres container extraído do setup de integração para `src/__tests__/e2e/_shared/postgres-container.ts` (compartilhado com seeded e2e). `vitest.integration.config.ts` atualizado: `include`, `globalSetup`, alias `@` → `./src` e `server-only` → `src/__tests__/stubs/`. Imports ajustados para `@/__tests__/...` e `@/shared/db/...`. Veja [`../openspec/changes/archive/2026-05-03-reorganize-folder-structure/`](../openspec/changes/archive/2026-05-03-reorganize-folder-structure/).
- 2026-05-02 bootstrap-data-and-tests — capability criada: Vitest integration runner, Postgres via Testcontainers, helpers `runAsUser`/`runAsService`, factory tipada `healthPingFactory`, lint test de policy coverage.
