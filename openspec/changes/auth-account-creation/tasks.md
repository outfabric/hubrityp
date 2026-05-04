## 1. Design system foundation

- [x] 1.1 Adicionar todos os tokens de cor, tipografia, espaçamento, radius, shadow, durações e easing definidos em `docs/design-system/rules.md` como CSS custom properties em `src/app/globals.css`, escopados em `:root` e `[data-theme='dark']`
- [x] 1.2 Adicionar bloco `@media (prefers-reduced-motion: reduce)` em `src/app/globals.css` que zera animation/transition durations
- [x] 1.3 Reescrever `tailwind.config.ts` para mapear `theme.extend.colors` (background, surface.*, border.*, text.*, brand.50..900, success/warning/danger/info.{50,500,700}), `borderRadius`, `boxShadow`, `transitionDuration`, `fontFamily` para `var(--token)` conforme design system
- [x] 1.4 Configurar `darkMode: ['class', "[data-theme='dark']"]` no `tailwind.config.ts`
- [x] 1.5 Carregar Inter via `next/font/google` em `src/app/layout.tsx`, expor como `--font-sans`, aplicar no `<body>` via classe Tailwind
- [x] 1.6 Verificar via `next build` que não há requisição a `fonts.googleapis.com` (rede inspecionada via Playwright na e2e seeded)
- [x] 1.7 Instalar/verificar shadcn primitives: `button`, `input`, `label`, `form`, `checkbox`, `select`, `card`, `alert` em `src/shared/ui/` via `npx shadcn add` (consultar Context7 para a versão atual de cada componente)
- [x] 1.8 Auditar cada primitive em `src/shared/ui/` para remover qualquer cor hardcoded, substituindo por classes Tailwind backed nos tokens
- [x] 1.9 Confirmar que `Button` e `Input` mantêm a mesma assinatura de props pós-mudança para não quebrar `app/(auth)/login/login-form.tsx`

## 2. Database schema, migration, RLS e triggers

- [x] 2.1 Criar pasta `src/shared/db/schema/auth/` com `tables.ts`, `policies.ts`
- [x] 2.2 Definir em `tables.ts` os Drizzle schemas `profiles`, `authLogs`, `authSessions` com todas as colunas, constraints e indexes especificados em `specs/data-layer/spec.md`
- [x] 2.3 Adicionar exports de `profiles`, `authLogs`, `authSessions` em `src/shared/db/schema/index.ts`
- [x] 2.4 Em `policies.ts`, declarar SQL puro de `ENABLE ROW LEVEL SECURITY` e as policies (`profiles_select_own`, `profiles_update_own`, `auth_logs_select_own`, `auth_sessions_select_own`)
- [x] 2.5 Escrever SQL da função `public.handle_new_user()` SECURITY DEFINER que lê `raw_user_meta_data`, faz INSERT em `profiles` com `status='pending_verification'`, `email = NEW.email`, e levanta exception em metadata faltando
- [x] 2.6 Escrever SQL do trigger `AFTER INSERT ON auth.users FOR EACH ROW EXECUTE handle_new_user()`
- [x] 2.7 Escrever SQL da função `public.handle_email_confirmed()` que detecta transição `email_confirmed_at NULL → NOT NULL` e atualiza `profiles.status = 'pending_crp_validation'` + `profiles.emailVerifiedAt = NEW.email_confirmed_at`, idempotente
- [x] 2.8 Escrever SQL do trigger `AFTER UPDATE OF email_confirmed_at ON auth.users FOR EACH ROW EXECUTE handle_email_confirmed()`
- [x] 2.9 Rodar `npm run db:generate` e mesclar manualmente o SQL de RLS + triggers no arquivo gerado `src/shared/db/migrations/0001_account_registration.sql`
- [x] 2.10 Aplicar localmente via `supabase db reset` + `npm run db:migrate` para validar a migration ponta-a-ponta
- [x] 2.11 Atualizar `src/shared/db/migrations/README.md` com a entrada da nova migration

## 3. Validators puros (registration/lib)

- [x] 3.1 Criar `src/modules/registration/lib/uf-table.ts` exportando os 27 UFs e o map `regionalCodeToUf` derivado do Apêndice A do PRD
- [x] 3.2 Criar `src/modules/registration/lib/password-validators.ts` com `passwordPolicy(s): { ok; missing }` e o tipo `PasswordRule`
- [x] 3.3 Criar `src/modules/registration/lib/crp-validators.ts` com `parseCrpNumber`, `isValidCrpFormat`, `isCrpRegionalConsistentWithUf`
- [x] 3.4 Criar `src/modules/registration/lib/profile-status.ts` exportando `ProfileStatus` enum e `canTransition(from, to): boolean`
- [x] 3.5 Criar `src/modules/registration/lib/signup-input-schema.ts` com `signupInputSchema` (Zod) integrando `passwordPolicy`, `isValidCrpFormat`, `isCrpRegionalConsistentWithUf`, e o set de UFs
- [x] 3.6 Exportar tipos `Profile` e `ProfileStatus` em `src/modules/registration/lib/profile.ts` (shape derivado do schema Drizzle)

## 4. Server-only — registration/server

- [x] 4.1 Criar `src/modules/registration/server/get-profile.ts` exportando `getCurrentProfile(supabase)` com 1 SELECT por chamada via Drizzle, retornando `null` quando não há sessão ou linha
- [x] 4.2 Criar `src/modules/registration/server/sign-up.ts` exportando `signUpImpl(formData)` que: parseia com `signupInputSchema`, chama `supabase.auth.signUp` com `emailRedirectTo` montado a partir de `headers().get('origin')`, mapeia erros para `invalid_input`/`duplicate_email`/`duplicate_crp`/`unknown`, faz rollback via `supabase.auth.admin.deleteUser` em duplicate CRP, loga em `auth_logs` via service-role client e redireciona para `/onboarding/pending`
- [x] 4.3 Criar `src/modules/registration/server/resend-verification.ts` com `resendVerificationEmailImpl()` que valida `profile.status === 'pending_verification'`, chama `supabase.auth.resend({ type: 'signup' })`, mapeia rate-limit para `{ ok: false, error: 'rate_limited' }`
- [x] 4.4 Criar helper `src/modules/registration/server/log-auth-event.ts` (não exposto no barrel) que insere em `auth_logs` via service-role client e capta IP/UA do request

## 5. Components — registration/components

- [x] 5.1 Criar `src/modules/registration/components/signup-form.tsx` (`'use client'`) com react-hook-form + zodResolver(`signupInputSchema`), feedback inline em blur (não onChange) por campo, lista de critérios de senha em tempo real
- [x] 5.2 Aplicar `data-testid` em todos os campos, checkboxes, submit e região de erro conforme `specs/account-registration/spec.md`
- [x] 5.3 Criar `src/modules/registration/components/onboarding-pending-card.tsx` (Server Component que renderiza variações condicionais por `status` e embute o botão de resend como Client Component leaf)
- [x] 5.4 Criar `src/modules/registration/components/resend-verification-button.tsx` (`'use client'`) com cooldown visual de 60s pós-click bem-sucedido (`disabled` + texto "Reenviar (NNs)")
- [x] 5.5 Criar `src/modules/registration/components/auth-callback-error.tsx` para a tela de erro do callback com botão de resend

## 6. Module barrel + route shells

- [x] 6.1 Criar `src/modules/registration/index.ts` exportando `signUp`, `resendVerificationEmail`, `getCurrentProfile`, `signupInputSchema`, `passwordPolicy`, `SignupForm`, `OnboardingPendingCard`, `Profile`, `ProfileStatus` (sem `'use server'`)
- [x] 6.2 Criar `src/app/(auth)/signup/page.tsx` (Server Component) que importa e renderiza `<SignupForm/>` de `@/modules/registration`
- [x] 6.3 Criar `src/app/(auth)/signup/actions.ts` com `'use server'` re-exportando `signUp` como wrapper de `@/modules/registration`
- [x] 6.4 Criar `src/app/(auth)/auth/callback/route.ts` com handler GET que chama `exchangeCodeForSession`, loga `email_verified`, redireciona para `/onboarding/pending`, e renderiza error UI em token inválido/expirado/ausente
- [x] 6.5 Criar `src/app/(app)/onboarding/pending/page.tsx` que carrega `getCurrentProfile`, redireciona para `/dashboard` se `active`, e renderiza `<OnboardingPendingCard status={...} email={...}/>`
- [x] 6.6 Criar `src/app/(app)/onboarding/pending/actions.ts` com `'use server'` re-exportando `resendVerificationEmail`

## 7. Auth module: signIn status-aware

- [x] 7.1 Atualizar `src/modules/auth/server/login.ts` (`signInImpl`) para, após `signInWithPassword` bem-sucedido, chamar `getCurrentProfile` e ramificar redirect: `active` → `/dashboard` (ou `redirectTo` válido), `pending_*` → `/onboarding/pending`, `suspended|cancelled` → `signOut` + retornar `{ ok: false, error: 'account_unavailable' }`
- [x] 7.2 Acrescentar caso `'account_unavailable'` ao tipo `SignInResult` e ao mapeamento de erros do `LoginForm`
- [x] 7.3 Atualizar copy do `LoginForm` para renderizar mensagem pt-BR específica para `account_unavailable`

## 8. Middleware status-aware

- [x] 8.1 Atualizar `src/middleware.ts` para chamar `getCurrentProfile` após `getUser`
- [x] 8.2 Implementar a tabela de decisão path × status conforme `specs/authentication/spec.md`, retornando 307 nos redirects e `NextResponse.next()` (com cookie refresh) nos passes
- [x] 8.3 Garantir que `/auth/callback` está no matcher e nunca é redirecionado
- [x] 8.4 Adicionar telemetria mínima (pino logger) com `path`, `status`, `decision` para debug local

## 9. Dashboard greeting

- [x] 9.1 Atualizar `src/app/(app)/dashboard/page.tsx` para carregar `profile = await getCurrentProfile(...)` e exibir `Olá, {profile.fullName}` no `data-testid="dashboard-greeting"` (mantendo o testid existente)

## 10. Documentação

- [ ] 10.1 Adicionar seção "Wave-4 IDs (auth-account-creation)" em `docs/design-system/testid.md` com todos os novos `data-testid` (signup-form-*, onboarding-pending-*, auth-callback-*) e os arquivos onde vivem
- [ ] 10.2 Atualizar `CLAUDE.md` (seção "Estrutura de pastas") se a árvore de `src/modules/registration/` ou `src/shared/db/schema/auth/` exigir nota explícita

## 11. Testes unitários

- [ ] 11.1 `src/__tests__/unit/registration/uf-table.test.ts` — 27 UFs, presença, `regionalCodeToUf` íntegro
- [ ] 11.2 `src/__tests__/unit/registration/password-validators.test.ts` — happy + cada classe (length, uppercase, lowercase, digit, special) isolada e combinada
- [ ] 11.3 `src/__tests__/unit/registration/crp-validators.test.ts` — formato válido/inválido + coerência com UF (Apêndice A)
- [ ] 11.4 `src/__tests__/unit/registration/profile-status.test.ts` — todas as transições válidas e inválidas
- [ ] 11.5 `src/__tests__/unit/registration/signup-input-schema.test.ts` — todos os cenários de aceitação/rejeição enumerados em `specs/account-registration/spec.md`

## 12. Testes de integração

- [ ] 12.1 Helper `src/__tests__/integration/registration/helpers/markCrpValidated.ts` que UPDATE `profiles.status = 'active'` via Drizzle (uso só em testes)
- [ ] 12.2 Factory `src/__tests__/integration/registration/factories/signup-input.ts` para gerar payloads válidos/variantes
- [ ] 12.3 `src/__tests__/integration/registration/sign-up.int.test.ts` — happy path cria `auth.users` + `profiles` + log; duplicate email; duplicate CRP rolla back o auth.user; trigger metadata-faltando aborta a transação
- [ ] 12.4 `src/__tests__/integration/registration/email-verified-trigger.int.test.ts` — UPDATE `auth.users.email_confirmed_at` transita status; idempotente para `active`
- [ ] 12.5 `src/__tests__/integration/registration/rls-profiles.int.test.ts` — userA não SELECT/UPDATE profile do userB; INSERT direto bloqueado para usuário; service role bypass
- [ ] 12.6 `src/__tests__/integration/registration/rls-auth-logs.int.test.ts` — userA só lê próprios logs; INSERT direto bloqueado
- [ ] 12.7 `src/__tests__/integration/registration/get-current-profile.int.test.ts` — retorna typed profile, `null` sem sessão, `null` com profile inexistente, garante 1 SELECT (assert via `pg_stat_statements` ou contagem de queries via mock)
- [ ] 12.8 `src/__tests__/integration/registration/middleware-status-gating.int.test.ts` — combinatória path × status conforme tabela de decisão (no mínimo: anonymous→`/dashboard`→307 login, pending→`/dashboard`→307 onboarding, active→`/login`→307 dashboard, suspended→qualquer path→307 login, callback sempre passa)
- [ ] 12.9 `src/__tests__/integration/registration/sign-in-status-aware.int.test.ts` — login com pending leva a `/onboarding/pending`; com suspended retorna `account_unavailable` e clear cookies

## 13. Testes E2E seeded

- [ ] 13.1 Fixture Playwright que extrai o link de verificação do inbucket local (`http://localhost:54324`) por email
- [ ] 13.2 `src/__tests__/e2e/seeded/registration/signup-happy-path.spec.ts` — preenche form com payload válido, submete, lê inbucket, abre o link, cai em `/onboarding/pending` com mensagem de CRP em validação; tentativa de visitar `/dashboard` redireciona
- [ ] 13.3 `src/__tests__/e2e/seeded/registration/signup-validation-errors.spec.ts` — erros aparecem em blur (não onChange); senha sem maiúscula/dígito/especial mostra critérios faltantes; aceites obrigatórios bloqueiam submit
- [ ] 13.4 `src/__tests__/e2e/seeded/registration/duplicate-email.spec.ts` — segundo signup com mesmo email mostra erro pt-BR
- [ ] 13.5 `src/__tests__/e2e/seeded/registration/duplicate-crp.spec.ts` — segundo signup com mesmo CRP/UF mostra erro pt-BR e não cria auth.user órfão
- [ ] 13.6 `src/__tests__/e2e/seeded/registration/onboarding-pending-resend.spec.ts` — botão "Reenviar email" funciona; segundo click dentro do cooldown mostra mensagem de rate-limited
- [ ] 13.7 `src/__tests__/e2e/seeded/registration/dark-mode-substrate.spec.ts` — `document.documentElement.dataset.theme = 'dark'` flipa tokens, sem requisição a `fonts.googleapis.com` em todo o fluxo
- [ ] 13.8 Atualizar `playwright.seeded.config.ts` se necessário para incluir o novo subdir de specs

## 14. Validação final

- [ ] 14.5 `openspec validate auth-account-creation` retorna OK
