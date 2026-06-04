# CLAUDE.md

## About the project

Web SaaS for Brazilian autonomous psychologists (in-office, online, or hybrid). Centralizes administrative and clinical tasks that are today scattered across Google Calendar, WhatsApp, Word, Excel, and manual PIX.

## Project folder structure

The codebase is organized in five top-level concerns inside `src/`: **routes** (`app/`), **edge middleware** (`middleware.ts`), **domain code** (`modules/`), **cross-cutting infrastructure** (`shared/`), and **tests** (`__tests__/`). Below the tree, the [Conventions](#folder-conventions) section spells out the rules that the tree alone cannot express (module barrels, edge-safe entrypoints, route gating, test layering, etc.).

> The tree shows the **current** layout. When you add a new module, a new route group, or a new schema folder, update this section in the same PR — drift here makes the project harder to navigate for everyone.

```text
hubrityp/
├── src/
│   ├── app/                            # Next.js App Router — routes, layouts, Route Handlers
│   │   ├── (auth)/                     # public auth flows — login, signup, forgot/reset-password,
│   │   │                               #   auth/callback (OAuth + email verify), auth/link-account
│   │   ├── (app)/                      # authenticated app — dashboard, agenda, pacientes,
│   │   │                               #   caixa-de-entrada, configuracoes/*, onboarding/*
│   │   ├── api/                        # Route Handlers — health, me, inngest, webhooks/twilio
│   │   ├── confirmar-sessao/[token]/   # patient confirmation link (public, token-gated)
│   │   ├── termo/[token]/              # patient consent term (public, token-gated)
│   │   ├── layout.tsx
│   │   └── page.tsx
│   │
│   ├── middleware.ts                   # Edge: cookie refresh + auth/status gating
│   │                                   #   (see decision table at top of the file)
│   │
│   ├── modules/                        # Domain code — one folder per capability
│   │   ├── agenda/                     # calendar + scheduling
│   │   ├── ai-transcription/           # AI-powered session transcription (Gemini)
│   │   │   ├── lib/                    # branded types, Zod schemas, pseudonymization, logger
│   │   │   ├── server/                 # Server Action implementations
│   │   │   ├── edge.ts                 # edge-safe PUBLIC API
│   │   │   └── index.ts                # module PUBLIC API (barrel)
│   │   ├── auth/                       # session, sign-in, sign-out
│   │   ├── dashboard/                  # operational home — aggregate read queries
│   │   │   ├── lib/                    # São Paulo time windows + result types
│   │   │   ├── server/                 # owner-scoped read helpers (today/pendências/weekly/has-data)
│   │   │   └── index.ts                # module PUBLIC API (barrel)
│   │   ├── health/                     # liveness/readiness helpers
│   │   ├── notifications/              # transactional notifications (server-only)
│   │   ├── nps/                        # NPS survey — Zod schema + eligibility,
│   │   │   ├── inngest/                #   submit Server Action, detractor email event
│   │   │   ├── lib/                    # npsAnswerSchema (reused from onboarding) + helpers
│   │   │   ├── server/                 # submitNpsImpl
│   │   │   └── index.ts                # module PUBLIC API (barrel)
│   │   ├── oauth/                      # OAuth provider linking
│   │   ├── password-recovery/          # forgot/reset password flow
│   │   ├── patients/                   # patient CRUD + import
│   │   ├── registration/               # signup + CRP validation + profile status
│   │   │   ├── components/
│   │   │   ├── lib/                    # Zod schemas, validators, branded types
│   │   │   ├── server/                 # Server Action implementations
│   │   │   ├── edge.ts                 # edge-safe PUBLIC API (used by middleware.ts)
│   │   │   └── index.ts                # module PUBLIC API (barrel)
│   │   ├── sessions/                   # clinical session records
│   │   └── whatsapp/                   # WhatsApp inbox + reminders (Twilio)
│   │       ├── components/{,inbox/}
│   │       ├── inngest/inbox/          # queued jobs owned by the module
│   │       ├── lib/{,inbox/,reminders/}
│   │       └── server/{,adapters/,inbox/,reminders/}
│   │
│   ├── shared/                         # Cross-module infra — MUST NOT import from modules/
│   │   ├── db/
│   │   │   ├── client.ts               # Drizzle Postgres client
│   │   │   ├── schema/                 # one folder per domain (agenda, ai-transcription, auth, health,
│   │   │   │                           #   notifications, patients, whatsapp) — each with tables.ts + policies.ts +
│   │   │   │                           #   index.ts; schema/index.ts re-exports the union
│   │   │   └── migrations/{,meta/}     # drizzle-kit output
│   │   ├── env/                        # Zod-validated env: index.ts (server), client.ts, schemas.ts
│   │   ├── lib/                        # logger, edge-logger, hash-email, utils, cookies/, mail/
│   │   ├── supabase/                   # Supabase clients (browser, server, middleware)
│   │   └── ui/                         # shadcn/ui primitives
│   │
│   └── __tests__/                      # ALL tests centralized here
│       ├── unit/                       # Vitest — mirrors src/ (modules/, shared/, app/, e2e/)
│       ├── integration/                # Vitest + Testcontainers (*.int.test.ts)
│       │   ├── setup/, factories/      # shared helpers
│       │   └── <domain>/               # agenda, auth-hardening, data-layer, middleware, oauth,
│       │                               #   password-recovery, patients, registration, sessions,
│       │                               #   whatsapp, ...
│       ├── e2e/
│       │   ├── _shared/postgres-container.ts   # boot module shared with integration suite
│       │   ├── seeded/                 # Playwright + mock GoTrue + Testcontainers (default suite)
│       │   └── real/                   # Playwright against `supabase start` (@auth-real)
│       └── stubs/                      # no-ops (e.g., server-only)
│
├── scripts/db-migrate.ts               # CLI used by `npm run db:migrate`
├── docs/                               # human docs — prd/, runbooks/, design-system/, app/auth flows
├── openspec/                           # OpenSpec change tracker (active changes + archived specs)
│
├── next.config.ts                      # Next.js config + security headers
├── drizzle.config.ts                   # Drizzle Kit config
├── tailwind.config.ts                  # Tailwind config
├── eslint.config.mjs                   # ESLint flat config (forbids direct process.env access)
├── tsconfig.json
├── components.json                     # shadcn/ui config
├── playwright.seeded.config.ts         # default e2e suite
├── playwright.real.config.ts           # @auth-real suite
├── vitest.config.ts                    # unit
└── vitest.integration.config.ts        # integration
```

### Folder conventions

These conventions matter as much as the tree itself. Violating them tends to produce subtle bugs (edge runtime crashes, broken auth gating, RLS leaks, circular imports) — read before adding a new file outside an existing pattern.

1. **Module shape.** A module under `src/modules/<domain>/` exposes its public surface via `index.ts` (a barrel) and keeps internals in `components/`, `lib/` (Zod schemas, validators, branded types, mappers), and `server/` (Server Action implementations — no `'use server'` directives on these files; the directive belongs at the call site). Variants seen in the repo: `health/` is barrel-only; `notifications/` is server-only; `ai-transcription/` exposes `lib/` (branded types, Zod schemas, pseudonymization helper) and `server/`; `whatsapp/` adds an `inngest/` folder for queued jobs and splits `server/` into `adapters/`, `inbox/`, `reminders/`.

2. **Module public API.** External consumers import **only** from `@/modules/<domain>`, never from internal paths like `@/modules/<domain>/server/...`. The barrel is what we promise to keep stable; everything else is private.

3. **Edge entrypoint (`edge.ts`).** A module that is consumed by `src/middleware.ts` (which runs on the Edge runtime) MUST expose an `edge.ts` that avoids Node-only deps. `postgres-js` pulls `node:crypto` and crashes the Edge worker at module-evaluation time — that is why `modules/registration/edge.ts` exists and the middleware imports from `@/modules/registration/edge`, not `@/modules/registration`. Apply the same pattern to any new module the middleware needs.

4. **Route groups vs. auth gating.** The folder names `(auth)` and `(app)` are **organizational only** — Next.js strips them from the URL. Auth gating is decided by `src/middleware.ts:classifyPath()` based on the URL prefix, not the folder. Today the classifier treats only `/dashboard*` as the `'app'` (gated) class; routes inside `(app)/agenda`, `(app)/pacientes`, `(app)/caixa-de-entrada`, `(app)/configuracoes` rely on the middleware being extended for those prefixes. When adding a new authenticated route, update `classifyPath()` in the same PR and add a negative-auth test.

5. **Schema-per-domain.** Every domain that owns tables has its own folder under `src/shared/db/schema/<domain>/` with three files: `tables.ts` (Drizzle table definitions), `policies.ts` (RLS policies as Drizzle SQL helpers), and `index.ts` (the domain barrel). The top-level `schema/index.ts` re-exports the union. Adding a table without enabling RLS + writing per-operation policies in the same PR is a bug.

6. **`shared/` is downstream of `modules/`.** Files in `src/shared/**` must not import from `src/modules/**` — the dependency arrow goes one way. If you find yourself needing to, extract the dependency into `shared/` instead.

7. **Env access is funneled.** Direct `process.env.*` access is blocked by ESLint outside `src/shared/env/**` and a small allowlist (`drizzle.config.ts`, `scripts/db-migrate.ts`, `src/shared/env/client.ts`, test setups). Import `serverEnv` / `clientEnv` from `@/shared/env` everywhere else.

8. **Tests mirror sources.** Under `src/__tests__/`:
   - `unit/<path>` mirrors `src/<path>` (so `unit/modules/agenda/...` tests `src/modules/agenda/...`).
   - `integration/<domain>/` groups by feature (one folder per module or cross-cutting concern: `data-layer/`, `middleware/`, `auth-hardening/`).
   - `e2e/seeded/<feature>/` is the default Playwright suite (Testcontainers + mock GoTrue); `e2e/real/` runs against `supabase start` for auth-critical paths only.
   - `e2e/_shared/postgres-container.ts` is shared between integration and seeded e2e — do not duplicate boot logic.

9. **Top-level configs.** Test runners and tooling are pinned at the repo root (`vitest.config.ts`, `vitest.integration.config.ts`, `playwright.seeded.config.ts`, `playwright.real.config.ts`, `next.config.ts`, `drizzle.config.ts`, `tailwind.config.ts`, `eslint.config.mjs`, `components.json`). Do not create per-module configs; extend the root ones.

10. **`docs/` vs. `openspec/`.** `docs/` is for stable, human-maintained references (PRDs, runbooks, design system, architectural notes). `openspec/` is the change tracker: `openspec/changes/<name>/` for in-flight work, `openspec/specs/` for archived specs. Anything ephemeral or change-scoped goes in `openspec/`.

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
