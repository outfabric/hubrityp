# e2e-auth-real-suite

## Resumo

Define a suite Playwright dedicada que exercita o handshake completo de sign-in / sign-out contra um stack Supabase real iniciado via `supabase start`, mantida isolada da suite default (mock GoTrue + Testcontainers) tanto em runtime quanto em CI. Após o refactor estrutural, a suite mora em `src/__tests__/e2e/real/`, o config se chama `playwright.real.config.ts`, e o relatório é gravado em `playwright-report-real/`.

## Onde mora o código

- `playwright.real.config.ts` — config standalone (não estende `playwright.seeded.config.ts`). Lê `npx supabase status -o json` no top-level e popula `process.env.AUTH_REAL_*` para o `globalSetup` consumir. `testDir: './src/__tests__/e2e/real'`, `outputDir: 'test-results-real'`, report folder `playwright-report-real`.
- `src/__tests__/e2e/real/auth.spec.ts` — único teste hoje (`@auth-real`): login → dashboard → logout → de volta a `/login`.
- `src/__tests__/e2e/real/setup/global-setup.ts` — seed de user via Supabase Admin API (`admin.createUser` com `email_confirm: true`); idempotente (deleta user pré-existente com mesmo email antes de criar).
- `src/__tests__/e2e/real/setup/global-teardown.ts` — limpa fixture file (e demais artefatos transitórios).
- `src/__tests__/e2e/real/setup/credentials.ts` — constants e tipos compartilhados (`SEED_EMAIL`, `SEED_PASSWORD`, `CREDENTIALS_FILE_NAME`, `AuthRealCredentials`).
- Fixture transitório: `src/__tests__/e2e/real/setup/.auth/credentials.json` — escrito pelo globalSetup, lido pelo `auth.spec.ts`. Não comitado (`.gitignore`).

## Superfície pública

- **Script npm**: `npm run test:e2e:real` → `playwright test --config playwright.real.config.ts`.
- **Tag**: `@auth-real` — único namespace usado pela suite hoje. Documentado em `src/__tests__/e2e/seeded/tags.json` como cross-ref para a suite real.
- **Pré-requisito**: `npx supabase start` rodando antes de invocar o script. O config falha cedo (top-level `execSync`) com mensagem clara se o stack não está up.
- **Vars de ambiente expostas pelo config** (read-only para o globalSetup):
  - `AUTH_REAL_SUPABASE_URL`
  - `AUTH_REAL_SUPABASE_ANON_KEY`
  - `AUTH_REAL_SUPABASE_SERVICE_ROLE_KEY`
  - `AUTH_REAL_DATABASE_URL`

## Comportamento e invariantes

- **Suite isolada do mock-GoTrue**: a config NÃO estende `playwright.seeded.config.ts`. Ambas as configs bindam server na porta 54321 e portanto não rodam concorrentemente.
- **CI sequencia via `needs: e2e`**: o job `e2e-real` só roda se `e2e` (seeded) passar. Salva runner minutes e respeita o constraint de porta.
- **`supabase status -o json` lido NO config-load**: `webServer.env` é capturado em config-load time. Tentar resolver no globalSetup quebra — o Next spawnado não enxergaria as vars setadas lá.
- **Stack real é shelled out**: nenhum mock; GoTrue real, Postgres real, sessão real. É o teste que garante que o caminho de produção continua funcionando depois de qualquer mudança em auth/middleware/Supabase clients.
- **Seed user idempotente**: `admin.listUsers()` paginado pega a primeira página; se houver match com `SEED_EMAIL`, deleta e recria. Não-idempotência seria flake garantida em CI retries.
- **`email_confirm: true` no createUser**: short-circuita o passo de verificação por email (que normalmente bloqueia signin). Local-only — produção nunca seeda usuários assim.
- **Credentials via JSON file**, não env vars: workers Playwright rodam em processos separados; env state setado no globalSetup não sobrevive à fronteira de processo. Arquivo é o canal mais simples.
- **`workers: 1`**: o seeded user é recurso compartilhado (uma row em `auth.users`). Cap em 1 worker mantém determinismo se mais cases forem adicionados que mutem o mesmo user.
- **`supabase stop --no-backup` no `if: always()`** (em CI): mesmo se o teste falhar, o stack é derrubado para não vazar containers em retries. `--no-backup` pula o dump local (~10s, inútil em CI).
- **`outputDir: test-results-real`** e **`outputFolder: playwright-report-real`**: nomes simétricos com a suite seeded (`test-results/`, `playwright-report/`). Renomeados nesta refactor para tirar o legado `auth-real` do nome.

## Testes

A própria suite `@auth-real` é o teste:

- **`src/__tests__/e2e/real/auth.spec.ts`** — único spec, tag `@auth-real`. Round-trip:
  1. `goto('/login')`, preenche email/senha do seed, clica submit.
  2. `waitForURL('**/dashboard')`, valida `URL` e `data-testid="dashboard-greeting"` com `Olá, <email>`.
  3. Clica `data-testid="dashboard-logout"`, `waitForURL('**/login')`, valida que o form de login está visível e que o greeting some.

Não há suite separada de "regression" para a auth-real além desse spec. A intenção é que essa suite cresça junto com superfícies que dependem do real handshake (futuro: passwordless, MFA, recovery).

## Histórico de changes

- 2026-05-03 reorganize-folder-structure — suite relocada de `e2e-auth-real/` para `src/__tests__/e2e/real/`. Config renomeada de `playwright.auth-real.config.ts` para `playwright.real.config.ts` (`testDir`, `globalSetup`, `globalTeardown` atualizados). `outputDir` e `outputFolder` renomeados para `test-results-real` e `playwright-report-real` (simetria com a suite seeded). CI artifact renomeado para `playwright-report-real`. Veja [`../openspec/changes/archive/2026-05-03-reorganize-folder-structure/`](../openspec/changes/archive/2026-05-03-reorganize-folder-structure/).
- 2026-05-02 smoke-health-feature — capability criada: suite Playwright dedicada `@auth-real`, seed via Admin API, CI job gateado por `needs: e2e`.
