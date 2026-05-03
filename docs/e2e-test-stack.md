# e2e-test-stack

## Resumo

Define como a HubrityP roda testes end-to-end de browser contra a aplicação built, provisiona Postgres + seed via Testcontainers em `globalSetup`, reusa `storageState` autenticado, e registra namespaces de tag para filtro. Também expõe um helper reutilizável de mock GoTrue para suítes que exercitam superfícies autenticadas sem subir Supabase real.

## Onde mora o código

- `playwright.config.ts` — configuração default (mock GoTrue, Postgres via Testcontainers).
- `playwright.auth-real.config.ts` — configuração paralela que aponta para `supabase start` real (suite `@auth-real`).
- `e2e/start-server.ts` — wrapper do `webServer.command` que faz boot dinâmico (Postgres + mock GoTrue) e só então `exec`a `next start`. Workaround canônico para o webServer-antes-do-globalSetup do Playwright.
- `e2e/global-setup.ts`, `e2e/global-teardown.ts` — leem `seed-state.json` escrito pelo wrapper, fazem o seed do banco e disparam o teardown do container.
- `e2e/auth.setup.ts` — escreve `storageState` simulado consumido pelos testes `@auth`.
- `e2e/seed-state.ts` — protocolo de hand-off entre o wrapper e `globalSetup`.
- `e2e/tags.json` — registry de tags (`@health`, `@auth`, `@auth-real`).
- `e2e/*.spec.ts` — os testes propriamente ditos.
- `lib/test-utils/mock-gotrue.ts` — mock GoTrue in-process reutilizável (lift de `e2e/mock-gotrue.ts`).
- `lib/test-utils/mock-gotrue.test.ts` — testes unitários do contrato do helper.
- `__tests__/integration/setup/postgres-container.ts` — boot do Postgres Testcontainers, reutilizado pelo wrapper.

## Superfície pública

- **Scripts npm**:
  - `npm run test:e2e` — roda Playwright com a config default. Requer `next build` prévio.
  - `npm run test:e2e:real` — roda Playwright com a config `@auth-real` (precisa de `supabase start` rodando).
  - `npx playwright test --grep @<tag>` — filtro por tag.
- **Helper** `startMockGotrue(options?: MockGoTrueOptions): Promise<MockGoTrueHandle>` em `lib/test-utils/mock-gotrue.ts`:
  - Retorno: `{ port: number; stop: () => Promise<void>; jwt: string; url: string }`.
  - Defaults: `port = 54321`, seeded user `00000000-0000-4000-8000-000000000001`, JWT mintado in-process via `buildFixedJwt`.
  - Overrides aceitos: `port`, `fixedToken`, `user`.
  - Helpers exports: `buildFixedJwt(payload)`, `base64UrlEncode(value)` para callers que precisam mintar tokens custom.
- **Tag registry**: `e2e/tags.json` com `@health` (ativo), `@auth` (suite default mockado), `@auth-real` (suite real-Supabase).

## Comportamento e invariantes

- **Default port `54321` é load-bearing**: `NEXT_PUBLIC_SUPABASE_URL` é inlinado no edge runtime no `next build`. O middleware sempre bate na porta que o build viu, então o mock precisa ouvir em `127.0.0.1:54321` (mesma porta que `supabase start` expõe), permitindo que um único build artefato sirva tanto a suite mock-GoTrue quanto `@auth-real`.
- **Consequência prática**: as duas suítes não rodam concorrentemente — disputam a mesma porta.
- **Playwright sobe `webServer` ANTES de `globalSetup`** (verificável em `node_modules/playwright/lib/runner/tasks.js::createGlobalSetupTasks`). Por isso valores dinâmicos (URL Testcontainers, porta de mock) são resolvidos em `e2e/start-server.ts`, não em `globalSetup`.
- **`playwright.auth-real.config.ts` faz `execSync('npx supabase status -o json')` no top-level** — mesmo problema que (b) em outra fantasia. Não tente "consertar" movendo para `globalSetup`: o Next spawnado não enxerga as vars setadas lá.
- **`supabase status -o json` usa `SCREAMING_SNAKE_CASE`** (`API_URL`, `DB_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`), não camelCase como outros outputs do CLI.
- **Mock GoTrue não verifica assinatura JWT** — qualquer terceiro segmento não-vazio é sintaticamente aceito por `decodeJWT()` do supabase-js. O `buildFixedJwt` retorna um token cuja assinatura é literal `mock-signature`.
- **Surface mínima do mock**: `GET /auth/v1/user` (bearer match → user JSON; else 401), `POST /auth/v1/logout` (sempre 204), `GET /auth/v1/settings` (200 com payload benigno). Qualquer outra rota → 404 explícito (falhas devem ser ruidosas).
- **`stop()` é assíncrono** e libera o socket; após resolver, a porta é re-bindable sem `EADDRINUSE`.
- **LGPD/segurança**: nada de dados reais — mock só conhece o seed user determinístico. Helper vive em `lib/test-utils/`, intencionalmente fora do path de runtime, mas alcançável via alias `@/` (follow-up: ESLint guard contra import de prod).

## Testes

- **Unit**: `lib/test-utils/mock-gotrue.test.ts` — 3 cases (handle shape, JWT structure + payload, port rebindable após `stop()`).
- **E2E**: `e2e/auth.spec.ts` (`@auth`) — exercita o caminho real do helper via `e2e/start-server.ts` (override branch de `fixedToken` + `user`).
- **E2E (real Supabase)**: `e2e/auth-real.spec.ts` (`@auth-real`) — não usa o mock; valida o flow real contra `supabase start`.

## Histórico de changes

- 2026-05-02 dev-cycle-followups-001 — lift de `e2e/mock-gotrue.ts` para `lib/test-utils/mock-gotrue.ts` com handle reshapeado para `{ port, stop, jwt }`. Adiciona unit tests de contrato e migra `e2e/start-server.ts`. Veja `../openspec/changes/archive/2026-05-02-dev-cycle-followups-001/`.
- 2026-05-02 smoke-health-feature — introduz a suite `@auth-real` em paralelo com a suite default mockado, documenta a setup do `storageState` simulado, registra tag `@auth-real`. Veja `../openspec/changes/archive/2026-05-02-smoke-health-feature/`.
- 2026-05-02 bootstrap-data-and-tests — capability criada: Playwright runner, Testcontainers Postgres em `globalSetup`, `storageState` reusable, tag registry, smoke `@health` passando. Veja `../openspec/changes/archive/2026-05-02-bootstrap-data-and-tests/`.
