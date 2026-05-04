## Why

PRD 01 exige que psicólogos brasileiros possam criar conta segura, comprovar registro no CRP e ter acesso gradual ao app conforme o status da conta progride. Hoje o repositório tem apenas um `/login` smoke (email + senha contra Supabase Auth) e nenhum fluxo de cadastro, nenhum modelo de perfil profissional (CRP/UF), nenhuma máquina de estados de conta e nenhum design system instanciado — qualquer feature de domínio (PRD 02 em diante) depende dessa fundação. Este change entrega o caminho de onboarding ponta-a-ponta (signup → verificação de email → fila de validação de CRP) junto com os tokens e primitives shadcn/ui necessários para construir UI consistente daqui em diante.

## What Changes

- **Cadastro completo (`/signup`)** com formulário validado (nome 3–120, email RFC, senha 10+ caracteres com classes obrigatórias, confirmação, CRP `XX/NNNNNN`, UF de 27 estados, 3 aceites obrigatórios — Termos, Privacidade, Tratamento de Dados Sensíveis).
- **Server Action `signUp`** que cria a conta no Supabase Auth, persiste o perfil profissional e dispara email de verificação de 24h.
- **Verificação de email** via callback do Supabase em `/auth/callback`, transitando o status de `pending_verification` para `pending_crp_validation`.
- **Tela bloqueante pós-login** (`/onboarding/pending`) que substitui o dashboard enquanto a conta não estiver `active`, com mensagem específica por status e ação de reenviar email de verificação.
- **Máquina de estados de conta** com 5 valores (`pending_verification`, `pending_crp_validation`, `active`, `suspended`, `cancelled`) gerida por uma coluna `status` em `profiles`; middleware passa a redirecionar conforme status, não apenas presença de sessão.
- **Validação de CRP** apenas no formato (`^\d{2}/\d{4,7}$`) + UF da tabela do Apêndice A do PRD; verificação real fica como fila admin offline (status `pending_crp_validation`) — sem upload de carteira nesta iteração (RN-01.05).
- **Modelo de dados profissional** (Drizzle): tabelas `profiles`, `auth_logs`, `auth_sessions` em schema `public`, migrations versionadas e políticas RLS que garantem que todo usuário só lê/escreve sua própria linha.
- **Logs de autenticação mínimos** para `signup_success`, `signup_failure_duplicate_email`, `signup_failure_duplicate_crp`, `email_verified` (RNF-01.05; logs completos para login/lockout vão no change 2).
- **Design system foundation**: tokens CSS em `globals.css` + `tailwind.config.ts` (paleta sálvia, semânticas, escala de espaçamento/radius/shadow/duration), Inter via `next/font`, suporte a dark mode via atributo `data-theme`, primitives shadcn/ui necessários para o signup (`Form`, `Input`, `Label`, `Checkbox`, `Select`, `Card`, `Alert`).
- **BREAKING (interno):** middleware deixa de tratar "ter sessão" como sinônimo de "pode entrar no `(app)`" — passa a exigir `profile.status = 'active'`. Usuários autenticados em outros estados são redirecionados para `/onboarding/pending`.
- **Cobertura de testes**: unit (validators de senha, CRP, UF, formulário), integration (Server Action `signUp` contra Postgres real via Testcontainers, com migrations e RLS aplicados), e2e seeded (signup completo → verificação simulada → cai em `pending_crp_validation` → dashboard ainda bloqueado).

## Capabilities

### New Capabilities

- `account-registration`: Fluxo completo de criação de conta profissional — formulário `/signup`, Server Action de signup, verificação de email, máquina de estados de conta (`pending_verification` → `pending_crp_validation` → `active`), tela bloqueante por status, gating de middleware status-aware, validação de CRP no formato + UF, aceite registrado de Termos/Privacidade/Dados Sensíveis.
- `design-system-foundation`: Contrato visual da aplicação — tokens CSS (cores, tipografia, espaçamento, radius, sombras, durações, easing), tailwind config derivado dos tokens, dark mode via `data-theme`, Inter via `next/font`, primitives shadcn/ui customizados ao tema, regra de "nunca cor hardcoded em componente".

### Modified Capabilities

- `authentication`: Middleware deixa de gating apenas por presença de sessão e passa a considerar `profile.status` para decidir entre `/dashboard`, `/onboarding/pending` e `/login`. `signIn` Server Action passa a carregar o perfil após autenticar para permitir esse roteamento. Login continua aceitando senhas legacy de 8+ (não enforça as regras de 10+ do signup), mas o redirect pós-login depende do status.
- `data-layer`: Adiciona migrations Drizzle e schemas para `profiles`, `auth_logs`, `auth_sessions` no schema `public`, com RLS habilitado e políticas que restringem cada usuário aos próprios registros; `profiles.user_id` faz `REFERENCES auth.users(id) ON DELETE CASCADE`. Helper `getCurrentProfile(supabase)` exposto pelo módulo de DB para uso em Server Actions/RSCs.

## Impact

- **Código novo**: `src/modules/registration/` (novo módulo: server actions de signup e verificação, validators de CRP/UF/senha, mapeadores de status), `src/modules/auth/server/` recebe `getProfileWithStatus`, `src/app/(auth)/signup/`, `src/app/(auth)/auth/callback/route.ts`, `src/app/(app)/onboarding/pending/`, `src/shared/db/schema/profiles.ts` (+ `auth-logs.ts`, `auth-sessions.ts`), `src/shared/db/migrations/000X_*`, `src/shared/ui/` ganha primitives shadcn (Checkbox, Select, Card, Alert, Form), tokens em `src/app/globals.css`.
- **Código modificado**: `src/middleware.ts` (status-aware gating), `src/modules/auth/index.ts` (novos exports), `src/modules/auth/server/login.ts` (carrega profile pós-auth), `src/app/(app)/dashboard/page.tsx` (lê `profile.full_name` no greeting), `tailwind.config.ts` (paleta brand sálvia + semânticas + escala derivada de tokens).
- **Dependências externas**: Supabase Auth (já presente) — apenas habilitar template de email "Confirm signup" em pt-BR; nenhuma SDK nova adicionada nesta etapa (Resend e validação real de CRP ficam para o change 2 / changes futuros).
- **Banco de dados**: 3 tabelas novas em `public`, RLS obrigatório; impacto em `supabase start` local — `supabase db reset` recria tudo do zero.
- **Testes**: nova suíte de integration sob `src/__tests__/integration/registration/`, novas e2e seeded sob `src/__tests__/e2e/seeded/registration/`, unit em `src/__tests__/unit/registration/`. `data-testid` novos sob o prefixo `signup-form-*` e `onboarding-pending-*` documentados em `docs/design-system/testid.md`.
- **Documentação**: atualizar `docs/design-system/testid.md` com IDs novos e `docs/design-system/route-layout.md` se necessário (rota `/signup` é nova mas segue padrão `(auth)`).
- **Não impactado neste change**: Google OAuth, password reset, lockout de tentativas, account linking, "manter conectado", logout invalidando refresh token no backend, suspensão administrativa, anonimização pós-cancellation — tudo isso fica para o change `auth-login-hardening-and-recovery`.
