# ci-pipeline

## Resumo

Define como o pipeline GitHub Actions do HubrityP gateia todo PR com quatro jobs (`quality` → `integration` + `e2e` → `e2e-real`), cacheia browsers Playwright entre runs e faz upload de artifacts diagnósticos em falha. Após o refactor estrutural, todos os paths de teste apontam para `src/__tests__/`, o script e2e seeded é `npm run test:e2e:seeded`, e o artifact da suite real foi renomeado para `playwright-report-real`.

## Onde mora o código

- `.github/workflows/ci.yml` — workflow único do projeto. Quatro jobs:
  - `quality` — lint + typecheck + format:check + test:unit.
  - `integration` (depende de `quality`) — Testcontainers Postgres + `npm run test:integration`.
  - `e2e` (depende de `quality`) — build + `npm run test:e2e:seeded` (Playwright seeded suite).
  - `e2e-real` (depende de `e2e`) — `supabase start` + `npm run test:e2e:real` (Playwright real suite).

## Superfície pública

- **Trigger**: `pull_request` em qualquer branch + `push` em `main`.
- **Concurrency**: `ci-${{ github.ref }}` com `cancel-in-progress: true` — force-push não dobra runner pool.
- **Permissions**: `contents: read` (mínimo necessário).
- **Node**: `setup-node@v4` com `node-version-file: .nvmrc` (Node 22 LTS); `cache: npm`.
- **Branch protection** (configurada no GitHub, fora deste repo): jobs `quality`, `integration`, `e2e`, `e2e-real` são required checks para merge em `main`.

## Comportamento e invariantes

- **Gate `quality` é obrigatório**: integration e e2e têm `needs: quality`. Falha de unit, lint ou typecheck bloqueia o downstream.
- **`integration` precisa de Docker**: o job roda `docker info` antes de `npm run test:integration` para falhar cedo se o runner não tem Docker (default em `ubuntu-latest`, mas explicit é melhor que implicit).
- **`e2e` cacheia browsers Playwright**: `actions/cache@v4` em `~/.cache/ms-playwright`, key `${{ runner.os }}-playwright-${{ hashFiles('package-lock.json') }}`. Lockfile como key garante invalidação quando a versão Playwright muda.
- **`e2e` build precisa de env vars at parse time**: `src/shared/env/index.ts` valida no import. CI provê placeholders válidos no step `Build the app`:
  - `DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/postgres`
  - `NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY: ci-build-anon-key`
  - `SUPABASE_SERVICE_ROLE_KEY: ci-build-service-key`
  - `LOG_LEVEL: silent`
    Os valores reais vêm em runtime do globalSetup do Playwright (Postgres) e do mock GoTrue.
- **`e2e-real` precisa de `supabase start`**: o stack inteiro (GoTrue + Postgres + Storage + ...) é spawned pelo CLI Supabase (`supabase/setup-cli@v1`). `--no-backup` no `supabase stop` pula o dump local.
- **`NEXT_PUBLIC_SUPABASE_URL` no build é load-bearing**: é inlinado no edge bundle. Build-time URL DEVE casar com o que `supabase start` exporá em runtime (default `http://127.0.0.1:54321`). CI fixa essa URL nos dois build steps (e2e e e2e-real) para garantir.
- **`e2e-real` tem `needs: e2e`**: as duas suites disputam port 54321. Sequencing em CI evita corrida; localmente, dev DEVE parar uma antes da outra. `timeout-minutes: 25` no e2e-real é o hard cap (suite real é mais lenta).
- **Artifact upload em falha**:
  - `e2e` falha → upload `playwright-report/` como `playwright-report` (retention 14 dias).
  - `e2e-real` falha → upload `playwright-report-real/` como `playwright-report-real` (retention 14 dias). Renomeado nesta refactor (era `playwright-report-auth-real`).
- **`if: always()` no `Stop Supabase`** garante cleanup mesmo em falha do test step. Sem isso, retries vazam containers.
- **Sem cache de `node_modules`** — `setup-node@v4` com `cache: npm` cacheia o tarball no `~/.npm`, mas `npm ci` reinstala always (idempotente, garante hidratação consistente).

## Testes

Não há "testes do CI" no sentido convencional. Validação:

- **Próprios jobs**: `quality`, `integration`, `e2e`, `e2e-real`. Se passam, o pipeline funciona.
- **Manual smoke** (em mudança no workflow):
  - Abrir PR com a mudança e observar runs.
  - `act -j <job-name>` localmente para iteração mais rápida (limitado, mas útil para syntax errors).
- **Branch protection** valida que merges não acontecem com check vermelho.

## Histórico de changes

- 2026-05-03 reorganize-folder-structure — workflow atualizado para os novos paths e nomes:
  - `npm run test:e2e` substituído por `npm run test:e2e:seeded` no job `e2e`.
  - Job `integration` exercita suite em `src/__tests__/integration/`.
  - Job `e2e` exercita suite em `src/__tests__/e2e/seeded/` via `playwright.seeded.config.ts`.
  - Job `e2e-real` exercita suite em `src/__tests__/e2e/real/` via `playwright.real.config.ts`.
  - Artifact da suite real renomeado de `playwright-report-auth-real` para `playwright-report-real`.
  - Estrutura de 4 jobs (`quality` → `integration` + `e2e` → `e2e-real`) preservada.
    Veja [`../openspec/changes/archive/2026-05-03-reorganize-folder-structure/`](../openspec/changes/archive/2026-05-03-reorganize-folder-structure/).
- 2026-05-02 smoke-health-feature — adicionado job `e2e-real` com `needs: e2e`, instala Supabase CLI, sequencia start/stop, upload de report dedicado.
- 2026-05-02 bootstrap-data-and-tests — capability criada: workflow `ci.yml` com jobs `quality` → `integration` + `e2e`, cache Playwright, Docker para Testcontainers.
