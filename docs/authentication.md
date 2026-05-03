# authentication

## Resumo

Define a superfície pública de auth do HubrityP: as páginas `/login` e `/signup`, as Server Actions `signIn`, `signOut`, `signUp` e `resendVerificationEmail`, o middleware raiz que faz auth gating + status-aware routing, e o callback de verificação de email em `/auth/callback`. O signup captura simultaneamente os três consentimentos LGPD obrigatórios (Termos de Uso, Política de Privacidade, dados sensíveis) com timestamps e versões independentes. O login resolve o destino pós-autenticação a partir do status do psicólogo na máquina de estados de `account-lifecycle`. Após o split shell↔module, todo o domínio de auth vive em `src/modules/auth/` e os route shells em `src/app/(auth)/...` apenas delegam.

## Onde mora o código

- **Módulo auth** (`src/modules/auth/`):
  - `src/modules/auth/index.ts` — barrel público (re-exporta `LoginForm`, `SignupForm`, `signIn`, `signUp`, `signOut`, `resendVerificationEmail`, `loginInputSchema`, `signupInputSchema`, `mapSupabaseUser`, `safeRedirect`, `postLoginRedirect`, e tipos).
  - `src/modules/auth/components/login-form.tsx` — `<LoginForm/>` Client Component (RHF + Zod resolver, link "Criar conta" para `/signup`).
  - `src/modules/auth/components/signup-form.tsx` — `<SignupForm/>` Client Component com todos os campos do PRD-01 §5.1, três checkboxes de consentimento, render inline dos erros do Zod e dos field errors devolvidos pela action.
  - `src/modules/auth/server/login.ts` — `signInImpl(formData)`: validação Zod, `signInWithPassword`, status load via `getAccountStatus`, `postLoginRedirect`, `redirect`. Sem `'use server'` no topo.
  - `src/modules/auth/server/logout.ts` — `signOutImpl()`: limpa cookies e redireciona para `/login`.
  - `src/modules/auth/server/signup.ts` — `signUpImpl(input)`: validação, pre-flight CRP, `auth.signUp`, transação `psychologist_profiles` + `crp_validation_queue`, compensating-delete em caso de rollback.
  - `src/modules/auth/server/resend-verification.ts` — `resendVerificationEmailImpl()`: auth + status gate + rate limit 3-em-5min + `admin.auth.resend({ type: 'signup' })`.
  - `src/modules/auth/lib/login-input-schema.ts` — `loginInputSchema` (Zod).
  - `src/modules/auth/lib/signup-input-schema.ts` — `signupInputSchema` (Zod) com `superRefine` para classes de senha, `.refine` para confirmação, três `z.literal(true)` de consentimento, delegação de CRP/UF para `@/modules/crp-validation/lib/crp-format`.
  - `src/modules/auth/lib/post-login-redirect.ts` — `postLoginRedirect(status, requestedRedirect)`: pure function que mapeia `AccountStatus` → URL.
  - `src/modules/auth/lib/safe-redirect.ts` — valida `redirectTo` (rejeita off-origin, fallback default).
  - `src/modules/auth/lib/map-supabase-user.ts` — `mapSupabaseUser(user)` → `{ id, email } | null`.
- **Route shells** (`src/app/`):
  - `src/app/(auth)/login/{page,actions}.ts(x)` — render do `<LoginForm/>` + `'use server'` shell para `signIn`.
  - `src/app/(auth)/signup/{page,actions}.ts(x)` — render do `<SignupForm/>` + `'use server'` shell para `signUp`.
  - `src/app/(auth)/auth/verify-email/{page,actions}.ts(x)` — page shell que checa o status e redireciona quando aplicável + `'use server'` shells para `resendVerificationEmail` e `signOut`.
  - `src/app/(auth)/auth/crp-review/{page,actions}.ts(x)` — page shell + shell de `signOut`.
  - `src/app/auth/callback/route.ts` — `GET /auth/callback`: Route Handler que troca o `code` por sessão e dispara `applyTransition(..., 'email_verified')`. Vive FORA do route group `(auth)` para deixar explícito que não usa o layout do shell.
  - `src/app/(app)/actions.ts` — `'use server'` shell que re-exporta `signOut` do módulo (logout do dashboard).
- **Middleware**: `src/middleware.ts` — auth gating + status-aware routing + cookie-clear para terminais. Roda no runtime `nodejs` (Drizzle/postgres-js precisam de APIs do Node).
- **Schema de auth**:
  - `src/shared/db/schema/auth/auth-resend-log.ts` — tabela `auth_resend_log` (`id`, `user_id`, `sent_at`) com índice `(user_id, sent_at desc)` para a janela deslizante. RLS service-role-only.
- **Supabase clients**: `src/shared/supabase/{server,client,middleware,admin}.ts` — anon-key (server e client), middleware (com cookie refresh) e service-role admin.

## Superfície pública

- **Rotas HTTP**:
  - `GET /login` — render do form (anônimo) ou status-routed (autenticado, via middleware).
  - `POST /login` (Server Action `signIn`) — autentica, resolve status, redireciona; nunca lança através da fronteira.
  - `GET /signup` — render do form (anônimo); autenticado é status-routed pelo middleware.
  - `POST /signup` (Server Action `signUp`) — cria usuário Supabase + profile + queue numa transação; compensating-delete no rollback.
  - `POST /` (Server Action `signOut`) — limpa cookies e redireciona para `/login` (re-exportado do `(app)` shell e dos shells bloqueantes).
  - `GET /auth/callback?code=...` — handshake do email-confirmation flow do Supabase; idempotente.
- **Imports server-side** (route shells, outros módulos de servidor, testes server):
  ```ts
  import {
    signIn,
    signOut,
    signUp,
    resendVerificationEmail,
    LoginForm,
    SignupForm,
    loginInputSchema,
    signupInputSchema,
    mapSupabaseUser,
    safeRedirect,
    postLoginRedirect,
  } from '@/modules/auth';
  ```
- **Imports client-side** (Client Components que invocam Server Actions): importar do route shell, NUNCA do barrel:
  ```ts
  // login form:
  import { signIn } from '@/app/(auth)/login/actions';
  // signup form:
  import { signUp } from '@/app/(auth)/signup/actions';
  // verify-email page:
  import { resendVerificationEmail, signOut } from '@/app/(auth)/auth/verify-email/actions';
  ```
- **Resultados tipados** (todas Server Actions retornam discriminated unions sem `Error` para sobreviver à fronteira RPC):
  - `SignInResult = { ok: true } | { ok: false; error: 'invalid_credentials' | 'unknown' }`.
  - `SignUpResult = { ok: true; redirectTo: '/auth/verify-email' } | { ok: false; error: 'email_already_registered' | 'crp_already_registered' | 'validation_failed' | 'unknown'; fieldErrors? }`.
  - `ResendVerificationResult = { ok: true } | { ok: false; error: 'unauthenticated' | 'forbidden' | 'rate_limited' | 'unknown' }`.
- **Test ids do form** (Playwright/RTL):
  - Login: `login-form-email`, `login-form-password`, `login-form-submit`, `login-form-error`.
  - Signup: `signup-form-fullName`, `signup-form-email`, `signup-form-password`, `signup-form-passwordConfirm`, `signup-form-crpNumber`, `signup-form-crpUf`, `signup-form-acceptedTerms`, `signup-form-acceptedPrivacy`, `signup-form-acceptedSensitiveData`, `signup-form-submit`, `signup-form-error`.
- **Env vars consumidas** (via `serverEnv`/`clientEnv` em `src/shared/env/`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Apenas `URL` e `ANON_KEY` viajam ao cliente (`NEXT_PUBLIC_*`).

## Comportamento e invariantes

- **Validação Zod ANTES do Supabase em todas as actions.** Payloads malformados retornam erros tipados sem hitar a rede. Em `signIn`, malformado → mesmo `invalid_credentials` que credencial inválida (anti-enumeração de email).

- **Actions nunca lançam através da fronteira RPC.** Erros inesperados (network, Supabase 5xx, throw genérico) viram `{ ok: false, error: 'unknown' }`. APENAS a chamada Supabase (e a query DB nas que precisam) é envolvida em `try/catch` — `redirect()` lança `NEXT_REDIRECT` que DEVE propagar para o Next.

- **Senha — complexidade RF-01.04** (`signupInputSchema`): mínimo 10 caracteres + 4 classes (maiúscula, minúscula, dígito, especial dentre `!@#$%^&*()_+-=[]{}|;:,.<>?`). `superRefine` emite UM erro por classe faltando para que o usuário veja todos os requisitos não atendidos simultaneamente. `passwordConfirm` é validado no nível do object via `.refine`. Hashing é responsabilidade do Supabase Auth (Argon2id) — não há password handling em código de aplicação.

- **Email é lower-cased no schema boundary** (`signupInputSchema` aplica `.transform(value => value.toLowerCase())`). Persistência canonicalizada permite lookups case-insensitive sem `LOWER(...)` por toda parte.

- **Três consentimentos LGPD obrigatórios no signup**: `acceptedTerms`, `acceptedPrivacy`, `acceptedSensitiveData` são `z.literal(true)` — mensagens de erro distintas por checkbox. O signup persiste timestamps e versões independentes (`terms_accepted_at`/`terms_version`, `privacy_accepted_at`/`privacy_version`, `sensitive_data_consent_at`/`sensitive_data_consent_version`) com strings vindas de `documentVersions` (`@/modules/account-lifecycle`). Bumping uma versão no `documentVersions` é a única alteração necessária quando os documentos legais mudam.

- **Signup transacional + compensating-delete**: `signUpImpl` cria o usuário Supabase via `auth.signUp` (anon key, dispara o email de verificação automaticamente), e em seguida insere `psychologist_profiles` + `crp_validation_queue` numa única transação Drizzle. Falha pós-criação do usuário Supabase dispara `admin.deleteUser` para liberar o email para retry. Detecção da UNIQUE violation `(crp_number, crp_uf)` (SQLSTATE `23505`, lido tanto de `.code` quanto de `.cause.code`) mapeia para `crp_already_registered`.

- **Pre-flight de unicidade do CRP**: antes de criar o usuário Supabase, `signUpImpl` faz um SELECT em `psychologist_profiles` por `(crp_number, crp_uf)`. É racy — a UNIQUE no banco é a autoridade real — mas evita criar+deletar usuários Supabase no caso comum de duplicata.

- **Login status-aware** (`signInImpl`):
  - `active` → `redirectTo` recebido (validado por `safeRedirect`) ou `/dashboard`.
  - `pending_verification` → `/auth/verify-email`.
  - `pending_crp_validation` → `/auth/crp-review`.
  - `suspended` → `auth.signOut()` + `/login?reason=suspended`.
  - `cancelled` → `auth.signOut()` + `/login?reason=cancelled`.
  - Profile ausente → `auth.signOut()` + `unknown` (não deixa rota anônima ficar grudada num cookie órfão).
  - Lê `redirectTo` do `FormData` (não de header/query) para amarrá-lo ao form submetido.

- **Resend verification — rate limit cluster-safe**: `resendVerificationEmailImpl` aplica janela deslizante de 3 envios em 5 minutos por usuário, contando rows em `auth_resend_log` com `sent_at > now() - interval '5 minutes'`. O log persiste em Postgres (não memória) para sobreviver ao multi-instância da Vercel. Insert acontece APENAS no allow-path; rate-limited NÃO incrementa o contador. Status gate antes do rate limit: apenas `pending_verification` pode chamar.

- **Callback `/auth/callback` é idempotente**: re-clicar no link nunca regride o status. `applyTransition(..., 'email_verified')` retornando `invalid_transition` (status já avançado) é tratado como sucesso e o handler ainda redireciona para `/dashboard` — o middleware decide o destino real pelo status atual.

- **Middleware preserva cookies em redirect** (`buildRedirect`): transplanta `Set-Cookie` headers do response original (do refresh do Supabase) para o redirect 307. Sem isso uma rotação de token no `getUser()` seria silenciosamente perdida, fazendo o próximo request deslogar o usuário.

- **Middleware sempre passthrough em `/auth/callback`, `/api/*` e `/`** (`isAlwaysPassthrough`). Status routing acontece para todo o resto; runtime `nodejs` (não Edge) porque Drizzle + postgres-js dependem de APIs Node que Edge não expõe.

- **Cookie clear em status terminais**: middleware usa `buildClearCookiesRedirect` para `suspended`, `cancelled` e `status === null` (orphan session). Enumera cookies Supabase no request e emite `Max-Age=0` para cada um, sobrepondo qualquer cookie de rotação que o refresh tenha escrito durante `getUser()`.

- **307 Temporary Redirect, NÃO 302**: preserva o método (POST → POST). Demote para GET seria silencioso e quebraria forms que postam para rotas gated.

- **Logout sem JS**: o botão de logout é um `<form action={signOut}>` real — funciona com JavaScript desabilitado.

- **`'use server'` mora APENAS no shell.** Os módulos `server/*.ts` são módulos regulares (sem `'use server'` no topo). Marcar o barrel ou um `server/*.ts` como `'use server'` quebraria os exports não-async (`loginInputSchema`, `signupInputSchema`, `safeRedirect`, etc.) e arrastaria os helpers puros para o runtime do Server Action.

- **Client Component importa do route shell, não do barrel.** `<LoginForm/>` e `<SignupForm/>` importam `signIn`/`signUp` de `@/app/(auth)/{login,signup}/actions`. Importar do barrel arrasta o chain `'server-only'` (logger, Supabase server client, Drizzle) para o bundle do browser e o RSC boundary checker rejeita o build.

- **`signupInputSchema` importa de path interno do crp-validation** (`@/modules/crp-validation/lib/crp-format`, NÃO do barrel `@/modules/crp-validation`). Razão: o barrel re-exporta as Server Actions service-role (`approveCrpValidation`, `rejectCrpValidation`, ambas com `import 'server-only'`), e o signup form Client Component pulla esse schema transitivamente — passar pelo barrel arrastaria o chain `'server-only'` para o bundle.

- **Logger redacta credenciais**: `email`, `password`, `token`, `jwt` estão na allow-list de redaction do Pino logger (`src/shared/lib/logger.ts`). Erros logam `errorName`/`event`, nunca o payload.

- **LGPD**: nunca logar email/senha/PII; o logger já redacta, mas as actions também usam `errorName` em vez de `error.message`. Reason de rejeição de CRP NÃO é logado (texto livre admin).

## Testes

- **Unit** (`src/__tests__/unit/`):
  - `modules/auth/lib/login-input-schema.test.ts` — happy + rejeições.
  - `modules/auth/lib/signup-input-schema.test.ts` — todas as classes de senha, confirmação, três `literal(true)`, lower-case do email, delegação CRP/UF.
  - `modules/auth/lib/post-login-redirect.test.ts` — todos os cinco branches de status + safeRedirect interaction.
  - `modules/auth/components/login-form.test.tsx` — render, erros field/server, link "Criar conta".
  - `modules/auth/components/signup-form.test.tsx` — render de todos os fields + checkboxes, errors inline, field errors da action.
  - `shared/db/schema/auth/crp-validation-queue.test.ts` — schema shape + CHECK em `status`.
  - `shared/supabase/middleware.test.ts` — `clearSupabaseAuthCookies` enumera e emite deletes.
- **Integration** (`src/__tests__/integration/`):
  - `auth-signin.int.test.ts` — `signInImpl` happy + invalid + unknown + status-aware redirects (active/pending/suspended/cancelled/missing profile).
  - `auth-signout.int.test.ts` — `signOutImpl` (limpa cookies, redireciona).
  - `modules/auth/server/signup.int.test.ts` — happy path, duplicate email, duplicate CRP (race UNIQUE + pre-flight), compensating-delete em rollback, persistência dos três consentimentos com versões.
  - `modules/auth/server/resend-verification.int.test.ts` — auth gate, status gate (forbidden), rate limit 3-em-5min, log row inserted, Supabase resend chamado.
  - `auth/signup-route-shell.int.test.ts` — page shell + action shell + redirect pós-success.
  - `auth/verify-email-route-shell.int.test.ts` — page shell decide render vs redirect baseado em status.
  - `auth/crp-review-route-shell.int.test.ts` — analogous.
  - `auth/callback-route.int.test.ts` — exchange + transition + idempotência.
  - `middleware.int.test.ts` — auth gating básico (anônimo/autenticado × `/login` / `/dashboard*` / pública).
  - `middleware-status.int.test.ts` — matriz completa auth × status × path (incluindo cookie-clear em terminais).
- **E2E (seeded)** (`src/__tests__/e2e/seeded/`):
  - `auth.spec.ts` — login happy path (`@auth`).
  - `signup-happy-path.spec.ts` — formulário completo → `/auth/verify-email`.
  - `signup-duplicates.spec.ts` — duplicate email + duplicate CRP surface inline.
  - `signin-suspended.spec.ts` — login de usuário suspended/cancelled é deslogado e mostra reason banner.
  - `auth-verify-callback.spec.ts` — clique no link → exchange → transition → roteamento.
  - `middleware-routing.spec.ts` — combinações status × path no navegador.
  - `signup-smoke.spec.ts` — smoke do form rendering.
- **E2E (real)** (`src/__tests__/e2e/real/auth.spec.ts`, tag `@auth-real`) — handshake completo contra `supabase start`: login → dashboard → logout → login.

## Histórico de changes

- 2026-05-03 add-account-signup-and-lifecycle — capability expandida: signup completo (`signUp`, `<SignupForm/>`, `signupInputSchema` com complexidade RF-01.04), três consentimentos LGPD com versões independentes, `signIn` status-aware com `postLoginRedirect`, `resendVerificationEmail` com rate limit 3-em-5min via `auth_resend_log`, callback `/auth/callback` idempotente, middleware com routing por status (passthrough/bloqueante/cookie-clear). Veja [`../openspec/changes/archive/2026-05-03-add-account-signup-and-lifecycle/`](../openspec/changes/archive/2026-05-03-add-account-signup-and-lifecycle/).
- 2026-05-03 reorganize-folder-structure — split shell↔module: `signIn`/`signOut` extraídos de `app/(auth)/login/actions.ts` e `app/(app)/actions.ts` para `src/modules/auth/server/{login,logout}.ts` como `signInImpl`/`signOutImpl`. Helpers (`login-input-schema`, `map-supabase-user`, `safe-redirect`) movidos para `src/modules/auth/lib/`. `LoginForm` movido para `src/modules/auth/components/`. Barrel público em `src/modules/auth/index.ts`. Supabase clients consumidos de `@/shared/supabase/server`. Veja [`../openspec/changes/archive/2026-05-03-reorganize-folder-structure/`](../openspec/changes/archive/2026-05-03-reorganize-folder-structure/).
- 2026-05-02 smoke-health-feature — capability criada: `/login` page, `signIn`/`signOut` Server Actions, `loginInputSchema`, `mapSupabaseUser`, middleware auth gating, suite `@auth-real` em paralelo.
