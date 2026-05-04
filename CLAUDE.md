# CLAUDE.md

## Sobre o projeto

SaaS web para psicólogos autônomos brasileiros (consultório, online ou híbrido). Centraliza tarefas administrativas e clínicas hoje espalhadas em Google Agenda, WhatsApp, Word, Excel e PIX manual.

## Estrutura de pastas do projeto

```
src/
  app/                                     # Next.js App Router (rotas, layouts, route handlers)
    (auth)/login/                          # rotas públicas — shells finos que delegam para módulos
    (auth)/signup/                         # shell de /signup (delegado ao módulo registration)
    (auth)/auth/callback/                  # shell do callback OAuth/verificação de email
    (app)/dashboard/                       # shell autenticado da app
    (app)/onboarding/pending/              # shell pós-signup (pending_verification / pending_crp_validation)
    api/                                   # Route Handlers (ex.: /api/health, /api/me)
  middleware.ts                            # edge middleware (gating de auth + status do profile)
  modules/<dominio>/                       # código por domínio, uma pasta por capability
    auth/
      components/                          # componentes (client/server) do módulo
      server/                              # implementação das Server Actions (sem `'use server'`)
      lib/                                 # validators, mappers, branded types
      index.ts                             # API PÚBLICA do módulo
    registration/                          # cadastro de psicólogo + verificação + status do profile
      components/                          # signup-form, onboarding-pending-card, auth-callback-error, resend-verification-button
      server/                              # sign-up, resend-verification, get-profile (e variante edge)
      lib/                                 # signup-input-schema (Zod), crp/password validators, profile-status, uf-table
      edge.ts                              # API PÚBLICA edge-safe (consumida pelo middleware)
      index.ts                             # API PÚBLICA do módulo
    health/
  shared/                                  # concerns cross-módulo (não depende de modules/)
    ui/                                    # primitivos shadcn/ui (era components/ui)
    lib/                                   # utils, logger
    env/                                   # env validado por Zod (server + client splits)
    supabase/                              # clientes Supabase (browser, server, middleware)
    db/                                    # Drizzle: client.ts + schema/ + migrations/
      schema/auth/                         # tabelas auth.profiles + RLS policies (espelha schema `auth` do Supabase)
  __tests__/                               # TODOS os testes vivem aqui (centralizados)
    unit/                                  # Vitest unit (espelha a árvore de src/)
    integration/                           # Vitest + Testcontainers (*.int.test.ts)
      setup/, factories/
    e2e/
      _shared/postgres-container.ts        # módulo de boot COMPARTILHADO entre integration e seeded e2e
      seeded/                              # Playwright + mock GoTrue + Testcontainers
      real/                                # Playwright contra `supabase start`
    stubs/                                 # no-ops (ex.: server-only)
scripts/
  db-migrate.ts                            # CLI usado por `npm run db:migrate`
docs/                                      # docs humanas (inclui docs/prd/)
openspec/                                  # tracker de changes OpenSpec (ativas + arquivadas)
playwright.seeded.config.ts                # suíte e2e default
playwright.real.config.ts                  # suíte @auth-real
vitest.config.ts                           # unit
vitest.integration.config.ts               # integration
```

## Diagrama de arquitetura

```
                        ┌──────────────────────────────────┐
                        │         USUÁRIOS                 │
                        │  Psicólogo (web/mobile browser)  │
                        │  Paciente (browser, WhatsApp)    │
                        └────────────┬─────────────────────┘
                                     │ HTTPS (TLS 1.3)
                                     ▼
            ┌────────────────────────────────────────────────────┐
            │         VERCEL (Frontend + API Routes)             │
            │                                                    │
            │  ┌─────────────────┐    ┌─────────────────────┐    │
            │  │   Next.js App   │    │  Next.js API Routes │    │
            │  │   (RSC + CSR)   │    │  + Server Actions   │    │
            │  │                 │    │                     │    │
            │  │  - Páginas      │    │  - CRUD             │    │
            │  │  - Componentes  │    │  - Auth             │    │
            │  │  - shadcn/ui    │    │  - Webhooks (recv)  │    │
            │  └─────────────────┘    └──────────┬──────────┘    │
            └─────────────────────────────────────┼──────────────┘
                                                  │
              ┌───────────────────────────────────┼───────────────────────────┐
              │                                   │                           │
              ▼                                   ▼                           ▼
    ┌─────────────────────┐          ┌─────────────────────┐       ┌──────────────────┐
    │     SUPABASE        │          │       INNGEST       │       │   APIs Externas  │
    │   (sa-east-1)       │          │   (Jobs + Cron)     │       │                  │
    │                     │          │                     │       │  - Twilio (WA)   │
    │  ┌──────────────┐   │          │  - WhatsApp envios  │       │  - Google Gemini │
    │  │ Postgres 15  │   │          │  - Gemini transc.   │       │                  │
    │  │ (RLS ativo)  │   │          │  - Receita Saúde    │       │  - Stream.io     │
    │  └──────────────┘   │          │  - PDF em lote      │       │  - Asaas         │
    │  ┌──────────────┐   │          │  - Backups          │       │  - e-CAC         │
    │  │  Auth        │   │          │  - Anonimização     │       │                  │
    │  │  - JWT       │   │          │  - Lembretes cron   │       │                  │
    │  │  - OAuth     │   │          │  - Reconciliação    │       │  - Receita Fed.  │
    │  └──────────────┘   │          │                     │       │                  │
    │  ┌──────────────┐   │          │      Plano Free     │       │  Webhooks volta  │
    │  │  Storage     │   │          └──────────┬──────────┘       │  para Vercel     │
    │  │  (S3-compat) │   │                     │                  └──────────────────┘
    │  └──────────────┘   │                     │
    │  ┌──────────────┐   │                     │
    │  │  Realtime    │◄──┼─────────────────────┘
    │  │  (WebSocket) │   │   (push de updates ao frontend
    │  └──────────────┘   │    quando job termina)
    └─────────────────────┘

```

## Rodando localmente

Sempre use **Docker Compose** para subir a aplicação localmente (Next.js + Supabase local + dependências). Não rodar `npm run dev` direto contra Supabase de produção/staging.

```bash
docker compose up        # subir tudo
docker compose down      # derrubar
```

## Testes automatizados

1. **Testes unitários** — lógica pura, validators, helpers, hooks.
2. **Testes de integração** — Server Actions, API Routes, queries Supabase (contra Supabase local via Docker).
3. **Testes E2E** — para fluxos críticos de UI (Playwright). Fluxos críticos incluem: cadastro/login, criação de paciente, geração de receita, prontuário etc.

Os testes devem cobrir comportamento, não implementação.

## Padrões obrigatórios

- **Pre-commit**: Husky + lint-staged já rodam lint/format/type-check em arquivos staged. Não use `--no-verify`.
- **Consultas a docs de libs/frameworks/SDKs/CLIs/serviços usam o MCP Context7.** Sempre que precisar verificar API, sintaxe, configuração, migração de versão, setup ou comportamento de uma ferramenta/lib/pacote (Next.js, Supabase, Drizzle, shadcn/ui, Inngest, Tailwind, Zod, Twilio, Asaas, etc.), invoque `mcp__context7__resolve-library-id` seguido de `mcp__context7__query-docs` antes de escrever ou recomendar código — mesmo para libs que parecem familiares, já que o conhecimento de treinamento pode estar desatualizado. Prefira Context7 a web search para documentação.
