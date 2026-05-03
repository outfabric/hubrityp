# dashboard-shell

## Resumo

Define o shell autenticado da aplicação: a página `/dashboard`, o controle de logout no header da `(app)` layout, a convenção de route groups (`(app)` autenticado vs `(auth)` público) e o esquema documentado de `data-testid` que toda feature futura herda.

## Onde mora o código

- **Páginas e layouts**:
  - `src/app/(app)/dashboard/page.tsx` — Server Component que lê o user via `@/shared/supabase/server` e `@/modules/auth.mapSupabaseUser`, renderiza `Olá, <email>` em um elemento com `data-testid="dashboard-greeting"`.
  - `src/app/(app)/layout.tsx` — shell autenticado com header HubrityP + form de logout (`<form action={signOut}>`, botão com `data-testid="dashboard-logout"`).
  - `src/app/(app)/actions.ts` — `'use server'` shell que re-exporta `signOut` (wrapper sobre `signOutImpl` de `@/modules/auth`).
  - `src/app/(auth)/layout.tsx` — layout público centrado (separação de superfícies).
- **Documentação de test ids**:
  - `docs/design-system/testid.md` — convenção `<surface>-<role>-<noun>` (kebab-case) e o catálogo de IDs em uso.
- **Auth gating**: feito pelo middleware (`src/middleware.ts`); a página `/dashboard` confia no middleware, mas defensivamente retorna `null` se `mapSupabaseUser` devolver `null`.

## Superfície pública

- **Rotas HTTP**:
  - `GET /dashboard` — Server Component autenticado.
  - `POST /` (Server Action `signOut` via `<form>`) — limpa cookies e redireciona para `/login`.
- **Test ids documentados em `docs/design-system/testid.md`**:
  - `dashboard-greeting` — span com saudação no `/dashboard`.
  - `dashboard-logout` — botão de sair no header.
  - (Login form ids ficam documentados pela capability `authentication`.)
- **Convenção de route groups**:
  - `(app)/` agrupa rotas autenticadas (gateadas pelo middleware). URLs ficam flat: `/dashboard`, não `/app/dashboard`.
  - `(auth)/` agrupa rotas anônimas (`/login`, futuro reset de senha). URL flat: `/login`.

## Comportamento e invariantes

- **Logout funciona sem JS**: o controle é um `<form action={signOut}>` real, não um botão que dispara via `fetch`. Submeter o form POSTa direto para o Server Action; o redirect rola server-side. Validado tanto pelo Playwright (`page.click`) quanto implicitamente pelo render SSR.
- **Logout delega ao módulo, não chama Supabase localmente**: a página `/dashboard` importa `signOut` do route shell `../actions` (que por sua vez chama `signOutImpl` de `@/modules/auth`). A page nunca importa `@/modules/auth/server/*` diretamente nem chama Supabase — separação de camadas.
- **Greeting espera middleware como gate autoritativo**: `DashboardPage` chama `createServerClient().auth.getUser()` e mapeia via `mapSupabaseUser`. Se o user for `null` (cenário de bypass do middleware), retorna `null` em vez de quebrar — defesa em profundidade.
- **Layouts isolam grupos**: novas páginas sob `src/app/(app)/<feature>/page.tsx` herdam automaticamente o header autenticado e o gating do middleware sem wiring extra. Novas páginas sob `src/app/(auth)/<feature>/page.tsx` herdam o layout centrado público.
- **`data-testid` é a única seleção estável** para Playwright + RTL. Asserts não devem depender de classnames Tailwind, texto não-pt-BR, ou estrutura interna do shadcn.
- **Convenção de naming**: `<surface>-<role>-<noun>` em kebab-case. Ex.: `dashboard-greeting`, `login-form-submit`. Documentar todo novo ID em `docs/design-system/testid.md` no mesmo PR que o introduz.

## Testes

- **Integration**:
  - `src/__tests__/integration/auth-signout.int.test.ts` — exercita `signOutImpl` (cobertura indireta do logout do dashboard).
  - `src/__tests__/integration/middleware.int.test.ts` — auth gating das rotas `(app)` (anônimo → 307 `/login?redirectTo=...`).
- **E2E (seeded)**:
  - `src/__tests__/e2e/seeded/auth.spec.ts` (`@auth`) — três cenários: anônimo `/dashboard` redireciona, dashboard renderiza com session, logout limpa cookies e redireciona para `/login`.
- **E2E (real)**:
  - `src/__tests__/e2e/real/auth.spec.ts` (`@auth-real`) — round-trip completo login → dashboard (asserta greeting com email seedado) → logout → de volta ao `/login`.
- **Unit**: o shell em si não tem unit test próprio (é puramente compositivo). Helpers consumidos (`mapSupabaseUser`) têm cobertura unit em `authentication`.

## Histórico de changes

- 2026-05-03 reorganize-folder-structure — relocação para `src/app/(app)/dashboard/` e `src/app/(app)/layout.tsx`. Logout passou a delegar ao route shell `src/app/(app)/actions.ts`, que chama `signOutImpl` de `@/modules/auth/server/logout`. A página `/dashboard` deixou de importar de `@/lib/supabase/*` — agora consome `@/shared/supabase/server`. `data-testid` convention movida para `docs/design-system/testid.md`. Veja [`../openspec/changes/archive/2026-05-03-reorganize-folder-structure/`](../openspec/changes/archive/2026-05-03-reorganize-folder-structure/).
- 2026-05-02 smoke-health-feature — capability criada: `/dashboard` com greeting + logout, route groups `(app)` e `(auth)`, convenção de `data-testid` documentada.
