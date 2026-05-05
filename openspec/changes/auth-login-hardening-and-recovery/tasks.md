## 1. Database schema, RLS e função SQL

- [x] 1.1 Adicionar em `src/shared/db/schema/auth/tables.ts` as colunas novas em `profiles`: `failed_login_count`, `last_failed_login_at`, `lockout_until`, `consecutive_lockouts`, `requires_password_reset`
- [x] 1.2 Definir em `src/shared/db/schema/auth/tables.ts` a tabela `oauthIdentities` com PK uuid, FK `user_id`, `provider`, `provider_user_id`, `is_primary`, `linked_at`, `UNIQUE(provider, provider_user_id)`, index em `user_id`
- [x] 1.3 Adicionar export de `oauthIdentities` em `src/shared/db/schema/index.ts`
- [x] 1.4 Atualizar `src/shared/db/schema/auth/policies.ts` com `ENABLE ROW LEVEL SECURITY` em `oauth_identities` + policy `oauth_identities_select_own`
- [x] 1.5 Reescrever a função SQL `public.handle_new_user()` para branch por `NEW.raw_app_meta_data ->> 'provider'`: email/NULL → INSERT como antes; outros provedores → `RETURN NEW` sem inserir
- [x] 1.6 Escrever função SQL `public.purge_old_auth_logs()` SECURITY DEFINER que deleta `auth_logs` com `created_at < NOW() - INTERVAL '6 months'` e retorna count
- [x] 1.7 Rodar `npm run db:generate` e mesclar manualmente no arquivo `src/shared/db/migrations/0002_login_hardening.sql`: ALTERs de `profiles`, índice parcial `profiles_lockout_until_idx WHERE lockout_until IS NOT NULL`, CREATE TABLE `oauth_identities`, RLS, redefinição de `handle_new_user()` (REPLACE), CREATE FUNCTION `purge_old_auth_logs()`
- [x] 1.8 Aplicar `supabase db reset` + `npm run db:migrate` para validar a migration ponta-a-ponta
- [x] 1.9 Atualizar `src/shared/db/migrations/README.md` com a entrada da migration 0002 e o bloco de comentário documentando o set canônico de `auth_logs.event` (incluindo eventos novos: `login_*`, `lockout_*`, `password_reset_*`, `oauth_signup`, `social_linked`, `logout`)
- [x] 1.10 Teste de integração `src/__tests__/integration/oauth/handle-new-user-trigger.int.test.ts` — INSERT em `auth.users` com `provider='google'` não cria profile; com `provider='email'` cria como antes; provider NULL trata como email
- [x] 1.11 Teste de integração `src/__tests__/integration/data-layer/purge-old-auth-logs.int.test.ts` — com 10 logs >6 meses + 5 recentes, função retorna 10 e mantém só os recentes; tabela vazia retorna 0; usuário comum não pode chamar
- [x] 1.12 Teste de integração `src/__tests__/integration/oauth/rls-oauth-identities.int.test.ts` — userA não vê identities do userB; INSERT direto bloqueado para usuário; service role bypass

## 2. Validators puros

- [ ] 2.1 Criar `src/modules/password-recovery/lib/forgot-password-input-schema.ts` com Zod schema `{ email: emailRfc }`
- [ ] 2.2 Criar `src/modules/password-recovery/lib/reset-password-input-schema.ts` reusando `passwordPolicy` do `@/modules/registration` + confirmação igual
- [ ] 2.3 Criar `src/modules/oauth/lib/complete-profile-input-schema.ts` reusando validadores de CRP/UF/aceites/nome do `@/modules/registration` (sem email/senha — sessão já existe)
- [ ] 2.4 Criar `src/modules/oauth/lib/link-account-input-schema.ts` com `{ password: z.string().min(1), pendingUserId: z.string().uuid() }`
- [ ] 2.5 Criar `src/modules/oauth/lib/oauth-providers.ts` exportando o set válido (`['google'] as const`) e tipos
- [ ] 2.6 Atualizar `src/modules/auth/lib/login-input-schema.ts` para incluir `keepLoggedIn: z.boolean().default(false)` e tipos derivados
- [ ] 2.7 Teste unitário `src/__tests__/unit/password-recovery/forgot-password-input-schema.test.ts` — happy + email malformado
- [ ] 2.8 Teste unitário `src/__tests__/unit/password-recovery/reset-password-input-schema.test.ts` — happy + cada classe de erro de senha + mismatch
- [ ] 2.9 Teste unitário `src/__tests__/unit/oauth/complete-profile-input-schema.test.ts` — reuso dos validadores de CRP/UF/aceites
- [ ] 2.10 Teste unitário `src/__tests__/unit/oauth/link-account-input-schema.test.ts` — uuid válido + senha presente
- [ ] 2.11 Teste unitário `src/__tests__/unit/auth/login-input-schema.test.ts` — atualizar para incluir `keepLoggedIn` default e rejeição de não-boolean

## 3. Cookie sidecar e wrapper de Supabase

- [ ] 3.1 Estender `src/shared/supabase/server.ts` (`createServerClient`) para ler o cookie `hp_keep_logged_in` no request e aplicar `Max-Age = 86400` ou omitir nos cookies Supabase ao escrevê-los
- [ ] 3.2 Adicionar helper `src/shared/lib/cookies/keep-logged-in.ts` com `setKeepLoggedInCookie(response, value: boolean)` e `clearKeepLoggedInCookie(response)`
- [ ] 3.3 Teste de integração `src/__tests__/integration/auth-hardening/keep-logged-in-cookie.int.test.ts` — `keepLoggedIn=true` produz Max-Age=86400 nos cookies; false produz session cookies; logout limpa

## 4. Resend helper

- [ ] 4.1 Criar `src/shared/lib/mail/resend.ts` com função `sendEmailViaResend({ to, from, subject, html, text })` usando `fetch` para `https://api.resend.com/emails`, headers de auth via `process.env.RESEND_API_KEY`
- [ ] 4.2 Criar `src/shared/lib/mail/send-password-changed.ts` que renderiza template pt-BR ("Sua senha foi alterada") e chama `sendEmailViaResend`; em dev sem `RESEND_API_KEY`, loga warning via pino e retorna `{ ok: true, skipped: true }`
- [ ] 4.3 Criar `src/shared/lib/mail/send-account-locked.ts` (mesmo padrão) com template "Sua conta foi temporariamente bloqueada"
- [ ] 4.4 Adicionar `RESEND_API_KEY` ao schema `src/shared/env/schemas.ts` como string opcional, documentar em `.env.local.example`

## 5. Lockout state machine

- [ ] 5.1 Criar `src/modules/auth/server/lockout.ts` (não exposto no barrel) com função `applyFailedLoginAttempt(supabase, userId): Promise<{ failedLoginCount, lockoutUntil, requiresPasswordReset, lockoutJustStarted }>` executando o UPDATE atômico documentado em `design.md` D2 e retornando o estado pós-update
- [ ] 5.2 Em `src/modules/auth/server/lockout.ts`, expor `resetLoginCounters(supabase, userId)` que zera `failed_login_count`, `consecutive_lockouts`, `lockout_until` (chamado em login bem-sucedido)
- [ ] 5.3 Em `src/modules/auth/server/lockout.ts`, expor `isCurrentlyLockedOut(profile): { lockedOut: boolean; until?: Date }` (helper puro)
- [ ] 5.4 Teste de integração `src/__tests__/integration/auth-hardening/lockout-atomic.int.test.ts` — 10 attempts paralelos contra mesmo user; assert `failed_login_count = 5` exatamente, lockout disparado uma única vez, log `lockout_started` único
- [ ] 5.5 Teste de integração `src/__tests__/integration/auth-hardening/lockout-window.int.test.ts` — falha 4x, espera 16 min (mock NOW), falha 1x → não bloqueia (counter resetou); falha 5x dentro de 15 min → bloqueia
- [ ] 5.6 Teste de integração `src/__tests__/integration/auth-hardening/lockout-consecutive.int.test.ts` — 3 lockouts consecutivos setam `requires_password_reset=true`; reset do lockout via reset de senha zera tudo

## 6. Auth module — signIn e signOut

- [ ] 6.1 Reescrever `src/modules/auth/server/login.ts` (`signInImpl`) para: parsear `loginInputSchema` com `keepLoggedIn`; lookup profile pelo email; se `lockout_until > NOW()` → retornar `locked_out`; se `requires_password_reset` → retornar `requires_password_reset` (após sign-in succeed e signOut); chamar `signInWithPassword`; em sucesso, executar status-aware redirect existente + `setKeepLoggedInCookie` + `resetLoginCounters` + log `login_success`; em falha, `applyFailedLoginAttempt` (se profile existe) + dummy bcrypt-compare (se não existe) + log `login_failure` + retornar `invalid_credentials` ou `locked_out` se a UPDATE atômica acabou de bloquear
- [ ] 6.2 Em `signInImpl`, ao detectar `lockoutJustStarted`, disparar `sendAccountLockedEmail` best-effort (failure não derruba ação)
- [ ] 6.3 Atualizar `src/modules/auth/lib/sign-in-result.ts` (criar se não existir) para o tipo de erro estendido: `'invalid_credentials' | 'locked_out' | 'requires_password_reset' | 'account_unavailable' | 'unknown'`, com `lockoutUntil?: string` em `locked_out`
- [ ] 6.4 Reescrever `src/modules/auth/server/logout.ts` (`signOutImpl`) para chamar `supabase.auth.signOut({ scope: 'global' })`, UPDATE em `auth_sessions.revokedAt`, `clearKeepLoggedInCookie`, log `logout`, redirect `/login` (sem propagar exception se Supabase falhar — best-effort)
- [ ] 6.5 Teste unitário `src/__tests__/unit/auth/sign-in-result.test.ts` — todos os 5 tipos de erro renderizam copy correta no helper de mapeamento
- [ ] 6.6 Teste de integração `src/__tests__/integration/auth-hardening/anti-enumeration.int.test.ts` — 100 attempts mistos (50 emails reais, 50 inexistentes); assert `median(real) - median(fake) < 50ms`
- [ ] 6.7 Teste de integração `src/__tests__/integration/auth-hardening/sign-in-status-aware.int.test.ts` — atualizar para cobrir `locked_out`, `requires_password_reset`, `account_unavailable`
- [ ] 6.8 Teste de integração `src/__tests__/integration/auth-hardening/sign-out-global.int.test.ts` — após `signOut`, `auth_sessions.revokedAt` populated; segundo request com refresh token antigo é rejeitado por Supabase
- [ ] 6.9 Teste de integração `src/__tests__/integration/data-layer/auth-logs-events-canonical.int.test.ts` — sentinel test que grep no source por strings passadas a `logAuthEvent` e valida set canônico
- [ ] 6.10 Teste E2E `src/__tests__/e2e/seeded/auth-hardening/lockout.spec.ts` — 5 logins falhos seguidos disparam lockout UI + e-mail no inbucket; 6º attempt mostra `locked_out`
- [ ] 6.11 Teste E2E `src/__tests__/e2e/seeded/auth-hardening/keep-logged-in.spec.ts` — checkbox marcado mantém sessão após reabrir browser context (Playwright storageState); não marcado, sessão é descartada
- [ ] 6.12 Teste E2E `src/__tests__/e2e/seeded/auth-hardening/logout-global.spec.ts` — duas pages com mesma sessão; logout em A faz B receber 307 para login no próximo request

## 7. Password-recovery module

- [ ] 7.1 Criar `src/modules/password-recovery/server/request-password-reset.ts` (`requestPasswordResetImpl`) com lookup de profile, anti-enumeração (Supabase reset chamado só se profile existe; dummy delay no path negativo via `await sleep(50 + crypto.randomInt(0, 100))`), log uniforme `password_reset_requested`, retorno único `{ ok: true }`
- [ ] 7.2 Criar `src/modules/password-recovery/server/reset-password.ts` (`resetPasswordImpl`) com validação Zod, `supabase.auth.updateUser({ password })`, `supabase.auth.admin.signOut(userId, 'global')`, UPDATE em `profiles` resetando lockout state, `sendPasswordChangedEmail` best-effort, log `password_reset_completed`, redirect `/login?banner=password_changed`
- [ ] 7.3 Criar `src/modules/password-recovery/components/forgot-password-form.tsx` (`'use client'`) com react-hook-form + Zod, `data-testid` correspondentes
- [ ] 7.4 Criar `src/modules/password-recovery/components/reset-password-form.tsx` (`'use client'`) com lista de critérios em tempo real (reusa `passwordPolicy`), `data-testid`s
- [ ] 7.5 Criar `src/modules/password-recovery/index.ts` exportando: `requestPasswordReset`, `resetPassword`, `ForgotPasswordForm`, `ResetPasswordForm`, schemas
- [ ] 7.6 Teste de integração `src/__tests__/integration/password-recovery/request-password-reset.int.test.ts` — happy path chama Supabase resetPasswordForEmail; email inexistente noop com mesma resposta
- [ ] 7.7 Teste de integração `src/__tests__/integration/password-recovery/reset-password.int.test.ts` — atualiza senha; revoga todas sessões; reseta lockout state; sendPasswordChangedEmail invocado (mock); banner redirect; senha fraca rejeitada
- [ ] 7.8 Teste E2E `src/__tests__/e2e/seeded/password-recovery/forgot-and-reset.spec.ts` — fluxo completo: forgot → email no inbucket → click link → reset com senha forte → banner em /login → login com nova senha funciona
- [ ] 7.9 Teste E2E `src/__tests__/e2e/seeded/password-recovery/anti-enumeration.spec.ts` — UI mostra mesma copy para email existente e inexistente

## 8. OAuth module

- [ ] 8.1 Criar `src/modules/oauth/server/resolve-oauth-callback.ts` exportando `resolveOAuthCallback({ supabase, code, next })` que executa `exchangeCodeForSession` e retorna `{ destination: string }` aplicando a tabela de branching do `oauth-google` spec
- [ ] 8.2 Criar `src/modules/oauth/server/complete-oauth-profile.ts` (`completeOAuthProfileImpl`) com validação, INSERT em `profiles` (status `pending_crp_validation`, `email_verified_at = NOW()`) via service-role Drizzle, INSERT em `oauth_identities`, log `oauth_signup`, redirect `/onboarding/pending`
- [ ] 8.3 Criar `src/modules/oauth/server/link-oauth-identity.ts` (`linkOAuthIdentityImpl`) com confirmação de senha via cliente Supabase isolado (não toca cookies), `supabase.auth.admin.deleteUser` no pendingUserId, link via admin API, INSERT em `oauth_identities`, log `social_linked`, redirect `/login?banner=account_linked`
- [ ] 8.4 Criar `src/modules/oauth/components/google-button.tsx` (`'use client'`) que chama `supabase.auth.signInWithOAuth({ provider: 'google', ... })` no click, com `data-testid="login-form-google-button"`
- [ ] 8.5 Criar `src/modules/oauth/components/complete-profile-form.tsx` (`'use client'`) com email read-only e fullName pré-preenchido a partir de `user.user_metadata.full_name`
- [ ] 8.6 Criar `src/modules/oauth/components/link-account-form.tsx` (`'use client'`) com campo senha + submit, copy genérica em erro
- [ ] 8.7 Criar `src/modules/oauth/index.ts` exportando: `completeOAuthProfile`, `linkOAuthIdentity`, `resolveOAuthCallback`, `GoogleButton`, `CompleteProfileForm`, `LinkAccountForm`, schemas
- [ ] 8.8 Teste de integração `src/__tests__/integration/oauth/complete-oauth-profile.int.test.ts` — happy path (cria profile + identity, status `pending_crp_validation`); duplicate CRP retorna typed error
- [ ] 8.9 Teste de integração `src/__tests__/integration/oauth/link-oauth-identity.int.test.ts` — senha correta linka (deleta pendingUser, insere oauth_identity, redirect); senha incorreta retorna `invalid_credentials` e incrementa counter no user tradicional
- [ ] 8.10 **[e2e helper]** `src/__tests__/e2e/seeded/_shared/google-oauth-stub.ts` que via `page.route()` intercepta `accounts.google.com` e callback do Supabase, retornando code controlado e identity sintética
- [ ] 8.11 Teste E2E `src/__tests__/e2e/seeded/oauth/google-first-time.spec.ts` — stub retorna identity nova; UI redireciona para `/onboarding/complete-profile`; submit cria profile e identity; redirect `/onboarding/pending`
- [ ] 8.12 Teste E2E `src/__tests__/e2e/seeded/oauth/google-link-account.spec.ts` — pré-seed conta tradicional; stub retorna mesmo email; UI redireciona para `/auth/link-account`; senha correta linka; redirect `/login?banner=account_linked`
- [ ] 8.13 Teste E2E `src/__tests__/e2e/seeded/oauth/google-returning-active.spec.ts` — pré-seed user active com identity Google; stub retorna mesma identity; redirect direto `/dashboard`

## 9. LoginForm atualizado

- [ ] 9.1 Atualizar `src/modules/auth/components/login-form.tsx` para incluir checkbox "Manter conectado" (`data-testid="login-form-keep-logged-in"`) controlando `keepLoggedIn`
- [ ] 9.2 Adicionar import e render do `<GoogleButton/>` de `@/modules/oauth` abaixo do submit
- [ ] 9.3 Renderizar copies pt-BR específicas para os 5 erros: `invalid_credentials`, `locked_out` (com tempo restante computado de `lockoutUntil` + link para `/forgot-password`), `requires_password_reset` (link com email pré-preenchido), `account_unavailable`, `unknown`
- [ ] 9.4 Adicionar estado de banner em `/login` (query param `?banner=password_changed` ou `?banner=account_linked`) com `data-testid` correspondente

## 10. Route shells e páginas

- [ ] 10.1 Criar `src/app/(auth)/forgot-password/page.tsx` (Server Component) renderizando `<ForgotPasswordForm/>`
- [ ] 10.2 Criar `src/app/(auth)/forgot-password/actions.ts` com `'use server'` re-exportando `requestPasswordReset`
- [ ] 10.3 Criar `src/app/(auth)/reset-password/page.tsx` que verifica session de recovery; se ausente, renderiza error UI com link para `/forgot-password`; se presente, renderiza `<ResetPasswordForm/>`
- [ ] 10.4 Criar `src/app/(auth)/reset-password/actions.ts` com `'use server'` re-exportando `resetPassword`
- [ ] 10.5 Atualizar `src/app/(auth)/auth/callback/route.ts` para delegar a `resolveOAuthCallback` quando o código for OAuth (detectar via `next` query param ou via `session.user.app_metadata.provider != 'email'`); manter caminho atual de email-verification + recovery
- [ ] 10.6 Criar `src/app/(app)/onboarding/complete-profile/page.tsx` que carrega session, redireciona se já tem profile, renderiza `<CompleteProfileForm email={user.email} suggestedName={user.user_metadata.full_name}/>`
- [ ] 10.7 Criar `src/app/(app)/onboarding/complete-profile/actions.ts` com `'use server'` re-exportando `completeOAuthProfile`
- [ ] 10.8 Criar `src/app/(auth)/auth/link-account/page.tsx` que lê `pendingUserId` da query, valida que existe e renderiza `<LinkAccountForm/>`
- [ ] 10.9 Criar `src/app/(auth)/auth/link-account/actions.ts` com `'use server'` re-exportando `linkOAuthIdentity`
- [ ] 10.10 Atualizar `playwright.seeded.config.ts` se necessário para incluir os novos subdirs

## 11. Middleware atualizado

- [ ] 11.1 Atualizar `src/middleware.ts` para implementar a tabela de decisão completa: novos cases `requires_password_reset = true` (→ `/forgot-password`) e "session sem profile e provider != email" (→ `/onboarding/complete-profile`)
- [ ] 11.2 Garantir que `/forgot-password`, `/reset-password`, `/auth/link-account` estão no matcher
- [ ] 11.3 Helper `src/middleware.ts` (ou em `src/modules/auth/server/`) `hasOAuthIdentity(authUser): boolean` para distinguir "sem profile + OAuth" de "sem profile + race window de email signup"
- [ ] 11.4 Teste de integração `src/__tests__/integration/middleware/middleware-status-gating-v2.int.test.ts` — atualizar combinatória para incluir `requires_password_reset = true` e "OAuth sem profile"

## 12. Configuração Supabase OAuth + env

- [ ] 12.1 Atualizar `supabase/config.toml` para habilitar provider Google (`[auth.external.google]`) com `client_id` e `secret` lidos de env
- [ ] 12.2 Adicionar a `.env.local.example`: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `RESEND_API_KEY` (todos opcionais em dev)
- [ ] 12.3 Atualizar `src/shared/env/schemas.ts` (server) para incluir os 3 envs como `string().optional()`
- [ ] 12.4 Documentar em `docs/runbooks/google-oauth-setup.md` como obter credenciais (Google Cloud Console) e configurar callback URL local + prod (criar arquivo)

## 13. Documentação

- [ ] 13.1 Adicionar seção "Wave-5 IDs (auth-login-hardening-and-recovery)" em `docs/design-system/testid.md` com todos os novos testids: `login-form-keep-logged-in`, `login-form-google-button`, `forgot-password-form-*`, `reset-password-form-*`, `complete-profile-form-*`, `link-account-form-*`, `auth-callback-error`/`auth-callback-resend` (se introduzido novo)
- [ ] 13.2 Criar `docs/runbooks/oauth-smoke.md` com checklist manual para validar Google OAuth real (smoke pré-release; não automatizado)

## 14. Validação final

- [ ] 14.1 `openspec validate auth-login-hardening-and-recovery --strict` retorna OK
