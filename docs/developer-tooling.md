# developer-tooling

## Resumo

Define os quality gates e o tooling local + CI do HubrityP: scripts npm `lint`/`format`/`typecheck`/`check`, runners Vitest unit e integration, runners Playwright seeded e real, ESLint flat config com regras de fronteira (no-`any`, no-`enum`, no-deep-relative, no-direct-`process.env`, no-deep-cross-module-import), TypeScript strict, hook pre-commit Husky + lint-staged. Após o refactor, o CLI de migration mora em `scripts/db-migrate.ts` e os scripts e2e seguem a simetria `test:e2e:seeded` / `test:e2e:real`.

## Onde mora o código

- **Scripts** (`package.json`):
  - `lint`, `format`, `format:check`, `typecheck`, `check` (chain `lint && format:check && typecheck`).
  - `test:unit`, `test:integration`, `test:e2e:seeded`, `test:e2e:real`.
  - `db:generate`, `db:migrate` (→ `tsx scripts/db-migrate.ts`), `db:push`, `db:studio`.
  - `supabase:start`, `supabase:stop`, `supabase:reset`.
- **Configs raiz**:
  - `tsconfig.json` — `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, alias `@/*` → `./src/*`.
  - `tsconfig.node.json` — TS para configs e scripts (`drizzle.config.ts`, `playwright.*.config.ts`, `scripts/db-migrate.ts`).
  - `eslint.config.mjs` — flat config: `eslint-config-next/core-web-vitals` + `@typescript-eslint/recommended-type-checked` + regras custom. Allow-list de arquivos com permissão para `process.env` direto.
  - `.prettierrc.json`, `.prettierignore` — Prettier + plugin Tailwind.
  - `vitest.config.ts` — runner unit (include `src/__tests__/unit/**/*.test.ts(x)`, exclude integration/e2e).
  - `vitest.integration.config.ts` — runner integration (include `src/__tests__/integration/**/*.int.test.ts`, `globalSetup` em `src/__tests__/integration/setup/global-setup.ts`).
  - `vitest.setup.ts` — setup compartilhado (env defaults, console silenciado).
  - `playwright.seeded.config.ts`, `playwright.real.config.ts` — configs Playwright separados (ver `e2e-test-stack` e `e2e-auth-real-suite`).
- **Hooks**:
  - `.husky/pre-commit` — chama `lint-staged`.
  - `package.json` `lint-staged` — `eslint --fix` + `prettier --write` em arquivos staged.
- **CLI**:
  - `scripts/db-migrate.ts` — único habitante de `scripts/` hoje; runner de Drizzle migrate.
- **CI**:
  - `.github/workflows/ci.yml` — jobs `quality` → `integration` + `e2e` → `e2e-real` (ver capability `ci-pipeline`).

## Superfície pública

- **Scripts npm** (entrada principal):
  - `npm run check` — lint + format:check + typecheck (gate canônico de PR local).
  - `npm run test:unit` — Vitest unit; ambient `node` para `*.test.ts`, `jsdom` para `*.test.tsx`.
  - `npm run test:integration` — Vitest integration; boota Postgres via Testcontainers em globalSetup.
  - `npm run test:e2e:seeded` — Playwright contra `playwright.seeded.config.ts` (mock GoTrue + Testcontainers Postgres).
  - `npm run test:e2e:real` — Playwright contra `playwright.real.config.ts` (real `supabase start`).
  - `npm run db:migrate` — aplica migrations via `tsx scripts/db-migrate.ts`.
- **Regras ESLint custom** (`eslint.config.mjs`):
  - `@typescript-eslint/no-explicit-any` — sem `any`.
  - `@typescript-eslint/ban-ts-comment` — `ts-ignore` proibido; `ts-expect-error` precisa de descrição ≥5 chars.
  - `no-restricted-syntax`: `enum` proibido; `process.env.*` proibido fora da allow-list.
  - `no-restricted-imports`: deep relative (`../../*`) proibido — use `@/`.
  - `@typescript-eslint/consistent-type-imports` — preferir `import type`.
  - `import/order` — agrupamento e ordenação alfabética.
- **`tsconfig.json` highlights**: `strict`, `noUncheckedIndexedAccess` (índice de array retorna `T | undefined`), `verbatimModuleSyntax` (proíbe import não-tipado de tipos).

## Comportamento e invariantes

- **`npm run check` é o gate canônico**: chain `lint && format:check && typecheck`. Cada step falha-rápido. Pre-commit hook + CI rodam variações dele. Uma falha de lint não passa para format:check; uma falha de format:check não passa para typecheck.
- **Pre-commit não é skipável** — `git commit --no-verify` é proibido por convenção (CLAUDE.md). Auto-fix do Prettier é re-staged automaticamente; problemas de lint que não auto-fixam abortam o commit.
- **Allow-list de `process.env`** (`eslint.config.mjs` segundo bloco `files`):
  - `src/shared/env/index.ts`, `src/shared/env/client.ts`
  - `drizzle.config.ts`, `scripts/db-migrate.ts`
  - `vitest.setup.ts`, `playwright.seeded.config.ts`, `playwright.real.config.ts`
  - `src/__tests__/integration/setup/**`, `src/__tests__/e2e/_shared/**`, `src/__tests__/e2e/seeded/setup/**`, `src/__tests__/e2e/real/setup/**`
- **Scripts e2e simétricos**: `test:e2e:seeded` (mock GoTrue) e `test:e2e:real` (real Supabase). O legacy `test:e2e` foi removido — qualquer script/doc/agente que ainda o referencie é bug.
- **`db:migrate` aponta para `scripts/db-migrate.ts`**: o arquivo NÃO existe em `db/migrate.ts`. O ESLint allow-list permite o `process.env.DATABASE_URL` direto porque o script roda fora do bundle Next.
- **Tests excluídos do unit runner**: `vitest.config.ts` exclui `src/__tests__/integration` e `src/__tests__/e2e`. Tests de integração têm sufixo `*.int.test.ts` e o runner integration explicitamente os procura.
- **`vitest.setup.ts` injeta env defaults para unit**: garante que `serverEnv` parseia mesmo quando o dev não tem `.env.local`. Está na allow-list do ESLint.
- **Husky `prepare` script** roda no `npm install` para registrar o hook — não pular.

## Testes

A capability `developer-tooling` é validada principalmente por ela mesma — se `npm run check` passa em CI, a capability funciona. Asserts adicionais:

- **Integration**:
  - `src/__tests__/integration/env-coverage.int.test.ts` — confirma que `.env.example` cobre todas as keys do schema (drift detection).
- **CI** (`.github/workflows/ci.yml`):
  - Job `quality` roda `lint`, `typecheck`, `format:check`, `test:unit` em sequência. Falha de qualquer um bloqueia `integration` e `e2e`.
- **Unit/Integration/E2E** das outras capabilities — todas passam apenas se o tooling está sano.

## Histórico de changes

- 2026-05-03 reorganize-folder-structure — `db:migrate` passou a invocar `tsx scripts/db-migrate.ts` (relocado de `db/migrate.ts`). Script e2e renomeado de `test:e2e` para `test:e2e:seeded` para simetria com `test:e2e:real`. ESLint `no-restricted-imports`/`no-restricted-syntax` allow-list atualizada para os novos paths (`scripts/db-migrate.ts`, `src/shared/env/*`, `src/__tests__/{integration,e2e}/setup/**`). `tsconfig.json` `@/*` agora resolve para `./src/*`. Veja [`../openspec/changes/archive/2026-05-03-reorganize-folder-structure/`](../openspec/changes/archive/2026-05-03-reorganize-folder-structure/).
- 2026-05-02 bootstrap-foundation — capability criada: scripts `lint`/`format`/`typecheck`/`check`, TypeScript strict, ESLint flat config, Husky + lint-staged, Vitest unit runner.
