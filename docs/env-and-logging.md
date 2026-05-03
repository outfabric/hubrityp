# env-and-logging

## Resumo

Define como o HubrityP valida variáveis de ambiente, expõe um split server/client seguro, redacta dados sensíveis no logger Pino e provê os helpers Supabase Auth para todos os contextos de execução (RSC, Server Action, Client Component, middleware). Após o refactor estrutural, env mora em `src/shared/env/`, logger em `src/shared/lib/logger.ts`, e Supabase em `src/shared/supabase/`. Acesso direto a `process.env` é bloqueado por ESLint em todo lugar que não esteja na allow-list.

## Onde mora o código

- **Env**:
  - `src/shared/env/schemas.ts` — `clientEnvSchema` (apenas `NEXT_PUBLIC_*`) e `serverEnvSchema` (extends do client com `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LOG_LEVEL`, `NODE_ENV`).
  - `src/shared/env/index.ts` — barrel server-side; faz `import 'server-only'`, parseia `serverEnvSchema.safeParse(process.env)` no module load, throws com mensagens descritivas se faltar/malformar. Re-exporta `clientEnv` para conveniência.
  - `src/shared/env/client.ts` — shim browser-safe; sem `server-only`. Lê apenas `NEXT_PUBLIC_*` direto de `process.env` (Next inlinea no build).
- **Logger**:
  - `src/shared/lib/logger.ts` — Pino com `import 'server-only'`. Configurado com redaction LGPD (paths e wildcards). Level vem de `serverEnv.LOG_LEVEL`; em `NODE_ENV=test` força `silent`. Em dev usa `pino-pretty`.
- **Supabase clients** (todos `src/shared/supabase/`):
  - `server.ts` — `createServerClient()` para RSC + Server Actions; lê cookies via `next/headers`.
  - `client.ts` — `createBrowserClient()` para `'use client'` components.
  - `middleware.ts` — `createMiddlewareClient(request)` para o root middleware; retorna `{ supabase, response }` onde `response` carrega cookies refreshados.
- **`.env.example`** — lista toda chave consumida por `src/shared/env/schemas.ts`.

## Superfície pública

- **Imports server-side**: `import { serverEnv, clientEnv } from '@/shared/env'`.
- **Imports client-side**: `import { clientEnv } from '@/shared/env/client'` (NÃO `from '@/shared/env'` — arrasta `server-only`).
- **Logger**: `import { logger } from '@/shared/lib/logger'`. Métodos Pino padrão (`info`, `warn`, `error`, `debug`).
- **Supabase**:
  - `import { createServerClient } from '@/shared/supabase/server'` — RSC, Server Actions, Route Handlers.
  - `import { createBrowserClient } from '@/shared/supabase/client'` — Client Components.
  - `import { createMiddlewareClient } from '@/shared/supabase/middleware'` — exclusivo do `src/middleware.ts`.
- **Env vars** (definidas em `serverEnvSchema`):
  - `DATABASE_URL` (string url)
  - `NEXT_PUBLIC_SUPABASE_URL` (string url)
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (string min 1)
  - `SUPABASE_SERVICE_ROLE_KEY` (string min 1)
  - `LOG_LEVEL` (`debug` | `info` | `warn` | `error` | `silent`, default `info`)
  - `NODE_ENV` (`development` | `production` | `test`, default `development`)

## Comportamento e invariantes

- **Boot fail-fast**: `src/shared/env/index.ts` parseia no module-load. Variável faltando ou malformada → server não inicia, com erro Zod nomeando o campo. Garante que código nunca recebe `undefined` em vars obrigatórias.
- **`serverEnv` é inalcançável do client bundle**: `import 'server-only'` no `index.ts` faz o build falhar se algum Client Component tentar consumir. Use `@/shared/env/client` em código client-side.
- **`process.env.*` é proibido fora da allow-list** (ESLint `no-restricted-syntax` em `eslint.config.mjs`). Allow-list:
  - `src/shared/env/index.ts`, `src/shared/env/client.ts` — os módulos de validação propriamente ditos.
  - `drizzle.config.ts` — config CLI fora do bundle Next.
  - `scripts/db-migrate.ts` — CLI de migração relocada.
  - `vitest.setup.ts`, `playwright.seeded.config.ts`, `playwright.real.config.ts` — setup de runners.
  - `src/__tests__/integration/setup/**`, `src/__tests__/e2e/_shared/**`, `src/__tests__/e2e/seeded/setup/**`, `src/__tests__/e2e/real/setup/**` — setups de teste precisam injetar env antes do app code carregar.
- **Redaction LGPD do logger** — paths em `redactPaths` (substituídos por `[Redacted]`):
  - Wildcards: `*.cpf`, `*.email`, `*.phone`, `*.password`, `*.token`, `*.jwt`.
  - Top-level: `cpf`, `email`, `phone`, `password`, `token`, `jwt`.
  - Específicos: `headers.authorization`, `headers.cookie`, `body.message`, `transcription`, `note`.
  - Adicione novos paths sempre que introduzir um campo sensível — está documentado em `CLAUDE.md`.
- **Logger silencia em testes**: quando `serverEnv.NODE_ENV === 'test'`, o level é `silent` independente do `LOG_LEVEL` do `.env`. Testes não poluem stdout.
- **`createServerClient` não é memoizado entre requests**: cada request lê seus próprios cookies via `next/headers.cookies()` para evitar session bleed entre usuários.
- **`cookies().set` em RSC é ignorado**: o `setAll` callback do Supabase tenta setar cookies; em RSC isso lança, e nós engolimos (cookies só mutáveis em Server Action / Route Handler / middleware). Match com o exemplo oficial `@supabase/ssr`.
- **Middleware client retorna `response` mutável**: o caller TEM que retornar esse response (ou transplantar os cookies para um redirect via helper) — senão tokens refreshados são silenciosamente perdidos.

## Testes

- **Unit** (`src/__tests__/unit/shared/`):
  - `env/schemas.test.ts` — valida shapes Zod (`clientEnvSchema`, `serverEnvSchema`), defaults, rejeição de URLs malformadas, rejeição de strings vazias.
  - `lib/logger.test.ts` — instancia logger, valida que email/password/token são redactados, valida silent em `NODE_ENV=test`.
  - `supabase/server.test.ts` — `createServerClient()` lê cookies de `next/headers`, swallow de `set` em RSC.
  - `supabase/middleware.test.ts` — `createMiddlewareClient(request)` propaga cookies refreshados ao response.
- **Integration** (`src/__tests__/integration/`):
  - `env-coverage.int.test.ts` — lint test: parse de `.env.example` vs keys de `clientEnvSchema` + `serverEnvSchema`. Forces drift detection.
- **E2E**: cobertura indireta — toda suite e2e passa apenas se env vars são corretamente lidas no boot do server. Stack mock GoTrue (seeded) e real Supabase (real) exercitam o caminho `createServerClient` + `createMiddlewareClient`.

## Histórico de changes

- 2026-05-03 reorganize-folder-structure — env relocada de `lib/env*` para `src/shared/env/` (split em `index.ts`/`client.ts`/`schemas.ts`); logger relocado de `lib/logger.ts` para `src/shared/lib/logger.ts`; Supabase clients relocados de `lib/supabase/*` para `src/shared/supabase/*`. ESLint allow-list de `process.env` atualizada para os novos paths (e adiciona `scripts/db-migrate.ts`). Imports passam a ser `@/shared/env`, `@/shared/lib/logger`, `@/shared/supabase/*`. Veja [`../openspec/changes/archive/2026-05-03-reorganize-folder-structure/`](../openspec/changes/archive/2026-05-03-reorganize-folder-structure/).
- 2026-05-02 bootstrap-data-and-tests — capability criada: env validado por Zod, split server/client, ESLint guard contra `process.env` direto, Pino com redaction, Supabase helpers para os 3 contextos.
