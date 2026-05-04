## Context

O repositório hoje tem um smoke `/login` (Supabase Auth + middleware gating por presença de sessão), mas nenhum modelo de perfil profissional, nenhuma máquina de estados de conta e nenhum design system materializado em CSS. PRD 01 exige que toda criação de conta passe por: signup com CRP/UF/aceites → email de verificação → fila admin de validação de CRP → liberação para `(app)`. Este change instala a fundação inteira (UI tokens, primitives shadcn, tabelas Postgres com RLS, server actions, callbacks, middleware status-aware) num único corte coeso porque qualquer subdivisão menor produz um pedaço sem testabilidade ponta-a-ponta. Stakeholders: usuário psicólogo (cadastro humano em <2 min), admin futuro (fila de validação de CRP, fora deste change), CFP/LGPD (consentimentos auditáveis, RLS, logs de auth).

Restrições herdadas:

- `CLAUDE.md` exige Docker Compose + Supabase local; nada roda contra Supabase remoto.
- `docs/design-system/route-layout.md` fixa `(auth)` para públicas e `(app)` para autenticadas; signup vai em `(auth)/signup`, tela de pending vai em `(app)/onboarding/pending`.
- `docs/design-system/testid.md` exige `data-testid` em elementos interativos com convenção `<surface>-<role>-<noun>` e atualização do documento no mesmo PR.
- Pre-commit roda lint/type-check; sem `--no-verify`.
- Context7 obrigatório para consultas a docs Supabase/Drizzle/shadcn antes de codar.

## Goals / Non-Goals

**Goals:**

- Onboarding ponta-a-ponta funcional: usuário sai de `/signup`, recebe email, clica, cai em `/onboarding/pending` mostrando "CRP em validação".
- Modelo de dados auditável: `profiles`, `auth_logs`, `auth_sessions` com RLS habilitado e policies que respeitam `auth.uid()`.
- Status como única fonte de verdade para "pode entrar no app" — middleware checa `profile.status = 'active'`.
- Design system instalado: tokens CSS, dark mode via `data-theme`, Inter via `next/font`, primitives shadcn customizados ao tema.
- Cobertura: unit (validators), integration (Server Action + RLS), e2e seeded (signup → callback → pending).
- Cumprir RNF-01.04 (TLS) por hospedagem; RNF-01.01 (hash forte) terceirizado para Supabase Auth (bcrypt cost 10 default; documentar e considerar custom hash hook em change futuro se necessário).

**Non-Goals:**

- Validação real de CRP via API CFP (PRD aceita fila manual; nenhum integration externa).
- Upload de foto da carteira do CRP (RN-01.05 obriga delete depois — fica fora).
- UI da fila admin (será change separado).
- Google OAuth, password reset, lockout, "manter conectado", logout server-side, account linking (change `auth-login-hardening-and-recovery`).
- Rate limit no signup (recurso futuro com Supabase Edge Functions / middleware mais tarde).
- Toggle de dark mode na UI (apenas substrate; toggle = change futuro).
- Anonimização pós-cancellation (PRD 11).

## Decisions

### D1. Tabela `profiles` separada de `auth.users` (espelho 1:1)

`auth.users` é controlada pelo Supabase Auth e não aceita colunas customizadas estáveis. Criamos `public.profiles` com PK `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE` (PK = FK, sem `id` próprio). Vantagens: (a) RLS limpo via `auth.uid() = user_id`; (b) `JOIN auth.users` continua possível para email; (c) Supabase recomenda este padrão.

**Alternativa rejeitada:** colunas customizadas em `auth.users` via `raw_user_meta_data` (JSONB). Funciona para flags pequenas mas é não-tipado, sem constraints (ex.: `UNIQUE (crp_number, crp_uf)` impossível), sem RLS granular.

**Trigger DB `handle_new_user()`** dispara em `INSERT` na `auth.users` e cria a linha em `profiles` com `status='pending_verification'`. Razão: garante invariante "todo auth.user tem profile" mesmo em fluxos OAuth futuros, e roda em transação atômica com o signup. O signup Server Action chama `supabase.auth.signUp({ data: { full_name, crp_number, crp_uf, ... } })` e o trigger lê `raw_user_meta_data` para preencher as colunas tipadas.

### D2. `status` como coluna única + transições explícitas

`profiles.status TEXT NOT NULL` com `CHECK (status IN ('pending_verification','pending_crp_validation','active','suspended','cancelled'))`. Transições válidas:

```
pending_verification ──email confirmed──► pending_crp_validation
pending_crp_validation ──admin validated──► active
active ──admin action──► suspended
* ──user deleteAccount──► cancelled
```

Transições disparadas por:

- `pending_verification → pending_crp_validation`: trigger AFTER UPDATE em `auth.users` quando `email_confirmed_at` muda de NULL para NOT NULL.
- `pending_crp_validation → active`: chamada server-side futura (admin tool); para testes, helper SQL direto.
- demais transições: fora deste change.

**Alternativa rejeitada:** vários booleanos (`email_verified`, `crp_verified`, `is_active`). Simples no início mas vira matriz inválida (ex.: `crp_verified=true, email_verified=false`).

### D3. Middleware status-aware

`src/middleware.ts` hoje só checa sessão. Passa a chamar `supabase.auth.getUser()` e, se houver user, ler `profiles.status` por `user_id`. Tabela de decisão:

| Path solicitado | Sem sessão | `pending_verification` | `pending_crp_validation` | `active` | `suspended` / `cancelled` |
|---|---|---|---|---|---|
| `/login`, `/signup` | passa | →`/onboarding/pending` | →`/onboarding/pending` | →`/dashboard` | →`/login` (com banner futuro) |
| `/onboarding/pending` | →`/login` | passa | passa | →`/dashboard` | →`/login` |
| `/dashboard*`, outras `(app)` | →`/login?redirectTo=…` | →`/onboarding/pending` | →`/onboarding/pending` | passa | →`/login` |
| `/auth/callback` | passa | passa | passa | passa | passa |

**Custo extra:** 1 SELECT em `profiles` por request autenticado. Aceitável (PK lookup, <1ms). Mitigação futura: cache em JWT custom claim via Supabase Auth Hook quando virar gargalo.

**Alternativa rejeitada:** `JWT custom claim` com status. Adiciona complexidade (Auth Hook em Edge Function), invalidação ao mudar status exige refresh forçado. Adiar.

### D4. Validação de CRP somente formato + UF nesta iteração

Validador Zod: `crp_number` ∈ `^\d{2}/\d{4,7}$`, `crp_uf` ∈ enum 27 UFs, `crp_number` prefixo numérico ∈ tabela do Apêndice A do PRD coerente com `crp_uf`. Lookup externo NÃO é feito. Conta fica em `pending_crp_validation` indefinidamente; admin valida via SQL direto até o change que entrega a fila.

Para destravar dev/test: helper exportado `src/__tests__/integration/registration/helpers/markCrpValidated.ts` que executa UPDATE direto via Drizzle. NÃO é Server Action, NÃO é exposto em produção.

### D5. Módulo `registration` separado de `auth`

Per `CLAUDE.md` ("uma pasta por capability"), `registration` é capability distinta:

```
src/modules/registration/
  components/
    signup-form.tsx
    onboarding-pending-card.tsx
  lib/
    signup-input-schema.ts
    crp-validators.ts
    password-validators.ts
    uf-table.ts
    profile-status.ts
  server/
    sign-up.ts
    resend-verification.ts
    get-profile.ts
  index.ts
```

`auth` mantém login/logout. `registration` depende de `auth` apenas indiretamente (ambos consomem `shared/supabase` e `shared/db`). Cross-imports `registration ↔ auth` via barrel `index.ts` apenas.

### D6. Drizzle schema + migration única

Uma migration `0001_account_registration.sql` cria as 3 tabelas, RLS, policies, trigger e função. Razão: tudo é uma unidade lógica; rollback ou re-aplicação é atômica. Drizzle gera o SQL via `db:generate`; ajustes manuais (RLS, trigger) são adicionados ao final do arquivo gerado e committados.

Schemas TS:

- `shared/db/schema/profiles.ts` — `pgTable` com `userId` PK/FK, `status` enum, timestamps de consents, `crp_number`, `crp_uf`.
- `shared/db/schema/auth-logs.ts` — eventos auditáveis.
- `shared/db/schema/auth-sessions.ts` — metadata extra (Supabase já guarda token; tabela é para IP/UA/audit que Supabase não expõe nativamente).

`auth-sessions` e `auth-logs` ficam parcialmente populados neste change (apenas eventos de signup/verify). Eventos de login/lockout vão no change 2.

### D7. RLS policies

```sql
-- profiles
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (user_id = auth.uid());
-- INSERT é feito pelo trigger handle_new_user com SECURITY DEFINER; RLS bypassed
-- DELETE proibido para usuário comum (cancelamento futuro via Server Action com service role)

-- auth_logs
CREATE POLICY "auth_logs_select_own" ON auth_logs FOR SELECT USING (user_id = auth.uid());
-- INSERT só via Server Action com service role; nenhuma policy para INSERT/UPDATE/DELETE de usuário

-- auth_sessions
CREATE POLICY "auth_sessions_select_own" ON auth_sessions FOR SELECT USING (user_id = auth.uid());
```

**Por que sem policy de INSERT em `profiles`:** trigger usa SECURITY DEFINER, roda como dono da função, ignora RLS. Mais seguro que dar `WITH CHECK (user_id = auth.uid())` porque garante que ninguém mais (nem service role acidental) cria perfis manualmente sem passar pelo Supabase Auth signup.

### D8. Server Action `signUp` — fluxo

```
1. Receber FormData; safeParse com signupInputSchema (Zod).
2. Se inválido → return { ok: false, error: 'invalid_input', fieldErrors: {...} }.
3. supabase.auth.signUp({
     email, password,
     options: {
       data: { full_name, crp_number, crp_uf,
               terms_accepted_at, privacy_accepted_at,
               sensitive_data_consent_at },
       emailRedirectTo: `${origin}/auth/callback`
     }
   })
4. Tratar erros do Supabase:
   - 'User already registered' → 'duplicate_email'
   - 5xx ou network → 'unknown'
5. Trigger DB cria profile (status pending_verification).
6. Loga 'signup_success' em auth_logs (via service role após confirmar profile existe).
7. revalidatePath('/'); redirect('/onboarding/pending')  -- Supabase signUp já retorna session, o middleware aceita pending_verification.
```

Erro de duplicate CRP/UF: como o trigger usa `INSERT INTO profiles ON CONFLICT DO NOTHING` e checamos depois, retornamos erro `duplicate_crp` e revertemos signUp via `supabase.auth.admin.deleteUser` (service role, server-only). **Risco**: ver R4.

### D9. Callback `/auth/callback`

Route handler em `app/(auth)/auth/callback/route.ts` (rota dentro do grupo `(auth)` mas resolve para `/auth/callback` na URL):

```ts
GET /auth/callback?code=...
  → supabase.auth.exchangeCodeForSession(code)
  → trigger DB já transitou status para pending_crp_validation
  → loga 'email_verified' em auth_logs
  → redirect('/onboarding/pending')
```

Erros (token expirado/inválido) renderizam `/auth/callback/error` com botão "Reenviar email".

### D10. Design system foundation — duas camadas

**Camada 1 (CSS vars em `globals.css`):** todos os tokens do `docs/design-system/rules.md`, escopados em `:root` e `[data-theme='dark']`. Nada de cor hardcoded em componente.

**Camada 2 (`tailwind.config.ts`):** mapeia tokens para utilities Tailwind via `var(--token)`. shadcn primitives consomem essas utilities.

Inter via `next/font/google` em `app/layout.tsx`, exportada como CSS variable `--font-sans` para o tailwind.

Dark mode: `darkMode: ['class', "[data-theme='dark']"]` no Tailwind. Toggle UI = futuro; substrate funciona via DevTools (`document.documentElement.dataset.theme = 'dark'`).

shadcn primitives instalados neste change (mínimo para signup + onboarding pending):

- `button` (já existe), `input` (já existe), `label`, `form`, `checkbox`, `select`, `card`, `alert`.

Demais primitives ficam para changes que precisarem.

### D11. `data-testid` plano

Surface `signup-form`: `signup-form-name`, `-email`, `-password`, `-password-confirm`, `-crp-number`, `-crp-uf`, `-terms`, `-privacy`, `-sensitive-data`, `-submit`, `-error`, `-error-<field>`.

Surface `onboarding-pending`: `onboarding-pending-status`, `-resend-email`, `-resend-success`, `-resend-error`.

`docs/design-system/testid.md` recebe nova seção "Wave-4 IDs (auth-account-creation)".

### D12. Estratégia de testes

**Unit** (`__tests__/unit/registration/`):

- `signup-input-schema.test.ts` — happy + cada classe de erro (senha curta, CRP malformado, UF inválida, aceite faltando, email inválido).
- `crp-validators.test.ts` — coerência prefixo numérico ↔ UF (Apêndice A).
- `password-validators.test.ts` — todas as classes de carácter.
- `uf-table.test.ts` — 27 UFs presentes.
- `profile-status.test.ts` — transições válidas/inválidas.

**Integration** (`__tests__/integration/registration/`, Testcontainers Postgres + Drizzle migrations + RLS aplicados):

- `sign-up.int.test.ts` — chama Server Action, verifica linha em `auth.users` e `profiles` com `status='pending_verification'`, log em `auth_logs`. Caso duplicate email/CRP → erros tipados, rollback do auth.user em duplicate CRP.
- `rls-profiles.int.test.ts` — usuário A não consegue SELECT/UPDATE profile do B.
- `email-verified-trigger.int.test.ts` — UPDATE em `auth.users.email_confirmed_at` transita `profile.status`.
- `middleware-status-gating.int.test.ts` — combinatória de status × path.

**E2E seeded** (`__tests__/e2e/seeded/registration/`):

- `signup-happy-path.spec.ts` — preenche form, submete, mock callback (testbed com link extraído do email mockado), cai em `/onboarding/pending`.
- `signup-validation-errors.spec.ts` — erros inline aparecem em blur, não onChange.
- `pending-screen.spec.ts` — botão "Reenviar email" funciona; tentativa de acessar `/dashboard` redireciona.

### D13. Senha forte: validador único

Função `passwordPolicy(s: string): { ok: boolean; missing: string[] }` exportada por `lib/password-validators.ts`. UI consome para feedback inline em tempo real (lista de critérios não atendidos), Zod schema reusa via `.refine()`. Mensagem de erro humana ("Adicione pelo menos um número") nunca regex crua.

### D14. Logs de auth — esquema mínimo

`auth_logs(id, user_id?, event, ip, user_agent, metadata jsonb, created_at)`. Eventos neste change:

- `signup_success` — `metadata: { crp_number, crp_uf }`.
- `signup_failure_duplicate_email` — `user_id NULL`, `metadata: { email_hash }`.
- `signup_failure_duplicate_crp` — `user_id NULL`, `metadata: { crp_number, crp_uf, email_hash }`.
- `email_verified` — disparado pelo callback.

Eventos de login/lockout no change 2. Retenção de 6 meses (RNF-01.05) implementada via job Inngest no change futuro de housekeeping; por ora, logs ficam indefinidamente em dev.

### D15. Ordem de implementação dentro do change

1. Design system foundation (tokens, tailwind, Inter, dark mode substrate, primitives shadcn) — independente, destrava UI.
2. Drizzle schemas + migration + RLS + trigger — base para Server Actions.
3. Validators (Zod, password, CRP, UF) — base para form e Server Action.
4. Server Action `signUp` + callback `/auth/callback` + helper `getProfile`.
5. Middleware status-aware.
6. UI `/signup` + `/onboarding/pending`.
7. Atualizar `dashboard/page.tsx` para usar `profile.full_name` no greeting.
8. Testes (unit primeiro, depois integration, depois e2e seeded).
9. Atualizar `docs/design-system/testid.md`.

## Risks / Trade-offs

- **R1. Trigger DB com SECURITY DEFINER pode virar vetor de privilégio se evoluído mal** → Mitigação: função roda com `STRICT`, escreve apenas em `profiles`, sem branching dinâmico. Code review e teste integration que tenta SELECT cross-user via trigger.
- **R2. Read extra no middleware penaliza latência** → Mitigação: PK lookup por `auth.uid()`; medir em integration test (P95 < 50ms). Plano de fuga: JWT claim em change futuro.
- **R3. Supabase Auth signUp aceita criação mesmo com profile-side erro de duplicate CRP** → Mitigação: D8 reverte via `supabase.auth.admin.deleteUser` (service role). Trade-off: race entre signUp e revert pode deixar `auth.user` órfão por <1s; aceitável e telemetria via `auth_logs` permite cleanup. Alternativa rejeitada: validar CRP unicidade ANTES de signUp via SELECT — TOCTOU.
- **R4. Status `pending_crp_validation` indefinido bloqueia QA local** → Mitigação: helper `markCrpValidated` em `__tests__/integration/registration/helpers/`, usável também em e2e seeded via fixture.
- **R5. Email de verificação em dev local não é entregue** → Mitigação: Supabase local já tem inbucket (`http://localhost:54324`); documentar no `local-development-environment` spec se necessário. E2E seeded extrai o link do inbucket via API.
- **R6. Dark mode sem toggle parece dead code** → Aceitável; tokens permanecem testáveis (snapshot DOM com `data-theme='dark'`). Toggle UI virá em change separado quando justificar valor.
- **R7. Re-send de email tem rate limit do Supabase (1/min default)** → Mitigação: erro `resend_rate_limited` exibido na pending screen com mensagem humana ("Espere 1 minuto para reenviar").
- **R8. shadcn primitives instalados podem conflitar com primitives já existentes** → Mitigação: rodar `npx shadcn add` com `--overwrite` apenas em primitives explicitamente novos; não tocar em `button`/`input` existentes a menos que tokens novos exijam.
- **R9. Migration nova quebra ambientes locais com banco não-resetado** → Mitigação: change inclui nota em `docs/` ou commit message instruindo `supabase db reset`. Pre-prod aceita reset.
- **R10. Testes integration ficam lentos com Testcontainers + RLS** → Mitigação: seguir padrão já estabelecido em `__tests__/e2e/_shared/postgres-container.ts` (compartilhado); paralelismo limitado se necessário.

## Migration Plan

1. `npm run db:generate` produz SQL Drizzle; ajustar manualmente para incluir RLS + trigger no mesmo arquivo `0001_account_registration.sql`.
2. `supabase db reset` em dev recria tudo.
3. Em CI: `npm run test:integration` aplica migrations no Postgres do Testcontainers a cada run.
4. Em prod (futuro): aplicar via `npm run db:migrate` no deploy. Sem dados existentes, sem rollback necessário.
5. **Rollback**: revert do PR + `supabase db reset`. Aceitável porque pre-prod.

## Open Questions

- **OQ1.** Senhas legacy de 8+ aceitas no `/login` divergem das de 10+ no `/signup` — devemos forçar reset no próximo login? **Decisão default deste change:** aceitar 8+ no login; mensagem de "atualize sua senha" fica para change 2 quando o reset existir.
- **OQ2.** Aceite de Termos/Privacidade armazena timestamp; precisamos versionar (ex.: `terms_version VARCHAR`)? **Decisão default:** sem versão por ora; quando termos mudarem, change futuro adiciona coluna + força re-aceite no próximo login. Documentar no spec como expansion path.
- **OQ3.** O `/onboarding/pending` deve permitir editar dados (ex.: corrigir CRP digitado errado)? **Decisão default:** não nesta iteração; usuário contacta suporte. Edit virá com a fila admin.
- **OQ4.** Dark mode toggle — onde mora? Não decidido aqui. Substrate funciona; UI virá em change de "Configurações de aparência".
- **OQ5.** Resend de email deveria ter cooldown visual no botão? **Decisão default:** sim, `disabled` por 60s após click bem-sucedido + texto "Reenviar (60s)" — implementação detalhada em tasks.
