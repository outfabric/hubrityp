# CLAUDE.md

## About the project

Web SaaS for Brazilian autonomous psychologists (in-office, online, or hybrid). Centralizes administrative and clinical tasks that are today scattered across Google Calendar, WhatsApp, Word, Excel, and manual PIX.

## Project folder structure

```
src/
  app/                                     # Next.js App Router (routes, layouts, route handlers)
    (auth)/login/                          # public routes — thin shells that delegate to modules
    (auth)/signup/                         # /signup shell (delegated to the registration module)
    (auth)/auth/callback/                  # OAuth / email-verification callback shell
    (app)/dashboard/                       # authenticated app shell
    (app)/onboarding/pending/              # post-signup shell (pending_verification / pending_crp_validation)
    api/                                   # Route Handlers (e.g., /api/health, /api/me)
  middleware.ts                            # edge middleware (auth + profile-status gating)
  modules/<domain>/                        # code by domain, one folder per capability
    auth/
      components/                          # client/server components of the module
      server/                              # Server Action implementations (no `'use server'`)
      lib/                                 # validators, mappers, branded types
      index.ts                             # module PUBLIC API
    registration/                          # psychologist signup + verification + profile status
      components/                          # signup-form, onboarding-pending-card, auth-callback-error, resend-verification-button
      server/                              # sign-up, resend-verification, get-profile (plus edge variant)
      lib/                                 # signup-input-schema (Zod), crp/password validators, profile-status, uf-table
      edge.ts                              # edge-safe PUBLIC API (consumed by the middleware)
      index.ts                             # module PUBLIC API
    health/
  shared/                                  # cross-module concerns (do not depend on modules/)
    ui/                                    # shadcn/ui primitives (was components/ui)
    lib/                                   # utils, logger
    env/                                   # Zod-validated env (server + client splits)
    supabase/                              # Supabase clients (browser, server, middleware)
    db/                                    # Drizzle: client.ts + schema/ + migrations/
      schema/auth/                         # auth.profiles tables + RLS policies (mirrors Supabase `auth` schema)
  __tests__/                               # ALL tests live here (centralized)
    unit/                                  # Vitest unit (mirrors the src/ tree)
    integration/                           # Vitest + Testcontainers (*.int.test.ts)
      setup/, factories/
    e2e/
      _shared/postgres-container.ts        # boot module SHARED between integration and seeded e2e
      seeded/                              # Playwright + mock GoTrue + Testcontainers
      real/                                # Playwright against `supabase start`
    stubs/                                 # no-ops (e.g., server-only)
scripts/
  db-migrate.ts                            # CLI used by `npm run db:migrate`
docs/                                      # human docs (includes docs/prd/)
openspec/                                  # OpenSpec change tracker (active + archived)
playwright.seeded.config.ts                # default e2e suite
playwright.real.config.ts                  # @auth-real suite
vitest.config.ts                           # unit
vitest.integration.config.ts               # integration
```

## Architecture diagram

```
                       ┌────────────────────────────────────┐
                       │              USERS                 │
                       │  Psychologist (web/mobile browser) │
                       │  Patient (browser, WhatsApp)       │
                       └─────────────┬──────────────────────┘
                                     │ HTTPS (TLS 1.3)
                                     ▼
            ┌────────────────────────────────────────────────────┐
            │         VERCEL (Frontend + API Routes)             │
            │                                                    │
            │  ┌─────────────────┐    ┌─────────────────────┐    │
            │  │   Next.js App   │    │  Next.js API Routes │    │
            │  │   (RSC + CSR)   │    │  + Server Actions   │    │
            │  │                 │    │                     │    │
            │  │  - Pages        │    │  - CRUD             │    │
            │  │  - Components   │    │  - Auth             │    │
            │  │  - shadcn/ui    │    │  - Webhooks (recv)  │    │
            │  └─────────────────┘    └──────────┬──────────┘    │
            └─────────────────────────────────────┼──────────────┘
                                                  │
              ┌───────────────────────────────────┼───────────────────────────┐
              │                                   │                           │
              ▼                                   ▼                           ▼
    ┌─────────────────────┐          ┌─────────────────────┐       ┌──────────────────┐
    │     SUPABASE        │          │       INNGEST       │       │   External APIs  │
    │   (sa-east-1)       │          │   (Jobs + Cron)     │       │                  │
    │                     │          │                     │       │  - Twilio (WA)   │
    │  ┌──────────────┐   │          │  - WhatsApp sends   │       │  - Google Gemini │
    │  │ Postgres 15  │   │          │  - Gemini transc.   │       │                  │
    │  │ (RLS active) │   │          │  - Receita Saúde    │       │  - Stream.io     │
    │  └──────────────┘   │          │  - Batch PDF        │       │  - Asaas         │
    │  ┌──────────────┐   │          │  - Backups          │       │  - e-CAC         │
    │  │  Auth        │   │          │  - Anonymization    │       │                  │
    │  │  - JWT       │   │          │  - Cron reminders   │       │                  │
    │  │  - OAuth     │   │          │  - Reconciliation   │       │  - Receita Fed.  │
    │  └──────────────┘   │          │                     │       │                  │
    │  ┌──────────────┐   │          │      Free Plan      │       │  Webhooks back   │
    │  │  Storage     │   │          └──────────┬──────────┘       │  to Vercel       │
    │  │  (S3-compat) │   │                     │                  └──────────────────┘
    │  └──────────────┘   │                     │
    │  ┌──────────────┐   │                     │
    │  │  Realtime    │◄──┼─────────────────────┘   (push updates to frontend
    │  │  (WebSocket) │   │                          when a job finishes)
    │  └──────────────┘   │
    └─────────────────────┘

```

## Running locally

Always use **Docker Compose** to bring the application up locally (Next.js + local Supabase + dependencies). Do not run `npm run dev` directly against production/staging Supabase.

```bash
docker compose up        # bring everything up
docker compose down      # tear everything down
```

## Automated tests

1. **Unit tests** — pure logic, validators, helpers, hooks.
2. **Integration tests** — Server Actions, API Routes, Supabase queries (against local Supabase via Docker).
3. **E2E tests** — for critical UI flows (Playwright). Critical flows include: signup/login, patient creation, prescription generation, medical record, etc.

Tests should cover behavior, not implementation. If something blocks the test (e.g., external integration without a sandbox), state it explicitly instead of silently skipping.

## Mandatory standards

- **Pre-commit**: Husky + lint-staged already run lint/format/type-check on staged files. Do not use `--no-verify`.
- **Documentation lookups for libraries/frameworks/SDKs/CLIs/services go through the Context7 MCP.** Whenever you need to verify the API, syntax, configuration, version migration, setup, or behavior of a tool/library/package (Next.js, Supabase, Drizzle, shadcn/ui, Inngest, Tailwind, Zod, Twilio, Asaas, etc.), invoke `mcp__context7__resolve-library-id` followed by `mcp__context7__query-docs` before writing or recommending code — even for libraries that feel familiar, since training-data knowledge can be out of date. Prefer Context7 over web search for documentation.
