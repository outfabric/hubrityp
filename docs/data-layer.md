# data-layer

## Resumo

Define como o HubrityP organiza schema Postgres, gera/aplica migrations Drizzle e enforça Row Level Security para que toda tabela owner-scoped siga o mesmo padrão auditável. Após o refactor estrutural, schema, migrations e runtime client vivem todos sob `src/shared/db/`, e o CLI `db:migrate` mora em `scripts/db-migrate.ts` (fora de `src/`, porque é tooling, não código de aplicação).

## Onde mora o código

- **Schema Drizzle** (`src/shared/db/schema/`):
  - `src/shared/db/schema/<domain>/tables.ts` — definições de tabela. Hoje: `health/tables.ts` (tabela seed `health_pings`).
  - `src/shared/db/schema/<domain>/policies.ts` — strings SQL das policies RLS, anexadas manualmente à migration gerada (Drizzle não tem DSL para RLS).
  - `src/shared/db/schema/index.ts` — barrel que re-exporta toda tabela para a API relacional do Drizzle.
- **Migrations**:
  - `src/shared/db/migrations/` — SQL gerado por `drizzle-kit generate` + RLS anexada manualmente.
  - `src/shared/db/migrations/meta/_journal.json` + `meta/<n>_snapshot.json` — metadados gerenciados pelo drizzle-kit.
  - `src/shared/db/migrations/README.md` — template canônico de RLS owner-scoped.
- **Runtime client**:
  - `src/shared/db/client.ts` — exporta `db: AppDb` (Drizzle sobre `postgres-js`, max 1 conexão por invocação Vercel). Importa `serverEnv.DATABASE_URL` e o schema barrel.
- **CLI**:
  - `scripts/db-migrate.ts` — runner CLI consumido por `npm run db:migrate`. Usa `dotenv/config` + leitura direta de `process.env.DATABASE_URL` (allow-list ESLint).
- **Config**:
  - `drizzle.config.ts` — `schema: './src/shared/db/schema/**/tables.ts'`, `out: './src/shared/db/migrations'`.

## Superfície pública

- **Imports de aplicação**:
  - `import { db } from '@/shared/db/client'` — runtime Drizzle client.
  - `import * as schema from '@/shared/db/schema'` — barrel; ou imports específicos como `import { healthPings, type NewHealthPing } from '@/shared/db/schema/health/tables'`.
- **Scripts npm**:
  - `npm run db:generate` → `drizzle-kit generate` (escreve em `src/shared/db/migrations/`).
  - `npm run db:migrate` → `tsx scripts/db-migrate.ts` (aplica migrations no DB apontado por `DATABASE_URL`).
  - `npm run db:push` → `drizzle-kit push` (prototyping; pular em fluxos de produção).
  - `npm run db:studio` → `drizzle-kit studio`.
- **Tipos derivados**: `typeof healthPings.$inferSelect` (`HealthPing`) e `$inferInsert` (`NewHealthPing`) — fonte única para tipos de payload.

## Comportamento e invariantes

- **RLS é não-negociável**: toda tabela nova MUST ter RLS habilitado e as 4 policies owner-scoped (select/insert/update/delete) chaveadas em `auth.uid() = owner_id`. Migration sem policy é bug — o teste de policy coverage (ver Testes) bloqueia o merge.
- **Service-role bypass**: o role `service_role` é criado com `BYPASSRLS` no bootstrap do container de teste; em produção, o Supabase já provê. Use apenas para fixture setup ou jobs internos.
- **Pool de conexões**: `postgres({ max: 1 })` — uma conexão por invocação Vercel Function. Mantém churn de cold-start baixo sem exaurir o limite de conexões do Supabase.
- **`server-only` no client**: `src/shared/db/client.ts` faz `import 'server-only'`; tentar importar do bundle do browser falha no build. Em testes, um stub em `src/__tests__/stubs/server-only.ts` neutraliza o import (Vitest alias).
- **Bootstrap de `auth.users` em testes**: `src/__tests__/e2e/_shared/postgres-container.ts` instala roles (`authenticated`, `anon`, `service_role`), schema `auth`, função `auth.uid()` (lê `request.jwt.claims->>'sub'`) e tabela `auth.users` minimal — a superfície que as policies RLS exigem. Em produção, o Supabase faz isso.
- **Convenção owner-scoped**: tabelas têm `owner_id uuid NOT NULL` (referenciando logicamente `auth.users`); o template completo de policies está em `src/shared/db/migrations/README.md`.
- **Migrations geradas + editadas**: drizzle-kit gera o DDL; o RLS é anexado MANUALMENTE no mesmo arquivo SQL antes do commit. Não tem auto-pickup das `policies.ts` — elas são fonte legível, não o que o runner aplica.
- **`drizzle.config.ts` lê `process.env.DATABASE_URL` direto**: está na allow-list do ESLint porque rola fora do bundle Next (sem acesso a `serverEnv` validado).

## Testes

- **Integration** (`src/__tests__/integration/`):
  - `policy-coverage.int.test.ts` — lint test: glob de `src/shared/db/schema/**/tables.ts`, verifica que toda tabela tem `CREATE POLICY ... ON <table>` correspondente em `src/shared/db/migrations/**.sql`. Falha com nome da tabela ofendendo.
  - `health-pings.int.test.ts` — RLS round-trip: owner lê seu próprio ping, non-owner não vê, service-role vê tudo.
  - `api-health.int.test.ts`, `api-me.int.test.ts` — cobertura indireta via route handlers.
- **Unit**: o data-layer não tem unit test próprio (é fundamentalmente integrado). Toda lógica fica nos testes de integração.

## Histórico de changes

- 2026-05-03 reorganize-folder-structure — consolidação completa em `src/shared/db/`: schema (`schema/<domain>/`), migrations (`migrations/`), runtime client (`client.ts`). CLI `db/migrate.ts` movida para `scripts/db-migrate.ts`. `drizzle.config.ts` atualizado para apontar para os novos caminhos. Imports passam a ser `@/shared/db/client` e `@/shared/db/schema` (eliminadas as legacy `@/lib/db/*` e `@/db/*`). Veja [`../openspec/changes/archive/2026-05-03-reorganize-folder-structure/`](../openspec/changes/archive/2026-05-03-reorganize-folder-structure/).
- 2026-05-02 bootstrap-data-and-tests — capability criada: schema `health_pings`, migrations com RLS owner-scoped, runtime client, scripts `db:*`, lint test de policy coverage.
