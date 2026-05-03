# code-organization

## Resumo

Define o layout canônico do código-fonte do HubrityP: `src/` como raiz da aplicação, `src/modules/<domain>/` para código de domínio com fronteira pública via `index.ts`, `src/shared/` para infraestrutura cross-module, `src/__tests__/` para todos os testes, `scripts/` para CLIs operacionais e `docs/` para documentação humana. Toda capability futura (billing, scheduling, prontuário, ...) herda essas convenções e o ESLint enforça as regras de fronteira.

## Onde mora o código

- `src/app/` — Next.js App Router (route groups `(app)` e `(auth)`, route handlers em `api/`).
- `src/middleware.ts` — middleware raiz do Next.js (cookie refresh + auth gating).
- `src/modules/<domain>/` — código de domínio. Layout interno fixo:
  - `components/` — Server e Client Components do domínio.
  - `server/` — implementações de Server Actions e demais funções server-only.
  - `lib/` — schemas Zod, mappers, helpers puros, branded types.
  - `index.ts` — barrel público (única entrada para consumidores externos).
- `src/modules/auth/`, `src/modules/health/` — módulos seed do refactor; `health` ainda só expõe um barrel vazio (`export {}`) porque sua superfície vive no schema Drizzle e no route handler.
- `src/shared/` — infraestrutura cross-module:
  - `src/shared/ui/` — primitives shadcn (`button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`).
  - `src/shared/lib/` — `utils.ts` (`cn()`), `logger.ts` (Pino).
  - `src/shared/env/` — env validado por Zod (`index.ts` server, `client.ts` browser-safe, `schemas.ts`).
  - `src/shared/supabase/` — clientes Supabase para `server`, `client` e `middleware`.
  - `src/shared/db/` — runtime Drizzle (`client.ts`), schema (`schema/<domain>/`), migrations (`migrations/`).
- `src/__tests__/` — todos os testes (centralizados, não colocados):
  - `unit/` — Vitest unit (`*.test.ts`, `*.test.tsx`); a árvore espelha `src/modules/` e `src/shared/`.
  - `integration/` — Vitest integration (`*.int.test.ts`); contém `setup/` e `factories/`.
  - `e2e/_shared/` — módulos compartilhados entre integration e seeded e2e (notavelmente `postgres-container.ts`).
  - `e2e/seeded/` — Playwright com mock GoTrue.
  - `e2e/real/` — Playwright contra `supabase start`.
  - `stubs/` — runtime stubs (ex.: `server-only.ts`).
- `scripts/` — CLIs operacionais (`scripts/db-migrate.ts` é o primeiro habitante).
- `docs/` — documentação humana: `docs/prd/`, `docs/design-system/`, docs de capability geradas pelo `/dev-cycle`.

## Superfície pública

- **Path alias**: `@/*` resolve para `./src/*` (configurado em `tsconfig.json` `compilerOptions.paths`). Nenhum import deve usar `../../*` — o ESLint rejeita.
- **Regra de import entre módulos**: consumidores externos importam de `@/modules/<domain>` (o `index.ts`), nunca de `@/modules/<domain>/server/*` ou `@/modules/<domain>/components/*`.
- **Direção de dependência**: `src/modules/*` PODE importar de `src/shared/*`; `src/shared/*` NÃO PODE importar de `src/modules/*`.
- **Route shells**: `src/app/<route>/actions.ts` declara `'use server'` e re-exporta funções de `@/modules/<domain>/server/*` via wrappers async finos. Páginas (`page.tsx`) compõem componentes vindos de módulos sem conter lógica de domínio.
- **Path alias para testes**: `@/__tests__/...` funciona porque o alias resolve para `src/`. Não há alias separado `@tests/*`.
- **Ausência de aliases extras**: não introduzir `@modules/*`, `@shared/*` ou `@tests/*` — `@/*` cobre tudo.

## Comportamento e invariantes

- **Próximos módulos herdam o layout**. Adicionar `src/modules/billing/` exige `index.ts` desde o primeiro commit; `components/`, `server/` e `lib/` são opcionais conforme a necessidade.
- **Novas pastas em `src/shared/`** só são introduzidas quando o conceito é genuinamente cross-module e não cabe nas existentes; documentar a razão no `README.md` antes do merge.
- **`'use server'` mora no shell, não no módulo**. `src/modules/auth/server/login.ts` é um módulo regular; o `'use server'` vive em `src/app/(auth)/login/actions.ts`. Marcar o módulo como `'use server'` quebra Client Components que importam helpers do barrel (RSC boundary checker rejeita o build).
- **Consumidores client-side de Server Actions** (Client Components) importam do **route shell** (`@/app/(auth)/login/actions`), nunca do barrel `@/modules/auth` — o barrel arrasta `server-only` para o bundle do browser. O barrel é a entrada para consumidores **server-side** (outros shells, testes server).
- **Tests excluídos do bundle de produção** via `next.config.ts` `outputFileTracingExcludes: { '/**': ['**/__tests__/**'] }` — defesa em profundidade contra import inadvertido em código de runtime.
- **`scripts/` não é código de aplicação** — não importar `server-only` (CLI roda fora do bundle Next), e está na allow-list do ESLint para acesso direto a `process.env`.
- **`docs/` está fora do typecheck e do lint** (ignored em `eslint.config.mjs`). PRDs e docs de capability não devem ter código TypeScript executável.

## Testes

A própria capability `code-organization` é estrutural — não tem testes funcionais dedicados; ela é validada indiretamente por:

- **Unit + Integration + E2E**: que continuam verdes após o refactor (sinal de que paths e aliases estão corretos).
- **Lint test de policy coverage** — `src/__tests__/integration/policy-coverage.int.test.ts` faz glob de `src/shared/db/schema/**/tables.ts` e exige RLS correspondente em `src/shared/db/migrations/`. Esse glob hardcoded no teste é o melhor canário de drift estrutural na árvore `src/shared/db/`.
- **Env coverage** — `src/__tests__/integration/env-coverage.int.test.ts` valida que `.env.example` lista toda chave consumida por `src/shared/env/schemas.ts`.
- **Auditoria manual no PR**: `grep -r "from '@/lib/" src/`, `grep -r "from '@/db/" src/`, `grep -r "from '@/components/" src/` retornam zero matches (ver task 13.9 do change arquivado).

## Histórico de changes

- 2026-05-03 reorganize-folder-structure — capability criada: `src/` como raiz, `src/modules/<domain>/` com layout fixo (`components/`, `server/`, `lib/`, `index.ts`), `src/shared/` cobrindo `ui/`, `lib/`, `env/`, `supabase/`, `db/`, testes centralizados em `src/__tests__/{unit,integration,e2e/{_shared,seeded,real},stubs}/`, `scripts/db-migrate.ts` para CLIs operacionais, `docs/prd/` para PRDs. Veja [`../openspec/changes/archive/2026-05-03-reorganize-folder-structure/`](../openspec/changes/archive/2026-05-03-reorganize-folder-structure/).
