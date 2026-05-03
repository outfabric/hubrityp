# authentication

## Resumo

Define a superfície pública de auth do HubrityP: a página `/login`, as Server Actions `signIn` e `signOut`, o middleware raiz que faz auth gating de rotas autenticadas, e os validators compartilhados (`loginInputSchema`, `mapSupabaseUser`, `safeRedirect`) que fluem o payload entre form, action e páginas consumidoras. Após o refactor estrutural, todo o domínio de auth vive em `src/modules/auth/` e os route shells em `src/app/(auth)/login/` e `src/app/(app)/` apenas delegam.

## Onde mora o código

- **Módulo auth** (`src/modules/auth/`):
  - `src/modules/auth/index.ts` — barrel público (re-exporta `LoginForm`, `signIn`, `signOut`, `loginInputSchema`, `mapSupabaseUser`, `safeRedirect`, e tipos).
  - `src/modules/auth/components/login-form.tsx` — `<LoginForm/>` Client Component (React Hook Form + Zod resolver).
  - `src/modules/auth/server/login.ts` — `signInImpl(formData)`: validação Zod, `supabase.auth.signInWithPassword`, `safeRedirect`, `redirect`. Sem `'use server'` no topo (vive no shell).
  - `src/modules/auth/server/logout.ts` — `signOutImpl()`: `supabase.auth.signOut`, `redirect('/login')`.
  - `src/modules/auth/lib/login-input-schema.ts` — `loginInputSchema` (Zod) + tipo `LoginInput`.
  - `src/modules/auth/lib/map-supabase-user.ts` — `mapSupabaseUser(user)` → `{ id, email } | null`.
  - `src/modules/auth/lib/safe-redirect.ts` — valida `redirectTo` (rejeita off-origin, fallback para default).
- **Route shells** (`src/app/`):
  - `src/app/(auth)/login/page.tsx` — Server Component que importa `<LoginForm/>` de `@/modules/auth`.
  - `src/app/(auth)/login/actions.ts` — `'use server'` shell que re-exporta `signIn` (wrapper async fino sobre `signInImpl`).
  - `src/app/(app)/actions.ts` — `'use server'` shell que re-exporta `signOut` (wrapper sobre `signOutImpl`).
  - `src/app/(auth)/layout.tsx` — layout centrado minimalista para a área pública.
- **Middleware**:
  - `src/middleware.ts` — gating de `/dashboard*` (anônimo → 307 `/login?redirectTo=...`) e `/login` (autenticado → 307 `/dashboard`). Refresh de cookie via `@/shared/supabase/middleware`.
- **Supabase clients**: `src/shared/supabase/{server,client,middleware}.ts` (consumidos pelas implementações server e pelo middleware).

## Superfície pública

- **Rotas HTTP**:
  - `GET /login` — renderiza o form (anônimo) ou redireciona para `/dashboard` (autenticado).
  - `POST /login` (Server Action `signIn`) — autentica e redireciona; nunca lança através da fronteira.
  - `POST /` (Server Action `signOut`) — limpa cookies e redireciona para `/login`.
- **Imports server-side** (outros shells, testes server, futuras capabilities):
  ```ts
  import { signIn, signOut, LoginForm, loginInputSchema, mapSupabaseUser } from '@/modules/auth';
  ```
- **Imports client-side** (Client Components que precisam invocar `signIn`):
  ```ts
  import { signIn } from '@/app/(auth)/login/actions';
  ```
  **Nunca** importe `signIn`/`signOut` do barrel `@/modules/auth` em `'use client'` — arrasta `server-only` para o bundle.
- **Resultado tipado** de `signIn`:
  ```ts
  type SignInResult = { ok: true } | { ok: false; error: 'invalid_credentials' | 'unknown' };
  ```
- **Test ids do form** (para Playwright/RTL): `login-form-email`, `login-form-password`, `login-form-submit`, `login-form-error`.

## Comportamento e invariantes

- **Validação Zod antes do Supabase**: payloads malformados (email inválido, senha < 8 chars) retornam `invalid_credentials` sem chamar a rede. Isso impede um atacante de distinguir "email válido + senha errada" de "email malformado" pelo response.
- **Action nunca lança através da fronteira**: erros inesperados (network, Supabase 5xx) viram `{ ok: false, error: 'unknown' }`. Apenas a chamada Supabase é envolvida em `try/catch` — `redirect()` lança `NEXT_REDIRECT` que DEVE propagar para o Next.
- **`redirectTo` validado por `safeRedirect`**: valores não same-origin são ignorados; fallback é `/dashboard`. O valor é lido do `FormData` (não de headers/query) para amarrá-lo ao form submetido.
- **Logger redacta credenciais**: `email`, `password`, `token`, `jwt` estão na allow-list de redaction do Pino logger (`src/shared/lib/logger.ts`). Erros de auth logam apenas `errorName`, nunca o payload.
- **Middleware preserva cookies em redirect**: `buildRedirect` transplanta `Set-Cookie` headers do response original (do refresh do Supabase) para o redirect 307; senão uma rotação de token no `getUser()` seria silenciosamente perdida.
- **307, não 302**: middleware usa `NextResponse.redirect(url, 307)` para preservar o método (POST → POST), não demote para GET.
- **Logout sem JS**: o botão de logout é um `<form action={signOut}>` real — funciona com JavaScript desabilitado. O Server Action roda no servidor, limpa cookies, e o navegador segue o redirect.
- **`'use server'` mora no shell**: módulo `server/login.ts` é regular; marcar como `'use server'` quebraria os exports não-async do barrel (`loginInputSchema`, etc.).
- **Client Component importa do route shell, não do barrel**: `LoginForm` faz `import { signIn } from '@/app/(auth)/login/actions'`. Importar do barrel `@/modules/auth` em Client Component arrasta o chain `server-only` (logger, Supabase server client) para o bundle do browser e o RSC boundary checker rejeita o build.
- **LGPD**: nunca logar email/senha; o logger já redacta, mas a action também garante que mensagens de log usem `errorName` em vez de `error.message`.

## Testes

- **Unit** (`src/__tests__/unit/modules/auth/`):
  - `lib/login-input-schema.test.ts` — aceita input válido, rejeita campos vazios, rejeita senha curta.
  - `lib/map-supabase-user.test.ts` — mapeia user populado, retorna `null` para `null`/`undefined`.
  - `lib/safe-redirect.test.ts` — valida same-origin, rejeita absolute external, faz fallback.
  - `components/login-form.test.tsx` — renderiza fields/test-ids, exibe erros server-side via `initialState`, esconde erro server quando há erro de field.
- **Integration** (`src/__tests__/integration/`):
  - `auth-signin.int.test.ts` — `signInImpl` contra Postgres real + mock Supabase Auth (sucesso, credenciais inválidas, erro inesperado).
  - `auth-signout.int.test.ts` — `signOutImpl` (limpa cookies, redireciona).
  - `middleware.int.test.ts` — auth gating em todas as combinações (anônimo/autenticado × `/login` / `/dashboard*` / pública).
- **E2E (seeded)** (`src/__tests__/e2e/seeded/auth.spec.ts`, tag `@auth`) — fluxo simulado via `storageState` + mock GoTrue.
- **E2E (real)** (`src/__tests__/e2e/real/auth.spec.ts`, tag `@auth-real`) — handshake completo contra `supabase start`: login → dashboard → logout → login.

## Histórico de changes

- 2026-05-03 reorganize-folder-structure — split shell↔module: `signIn`/`signOut` extraídos de `app/(auth)/login/actions.ts` e `app/(app)/actions.ts` para `src/modules/auth/server/{login,logout}.ts` como `signInImpl`/`signOutImpl`. Helpers (`login-input-schema`, `map-supabase-user`, `safe-redirect`) movidos para `src/modules/auth/lib/`. `LoginForm` movido para `src/modules/auth/components/`. Barrel público em `src/modules/auth/index.ts`. Supabase clients consumidos de `@/shared/supabase/server`. Veja [`../openspec/changes/archive/2026-05-03-reorganize-folder-structure/`](../openspec/changes/archive/2026-05-03-reorganize-folder-structure/).
- 2026-05-02 smoke-health-feature — capability criada: `/login` page, `signIn`/`signOut` Server Actions, `loginInputSchema`, `mapSupabaseUser`, middleware auth gating, suite `@auth-real` em paralelo.
