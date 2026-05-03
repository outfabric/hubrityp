# app-shell

## Resumo

Define a base do Next.js App Router do HubrityP: a aplicação roda sob `src/app/`, com layout raiz em pt-BR + Inter via `next/font`, headers de segurança configurados em `next.config.ts`, Tailwind/shadcn configurados com aliases apontando para `src/shared/`, e o middleware raiz em `src/middleware.ts`. Node 22 LTS é fixado por `.nvmrc` + `engines.node`.

## Onde mora o código

- `src/app/layout.tsx` — root layout com `<html lang="pt-BR">`, Inter via `next/font/google`, metadata base.
- `src/app/page.tsx` — placeholder em `/`.
- `src/app/globals.css` — Tailwind base + tokens.
- `src/middleware.ts` — middleware raiz (auth gating + cookie refresh via `@/shared/supabase/middleware`).
- `next.config.ts` — security headers (`headers()`), `outputFileTracingExcludes: { '/**': ['**/__tests__/**'] }`, `reactStrictMode: true`. Auto-detecção de `src/app/` (sem config explícita).
- `tailwind.config.ts`, `postcss.config.mjs`, `components.json` — Tailwind + shadcn. Aliases shadcn apontam para `@/shared/ui` e `@/shared/lib/utils`.
- `src/shared/ui/` — primitives shadcn instalados (`button`, `card`, `input`, `label`).
- `src/shared/lib/utils.ts` — `cn()` (clsx + tailwind-merge).
- `tsconfig.json` — `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, alias `@/*` → `./src/*`.
- `.nvmrc` — Node 22 LTS.
- `package.json` `engines.node` — `>=22 <23`.

## Superfície pública

- **Rotas HTTP**: `/` (placeholder), além das rotas providas por outras capabilities (`/login`, `/dashboard`, `/api/health`, `/api/me`).
- **Path alias**: `@/*` → `./src/*` (uniforme para `@/app/*`, `@/modules/*`, `@/shared/*`, `@/__tests__/*`).
- **Aliases shadcn** (`components.json`): `aliases.components = "@/shared/ui"`, `aliases.utils = "@/shared/lib/utils"`. Rodar `npx shadcn add <primitive>` deposita o arquivo em `src/shared/ui/<primitive>.tsx`.
- **Env vars (build/runtime)**: ver capability `env-and-logging`.

## Comportamento e invariantes

- **Locale `pt-BR`** no `<html>` raiz — toda página do produto herda. A copy do produto também é pt-BR (ver design system).
- **Inter via `next/font`**: zero `@import url(...)` em CSS; fonts auto-hospedadas. Variável CSS `--font-sans` exposta no `<html>` para uso via classes Tailwind.
- **Security headers em toda rota** (configurados em `next.config.ts`):
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `Content-Security-Policy` baseline (`default-src 'self'`, com `'unsafe-inline'` permitido em script/style para hidratação Next).
- **`outputFileTracingExcludes`** garante que `src/__tests__/**` nunca entra no bundle de produção, mesmo que algum import inadvertido escape — defesa em profundidade.
- **App Router auto-detectado em `src/app/`** — não há `app/` na raiz do repo. Toda nova rota mora sob `src/app/<route>/`.
- **Middleware único** vive em `src/middleware.ts` (não na raiz). Matcher exclui `_next/static`, `_next/image`, `favicon.ico` e assets estáticos para evitar overhead de cookie-set em chunks.
- **Server Components por default**: marcar `'use client'` apenas nas folhas que precisam de hooks/eventos/APIs do browser.

## Testes

- **Integration** (smoke):
  - `src/__tests__/integration/middleware.int.test.ts` — valida o middleware contra um Next embedded (auth gating, redirect 307, cookie refresh).
- **E2E (seeded)**:
  - `src/__tests__/e2e/seeded/smoke.spec.ts` (`@health`) — bate em `/` e em `/api/health`, valida bootstrap completo (build + serve + Postgres + mock GoTrue).
- **E2E (real)**:
  - `src/__tests__/e2e/real/auth.spec.ts` (`@auth-real`) — valida HSTS/CSP indiretamente via fluxo real (ainda que os asserts foquem no fluxo de auth).
- **Unit**: o app-shell em si não tem unit test próprio — superfícies puras (`utils`, `logger`, env) ficam nas capabilities `developer-tooling` e `env-and-logging`.

## Histórico de changes

- 2026-05-03 reorganize-folder-structure — relocação de `app/` para `src/app/` e de `middleware.ts` para `src/middleware.ts`. `tsconfig.json` `@/*` agora resolve para `./src/*`. Aliases shadcn em `components.json` apontam para `@/shared/ui` e `@/shared/lib/utils`. `next.config.ts` ganhou `outputFileTracingExcludes` para `**/__tests__/**`. Veja [`../openspec/changes/archive/2026-05-03-reorganize-folder-structure/`](../openspec/changes/archive/2026-05-03-reorganize-folder-structure/).
