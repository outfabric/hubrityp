# e2e-test-stack

## Resumo

Define como o HubrityP roda testes end-to-end de browser contra a aplicação built, provisiona Postgres + seed via Testcontainers em `globalSetup`, reusa `storageState` autenticado, e registra namespaces de tag para filtro. Também expõe um helper reutilizável de mock GoTrue para suítes que exercitam superfícies autenticadas sem subir Supabase real. Após o refactor estrutural, toda a suite seeded mora em `src/__tests__/e2e/seeded/`, o config Playwright se chama `playwright.seeded.config.ts`, e o módulo de Postgres container é compartilhado com integration via `src/__tests__/e2e/_shared/postgres-container.ts`.

## Onde mora o código

- `playwright.seeded.config.ts` — configuração default (mock GoTrue, Postgres via Testcontainers). `testDir: './src/__tests__/e2e/seeded'`.
- `playwright.real.config.ts` — configuração paralela que aponta para `supabase start` real (suite `@auth-real`, ver capability `e2e-auth-real-suite`).
- `src/__tests__/e2e/seeded/setup/start-server.ts` — wrapper do `webServer.command` que faz boot dinâmico (Postgres + mock GoTrue) e só então `exec`a `next start`. Workaround canônico para o webServer-antes-do-globalSetup do Playwright.
- `src/__tests__/e2e/seeded/setup/global-setup.ts`, `src/__tests__/e2e/seeded/setup/global-teardown.ts` — leem `seed-state.json` escrito pelo wrapper, fazem o seed do banco e disparam o teardown do container.
- `src/__tests__/e2e/seeded/setup/auth.setup.ts` — escreve `storageState` simulado consumido pelos testes `@auth`.
- `src/__tests__/e2e/seeded/setup/seed-state.ts` — protocolo de hand-off entre o wrapper e `globalSetup`.
- `src/__tests__/e2e/seeded/tags.json` — registry de tags (`@health`, `@auth`, cross-ref `@auth-real`).
- `src/__tests__/e2e/seeded/*.spec.ts` — os testes propriamente ditos (`auth.spec.ts`, `smoke.spec.ts`).
- `src/__tests__/e2e/seeded/setup/mock-gotrue.ts` — mock GoTrue in-process reutilizável (relocado de `lib/test-utils/mock-gotrue.ts`).
- `src/__tests__/unit/e2e/seeded/setup/mock-gotrue.test.ts` — testes unitários do contrato do helper.
- `src/__tests__/e2e/_shared/postgres-container.ts` — boot do Postgres Testcontainers, reutilizado por integration e seeded e2e (relocado de `__tests__/integration/setup/postgres-container.ts`).

## Superfície pública

- **Scripts npm**:
  - `npm run test:e2e:seeded` — roda Playwright com `playwright.seeded.config.ts`. Requer `next build` prévio.
  - `npm run test:e2e:real` — roda Playwright com `playwright.real.config.ts` (precisa de `supabase start` rodando, ver capability `e2e-auth-real-suite`).
  - `npx playwright test --config playwright.seeded.config.ts --grep @<tag>` — filtro por tag.
- **Helper** `startMockGotrue(options?: MockGoTrueOptions): Promise<MockGoTrueHandle>` em `src/__tests__/e2e/seeded/setup/mock-gotrue.ts`:
  - Retorno: `{ port: number; stop: () => Promise<void>; jwt: string; url: string }`.
  - Defaults: `port = 54321`, seeded user `00000000-0000-4000-8000-000000000001`, JWT mintado in-process via `buildFixedJwt`.
  - Overrides aceitos: `port`, `fixedToken`, `user`.
  - Helpers exports: `buildFixedJwt(payload)`, `base64UrlEncode(value)` para callers que precisam mintar tokens custom.
- **Tag registry**: `src/__tests__/e2e/seeded/tags.json` com `@health` (ativo), `@auth` (suite default mockado), `@auth-real` (cross-ref para a suite real-Supabase em `src/__tests__/e2e/real/`).

## Comportamento e invariantes

- **Default port `54321` é load-bearing**: `NEXT_PUBLIC_SUPABASE_URL` é inlinado no edge runtime no `next build`. O middleware sempre bate na porta que o build viu, então o mock precisa ouvir em `127.0.0.1:54321` (mesma porta que `supabase start` expõe), permitindo que um único build artefato sirva tanto a suite mock-GoTrue quanto `@auth-real`.
- **Consequência prática**: as duas suítes não rodam concorrentemente — disputam a mesma porta. CI sequencia via `needs: e2e` no job `e2e-real`.
- **Playwright sobe `webServer` ANTES de `globalSetup`** (verificável em `node_modules/playwright/lib/runner/tasks.js::createGlobalSetupTasks`). Por isso valores dinâmicos (URL Testcontainers, porta de mock) são resolvidos em `src/__tests__/e2e/seeded/setup/start-server.ts`, não em `globalSetup`.
- **`playwright.real.config.ts` faz `execSync('npx supabase status -o json')` no top-level** — mesmo problema que (b) em outra fantasia. Não tente "consertar" movendo para `globalSetup`: o Next spawnado não enxerga as vars setadas lá.
- **`supabase status -o json` usa `SCREAMING_SNAKE_CASE`** (`API_URL`, `DB_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`), não camelCase como outros outputs do CLI.
- **Mock GoTrue não verifica assinatura JWT** — qualquer terceiro segmento não-vazio é sintaticamente aceito por `decodeJWT()` do supabase-js. O `buildFixedJwt` retorna um token cuja assinatura é literal `mock-signature`.
- **Surface mínima do mock**: `GET /auth/v1/user` (bearer match → user JSON; else 401), `POST /auth/v1/logout` (sempre 204), `GET /auth/v1/settings` (200 com payload benigno). Qualquer outra rota → 404 explícito (falhas devem ser ruidosas).
- **`stop()` é assíncrono** e libera o socket; após resolver, a porta é re-bindable sem `EADDRINUSE`.
- **Container Postgres compartilhado com integration**: ambos os globalSetups (`src/__tests__/integration/setup/global-setup.ts` e `src/__tests__/e2e/seeded/setup/global-setup.ts` via `start-server.ts`) importam `bootPostgres` e `applyMigrations` do MESMO módulo. Mudanças no setup beneficiam ambas as suites e evitam drift.
- **LGPD/segurança**: nada de dados reais — mock só conhece o seed user determinístico. Helper agora vive em `src/__tests__/e2e/seeded/setup/`, intencionalmente fora do path de runtime (e protegido pelo `outputFileTracingExcludes` em `next.config.ts`).

## Testes

- **Unit**: `src/__tests__/unit/e2e/seeded/setup/mock-gotrue.test.ts` — 3 cases (handle shape, JWT structure + payload, port rebindable após `stop()`).
- **E2E**: `src/__tests__/e2e/seeded/auth.spec.ts` (`@auth`) — exercita o caminho real do helper via `src/__tests__/e2e/seeded/setup/start-server.ts` (override branch de `fixedToken` + `user`).
- **E2E (smoke)**: `src/__tests__/e2e/seeded/smoke.spec.ts` (`@health`) — bate em `/api/health` e em `/`, valida bootstrap completo (Testcontainers → migrations → mock GoTrue → next build → next start → browser navigate).
- **E2E (real Supabase)**: `src/__tests__/e2e/real/auth.spec.ts` (`@auth-real`) — não usa o mock; valida o flow real contra `supabase start` (ver capability `e2e-auth-real-suite`).

## Histórico de changes

- 2026-05-03 reorganize-folder-structure — suite relocada de `e2e/` para `src/__tests__/e2e/seeded/`; config renomeada de `playwright.config.ts` para `playwright.seeded.config.ts` (`testDir`, `globalSetup`, `globalTeardown`, `webServer.command` atualizados). Mock GoTrue helper relocado de `lib/test-utils/mock-gotrue.ts` para `src/__tests__/e2e/seeded/setup/mock-gotrue.ts`; teste unit do mock para `src/__tests__/unit/e2e/seeded/setup/mock-gotrue.test.ts`. Postgres container extraído para `src/__tests__/e2e/_shared/postgres-container.ts` (compartilhado com integration). Script npm renomeado de `test:e2e` para `test:e2e:seeded` (simetria com `test:e2e:real`). Veja [`../openspec/changes/archive/2026-05-03-reorganize-folder-structure/`](../openspec/changes/archive/2026-05-03-reorganize-folder-structure/).
- 2026-05-02 dev-cycle-followups-001 — lift de `e2e/mock-gotrue.ts` para `lib/test-utils/mock-gotrue.ts` com handle reshapeado para `{ port, stop, jwt }`. Adiciona unit tests de contrato e migra `e2e/start-server.ts`. Veja `../openspec/changes/archive/2026-05-02-dev-cycle-followups-001/`.
- 2026-05-02 smoke-health-feature — introduz a suite `@auth-real` em paralelo com a suite default mockado, documenta a setup do `storageState` simulado, registra tag `@auth-real`. Veja `../openspec/changes/archive/2026-05-02-smoke-health-feature/`.
- 2026-05-02 bootstrap-data-and-tests — capability criada: Playwright runner, Testcontainers Postgres em `globalSetup`, `storageState` reusable, tag registry, smoke `@health` passando. Veja `../openspec/changes/archive/2026-05-02-bootstrap-data-and-tests/`.
