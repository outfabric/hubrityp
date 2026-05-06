## Context

Após o `auth-account-creation`, o repositório terá: signup completo com CRP/UF/aceites, máquina de estados de conta, middleware status-aware, design system, RLS, trigger `handle_new_user()` que insere em `profiles` lendo `raw_user_meta_data`. Login segue o smoke atual (email + senha), sem lockout, sem "manter conectado", sem reset de senha, sem OAuth, sem revogação server-side de logout. Este change preenche o resto do PRD 01.

Restrições herdadas do change anterior:

- Trigger `handle_new_user()` é estrito: exige metadata. Para OAuth (sem metadata), precisa ser modificado para virar branch-aware (ver D1).
- Estado da conta vive em `profiles.status`; novo estado intermediário `requires_password_reset` é resolvido com **flag separada** (`profiles.requires_password_reset BOOLEAN`), não com novo valor de `status`. Razão: é ortogonal — uma conta `active` pode ter `requires_password_reset=true`.
- Middleware decide redirect; este change adiciona dois cases (`requires_password_reset → /forgot-password`, `pending_oauth_complete → /onboarding/complete-profile`).
- Anti-enumeração no signup já foi rejeitada lá (PRD aceita o trade-off de usabilidade); aqui nós aplicamos no login e no forgot-password (PRD RF-01.13 explícito).

## Goals / Non-Goals

**Goals:**

- Login resistente a brute force (lockout RF-01.08), com mensagens genéricas (RF-01.06), suporte a "manter conectado" (RNF-01.21).
- Recuperação de senha completa: forgot/reset com link 1h, invalidação global de sessões pós-reset, email de aviso (RF-01.13–15).
- Google OAuth com fluxo de complete-profile em primeiro acesso (RF-01.10–11) e account linking via confirmação de senha (RF-01.12).
- Logout que revoga refresh token globalmente (RF-01.22).
- Auth logs cobrindo todos os eventos do RNF-01.05; retenção 6 meses planejada (mesmo que o agendamento fique stub neste change).

**Non-Goals:**

- TOTP/2FA (não está no PRD 01).
- Login com Apple ID (RF-01.10 lista apenas Google).
- "Trust this device" / device fingerprint além do que `auth_sessions` já guarda.
- E2E real contra Google OAuth real (exige credenciais externas; ficamos com stub via Supabase local).
- Validação real de CRP, foto da carteira, fila admin, anonimização — continuam fora.
- Job real de purge de 6 meses agendado em produção (declaramos a função + teste; agendamento via Inngest/Vercel Cron fica para o change de housekeeping).

## Decisions

### D1. Trigger `handle_new_user()` passa a branch por provider

Hoje (após change 1) o trigger exige `raw_user_meta_data.fullName/crpNumber/...` — para login social isso não existe. Modificar para:

```sql
IF NEW.raw_app_meta_data ->> 'provider' = 'email' THEN
  -- caminho atual: insere profile completo a partir de metadata
ELSE
  -- caminho OAuth: NÃO insere; o Server Action /onboarding/complete-profile faz o INSERT
  RETURN NEW;
END IF;
```

Isso é uma MODIFIED requirement em `data-layer` (cobertura no specs delta). Razão: mantém o trigger útil para signup tradicional sem corromper OAuth. O Server Action `completeOAuthProfile` insere com service-role após validar CRP/UF/aceites.

**Alternativa rejeitada:** trigger sempre tenta inserir e captura exception. Polui logs e mascara bugs.

### D2. Lockout: estado em `profiles` (colunas) + forensics em `auth_logs`

`profiles` ganha:

- `failed_login_count INT NOT NULL DEFAULT 0`.
- `last_failed_login_at TIMESTAMPTZ`.
- `lockout_until TIMESTAMPTZ`.
- `consecutive_lockouts INT NOT NULL DEFAULT 0`.
- `requires_password_reset BOOLEAN NOT NULL DEFAULT false`.

Janela de 15 min é validada em SQL: se `last_failed_login_at < NOW() - 15min` no início do novo attempt, resetamos `failed_login_count=0` antes de incrementar. Tudo num único UPDATE atômico para evitar race (R1):

```sql
UPDATE profiles SET
  failed_login_count = CASE
    WHEN last_failed_login_at < NOW() - INTERVAL '15 minutes' THEN 1
    ELSE failed_login_count + 1
  END,
  last_failed_login_at = NOW(),
  lockout_until = CASE
    WHEN failed_login_count + 1 >= 5 THEN NOW() + INTERVAL '30 minutes'
    ELSE lockout_until
  END,
  consecutive_lockouts = CASE
    WHEN failed_login_count + 1 >= 5 THEN consecutive_lockouts + 1
    ELSE consecutive_lockouts
  END,
  requires_password_reset = CASE
    WHEN failed_login_count + 1 >= 5 AND consecutive_lockouts + 1 >= 3 THEN true
    ELSE requires_password_reset
  END
WHERE user_id = $1
RETURNING failed_login_count, lockout_until, consecutive_lockouts, requires_password_reset;
```

Server Action lê o RETURNING; se `lockout_until` mudou nesta query, dispara email "conta bloqueada" e log `lockout_started`. Se `requires_password_reset` virou `true`, log `lockout_consecutive_threshold_reached`. Auth_logs continuam recebendo `login_failure` por attempt para forense.

**Alternativa rejeitada:** tabela `login_attempts` separada com uma linha por tentativa + COUNT em janela. Mais escrita, mais leitura, mesma resposta. Aceitável só se quisermos forensics super-finos (já temos via `auth_logs`).

### D3. Anti-enumeração no `signIn` com timing constante

Implementação do antiteste de enumeração:

1. Ler email do form. Se profile não existe: chamar mock bcrypt-compare contra hash dummy (latência similar à real), incrementar nada, logar `login_failure_no_account` em `auth_logs` (user_id NULL), retornar `invalid_credentials`.
2. Se profile existe E `lockout_until > NOW()`: retornar `locked_out` SEM checar senha (PRD RF-01.06: "mostra mensagem genérica" — interpretação: ainda dizemos "incorretos" para o cliente, e o `locked_out` é renderizado como copy adicional só após o cliente ter passado por algumas falhas; alternativa: tratar lockout silenciosamente como `invalid_credentials`).
3. **Decisão final:** retornamos `locked_out` para o cliente quando `lockout_until > NOW()` — o PRD pede notificação ao usuário (email + UI). Não vaza enumeração porque só usuários reais chegam a esse estado; um atacante já sabe que o email é real para gerar 5 falhas.

### D4. "Manter conectado" via cookie sidecar

`@supabase/ssr` lê/escreve cookies de sessão sem um knob de Max-Age por chamada acessível. Solução: cookie sidecar `hp_keep_logged_in` setado pela Server Action conforme checkbox.

- Marcado: cookie `hp_keep_logged_in=1; Max-Age=86400; Secure; HttpOnly; SameSite=Lax`.
- Desmarcado: cookie sem `Max-Age` (sessão).

Nosso wrapper `createServerClient` em `src/shared/supabase/server.ts` é estendido para, ao escrever os cookies de sessão Supabase (`sb-*-auth-token`, `sb-*-refresh-token`), inspecionar `hp_keep_logged_in`:

- Se `=1`: aplicar `Max-Age = 86400`.
- Caso contrário: omitir `Max-Age` (sessão).

Refresh token TTL no servidor Supabase continua o default (7 dias); o navegador descarta o cookie antes disso conforme o flag.

**Trade-off:** se o usuário marcar "manter conectado" hoje e desmarcar amanhã, o cookie antigo persiste pelo Max-Age original. Aceitável — desmarcar leva a próxima sessão a ser ephemeral.

### D5. Logout server-side global

`signOut` Server Action passa a chamar `supabase.auth.signOut({ scope: 'global' })`. Isso invalida o refresh token no servidor Supabase. Em paralelo, a Server Action faz UPDATE em `auth_sessions` setando `revokedAt = NOW()` para todas as rows do `user_id`.

Para password reset (revogar enquanto não há sessão "minha"): `supabase.auth.admin.signOut(userId, 'global')` via service-role client.

### D6. Recuperação de senha — fluxo

```
/forgot-password (form: email)
  → action requestPasswordReset(email)
     → SEMPRE responde 200 com mesma copy ("Se este email estiver cadastrado, enviaremos um link")
     → SE email existe, chama supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${origin}/auth/callback?next=/reset-password`
        })
     → loga 'password_reset_requested' em auth_logs (user_id NULL se inexistente)
     → rate-limit: 3 calls/email/hora (Supabase já limita; nós retornamos generic mesmo se 429)

Email do Supabase chega → link → /auth/callback?code=...&next=/reset-password
  → exchangeCodeForSession (já tratado pelo callback existente)
  → redirect para /reset-password (sessão ativa, mesmo que profile esteja em pending_*)

/reset-password (form: new password + confirm)
  → action resetPassword(formData)
     → valida via passwordPolicy (10+ caracteres, todas as classes)
     → supabase.auth.updateUser({ password })
     → admin.signOut(userId, 'global')  -- invalida TODAS as sessões
     → UPDATE profiles SET requires_password_reset=false, failed_login_count=0,
                            consecutive_lockouts=0, lockout_until=NULL
                           WHERE user_id=$1
     → enviar email "senha alterada" (ver D7)
     → loga 'password_reset_completed'
     → redirect /login com banner "Senha redefinida. Faça login novamente."
```

### D7. Email "senha alterada" — Supabase Auth Hook ou SMTP direto

Supabase Auth não envia email automático após `updateUser({ password })`. Opções:

- **A**: Supabase Auth Hook `send_email` (Edge Function customizada). Nada de novo no app.
- **B**: SMTP direto via Supabase config (`supabase/config.toml` aponta para inbucket em dev) com fetch para SMTP HTTP API (não existe nativa no Supabase local).
- **C**: Resend HTTP API direto via `fetch` na Server Action.

**Decisão neste change:** Implementar opção **C** com Resend (é dependência declarada no PRD seção 10) — em dev, sem `RESEND_API_KEY`, a Server Action loga "[dev] would send email" ao pino e segue. Email real só em produção. Isso evita bloquear o change em config de Edge Functions/SMTP.

`shared/lib/mail/send-password-changed.ts` encapsula o fetch.

### D8. Google OAuth — fluxo + account linking

```
/login → click "Entrar com Google"
  → supabase.auth.signInWithOAuth({ provider: 'google', options: {
       redirectTo: `${origin}/auth/callback`,
       skipBrowserRedirect: false,
       queryParams: { prompt: 'select_account' }
    } })

Google → /auth/callback?code=...
  → exchangeCodeForSession
  → branch:
     a) auth.users acabou de ser criada (provider=google, primeira identidade):
        → SELECT FROM profiles WHERE user_id=$1: vazio (D1 trigger não inserta para OAuth)
        → SELECT FROM auth.users WHERE email = NEW.email AND id != NEW.id:
           - se existe: este Google bate com conta tradicional pré-existente.
             Antes do Supabase auto-linkar (config off), redirecionar /auth/link-account?
             pendingUserId=NEW.id
           - se não existe: usuário novo — redirecionar /onboarding/complete-profile
     b) profile existe e está active: redirect /dashboard
     c) profile existe e está pending_*: redirect /onboarding/pending

/onboarding/complete-profile (Server Component)
  → form: fullName (pré-preenchido com user.user_metadata.full_name), CRP, UF, 3 aceites
  → action completeOAuthProfile(formData):
     → valida via signupInputSchema (subset: sem email/senha/passwordConfirm; já temos sessão)
     → INSERT INTO profiles (user_id, fullName, ...) com service-role
     → loga 'oauth_signup' { provider: 'google' }
     → INSERT INTO oauth_identities (user_id, provider, provider_user_id, is_primary=true)
     → status fica pending_crp_validation (email do Google já é verificado, então pulamos pending_verification)
     → redirect /onboarding/pending

/auth/link-account?pendingUserId=...
  → form: senha tradicional (do email)
  → action linkOAuthIdentity(formData):
     → valida senha contra a auth.users tradicional via signInWithPassword
       (numa Supabase client server-only, sem afetar cookie atual — cliente isolado)
     → se senha confere:
        → admin.deleteUser(pendingUserId)  -- remove o auth.users transitório do Google
        → admin.linkIdentity(traditionalUserId, 'google', googleProviderUserId)
        → INSERT em oauth_identities
        → loga 'social_linked' { provider: 'google' }
        → redirect /login com banner "Conta Google vinculada. Faça login para continuar."
     → se não confere:
        → loga 'login_failure' (no scope tradicional)
        → mostra erro genérico
```

**Decisão crítica**: turn off Supabase auto-link via `auth.email.confirm_change` configs OR via `disable_signup` quirk... investigando — o setting é `enable_manual_linking=true` + cuidado para nunca chamar `signInWithOAuth` quando email já existe. Como Supabase processa o callback antes do nosso código rodar, o auto-link já aconteceu. Mitigação: comparar `auth.users.identities[]` no callback — se providers != 1 e profile não existe, é o caso de linking; tratamos como "já linkou, mas falta confirmar" oferecendo formulário de confirmação retroativa (sem opcional de não-linkar).

Como esse comportamento é versionado pelo Supabase, marco como **Open Question**.

### D9. Tabela `oauth_identities`

Schema:

```ts
oauthIdentities = pgTable('oauth_identities', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid().notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  provider: text().notNull(),  // 'google' | future
  providerUserId: text().notNull(),
  isPrimary: boolean().notNull().default(false),
  linkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueProviderId: unique().on(t.provider, t.providerUserId),
  userIdx: index().on(t.userId),
}));
```

RLS: `select_own` (`user_id = auth.uid()`). Sem INSERT/UPDATE/DELETE policy — escrita só por service-role nas Server Actions.

**Por que duplicar com `auth.identities`:** auth.identities é interno do Supabase, sem RLS, sem joins com nosso domínio, sem `linkedAt` controlado por nós. `oauth_identities` é o registro auditável + queryable que sustenta a UI de Configurações futura ("Você tem Google vinculado desde X").

### D10. Mensagens genéricas e copy pt-BR

Tabela de erros do `signIn` e copy:

| `error` retornado | Copy renderizada na UI |
|---|---|
| `invalid_credentials` | "E-mail ou senha incorretos." (default; sem revelar enumeração) |
| `locked_out` | "Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em XX min ou redefina sua senha." (com link Esqueci) |
| `requires_password_reset` | "Por segurança, redefina sua senha antes de entrar." (link forte para `/forgot-password` com email pré-preenchido) |
| `account_unavailable` | "Esta conta não está disponível. Entre em contato com o suporte." |
| `unknown` | "Algo deu errado. Tente novamente." |

`/forgot-password` retorna sempre: "Se este email estiver cadastrado, enviaremos um link em alguns instantes."

### D11. Schema mudanças e migration única

Migration `0002_login_hardening.sql` aplica:

- ALTER TABLE `profiles` ADD COLUMN `failed_login_count`, `last_failed_login_at`, `lockout_until`, `consecutive_lockouts`, `requires_password_reset`.
- CREATE INDEX em `profiles(lockout_until)` para queries de "ainda bloqueado?" (parcial WHERE lockout_until IS NOT NULL).
- CREATE TABLE `oauth_identities` + RLS + policies.
- Atualiza função `handle_new_user()` para D1 (branch por provider).

**Alternativa rejeitada:** duas migrations separadas (`0002_lockout`, `0003_oauth`). Não há razão de portabilidade — pré-prod aceita reset.

### D12. Retenção de 6 meses dos `auth_logs`

Função SQL `purge_old_auth_logs()` declarada na migration:

```sql
CREATE OR REPLACE FUNCTION public.purge_old_auth_logs()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH deleted AS (
    DELETE FROM auth_logs WHERE created_at < NOW() - INTERVAL '6 months'
    RETURNING id
  )
  SELECT COUNT(*)::INT FROM deleted;
$$;
```

Server Action `purgeOldAuthLogs()` chamável apenas com service-role; expõe a função para teste de integração. Agendamento (cron Vercel ou Inngest) FICA FORA — declarar TODO em tasks com link para change de housekeeping.

### D13. Módulos novos

- `src/modules/password-recovery/` com `lib/`, `server/`, `components/`, `index.ts` (`requestPasswordReset`, `resetPassword`, `ForgotPasswordForm`, `ResetPasswordForm`).
- `src/modules/oauth/` com `lib/` (provider config, identity helpers), `server/` (`completeOAuthProfile`, `linkOAuthIdentity`), `components/` (`GoogleButton`, `CompleteProfileForm`, `LinkAccountForm`), `index.ts`.
- `src/modules/auth/server/lockout.ts` — helpers internos do módulo `auth` (não exposto no barrel).

### D14. Dependências externas e configuração

- `Resend` SDK: NÃO instalar (opção C com `fetch` direto no `shared/lib/mail/`); chave em `RESEND_API_KEY`. Em dev sem chave, log no pino e segue.
- Google OAuth: `supabase/config.toml` ganha provider Google ativado. `GOOGLE_OAUTH_CLIENT_ID`/`SECRET` em `.env.local.example` documentados (valores reais via Vercel env). Em CI, e2e seeded NÃO testa Google real — usa stub (Playwright route mock para `accounts.google.com` + retornar code falso).
- Inbucket continua para emails de dev (incluindo o de "password changed" se Resend não estiver wired).

### D15. `data-testid` plano

Surface `login-form` (estende existente): `login-form-keep-logged-in`, `login-form-google-button`.

Surface `forgot-password-form`: `forgot-password-form-email`, `-submit`, `-success-message`.

Surface `reset-password-form`: `reset-password-form-password`, `-confirm`, `-submit`, `-error`.

Surface `complete-profile-form`: mesmo conjunto do `signup-form-*` exceto email/senha.

Surface `link-account-form`: `link-account-form-password`, `-submit`, `-error`.

Atualização em `docs/design-system/testid.md` — Wave-5.

## Risks / Trade-offs

- **R1. Lockout race em concurrent failed attempts** → Mitigação: UPDATE atômico com `RETURNING` (D2). Trade-off: lockout disparado por exatamente 5 falhas; teste de concorrência via integration test que dispara 10 attempts paralelos contra o mesmo user.
- **R2. Anti-enumeração via timing leak** → Mitigação: dummy hash compare ou `await sleep(50 + random(0,100))` nos paths "email não existe". Aceitável; testar via integration que mede latência média ±50ms.
- **R3. Auto-linking do Supabase pode acontecer antes do nosso branch decidir linking confirmado** → Mitigação: ler `auth.users.identities` no callback e detectar caso "primeira identidade Google + outra identidade Email pré-existente". Se não conseguirmos desligar auto-link, oferecemos confirmação retroativa (botão "Confirmar vinculação" + senha) na primeira tela `/dashboard` ou `/onboarding/pending`. Marca como **Open Question (OQ3)**.
- **R4. Resend sem `RESEND_API_KEY` em dev silenciosamente noop** → Mitigação: log warn no pino + e2e em modo dev assert que log foi emitido. Documentar em `local-development-environment` futuro.
- **R5. `app_metadata.provider` pode não estar setado no momento do AFTER INSERT trigger** → Mitigação: testar empiricamente; se vier vazio, usar `raw_user_meta_data ? 'metadata' : 'oauth'` como fallback. **OQ1.**
- **R6. Logout global pode ser percebido como hostil** → Trade-off aceito porque PRD RF-01.22 é explícito; UI ganha texto "Sair de todos os dispositivos" no botão para alinhar expectativa.
- **R7. Reset de senha invalida sessão atual** → trade-off aceito (PRD RF-01.15). UI redireciona para `/login` com banner; tests cobrem que cookie é limpo e middleware redireciona próximo request.
- **R8. e2e seeded de Google OAuth depende de stub frágil** → Trade-off aceito; smoke real fica como manual + documentado em `docs/runbooks/oauth-smoke.md` (criar fora deste change ou dentro como TODO).
- **R9. Função `purge_old_auth_logs` sem agendamento real** → Trade-off: integration test prova que função funciona; agendamento é responsabilidade do change de housekeeping.
- **R10. `consecutive_lockouts` reset critério (sucesso) é simples demais — pode permitir abuso** → Trade-off: PRD não especifica. Documentar em copy. Reset por timeout (ex.: 24h sem novo lockout zera o contador) pode ser refino futuro.

## Migration Plan

1. `npm run db:generate` produz SQL do `oauth_identities` e dos ALTERs em `profiles`. Editar manualmente para incluir RLS de `oauth_identities`, índice parcial em `lockout_until`, redefinição da função `handle_new_user()` (replace), função `purge_old_auth_logs`.
2. `supabase db reset` em dev recria; ou `supabase db push` aplica idempotentemente em dev local quando há dados de QA.
3. CI: integration tests aplicam migrations no Postgres do Testcontainers.
4. Prod (futuro): `npm run db:migrate` no deploy; sem dados clínicos, sem rollback procedure especial.

## Open Questions

- **OQ1.** `auth.users.raw_app_meta_data->>'provider'` está populado consistentemente no AFTER INSERT trigger para signups OAuth? Validar empiricamente; fallback é checar `raw_user_meta_data` vazio.
- **OQ2.** Supabase auto-linkagem pode ser desabilitada via config? Se sim, qual key (`auth.email.disable_signup`? `auth.identities.linking_strategy`?). Consultar via Context7 + docs Supabase.
- **OQ3.** Quando OAuth user já tem auto-link feito pelo Supabase (sem nosso fluxo), oferecer "Confirme vinculação" pós-fato OU ignorar e tratar como caso já consentido? Decisão do produto.
- **OQ4.** Resend deve ser instalado neste change ou um change de "transactional email" deve abrir o caminho? Default: fetch HTTP direto; sem SDK até o change de email transacional dedicado.
- **OQ5.** Onde mora o stub de Google OAuth para e2e seeded? `__tests__/e2e/seeded/_shared/google-oauth-stub.ts` parece natural; valida em design ou deixa para tasks descobrirem.
- **OQ6.** "Manter conectado" persistido como checkbox preservado entre sessões (cookie pré-form) ou sempre default-off? Default: default-off por LGPD/segurança; usuário marca conscientemente.
