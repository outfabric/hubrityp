# account-lifecycle

## Resumo

Define a máquina de estados que governa toda a vida de uma conta de psicólogo no HubrityP — `pending_verification → pending_crp_validation → active`, mais transições para `suspended` e `cancelled` — e a captura LGPD dos três consentimentos obrigatórios (Termos de Uso, Política de Privacidade, tratamento de dados sensíveis) com timestamps e versões independentes. O módulo é a única fonte de verdade do campo `psychologist_profiles.status`: nenhum outro caminho em `src/` pode escrever na coluna.

## Onde mora o código

- **Módulo account-lifecycle** (`src/modules/account-lifecycle/`):
  - `src/modules/account-lifecycle/index.ts` — barrel público (re-exporta tipos, helpers puros, Server Actions e os componentes bloqueantes).
  - `src/modules/account-lifecycle/lib/state-machine.ts` — `transitionStatus(current, event)`, tabela imutável de transições, tipos `AccountStatus` / `TransitionEvent` / `TransitionResult`. Função pura, sem I/O.
  - `src/modules/account-lifecycle/lib/document-versions.ts` — `documentVersions` (`{ terms, privacy, sensitiveData }`) e `getDocumentVersion(kind)`. Pinned strings que viajam para o banco junto com cada timestamp de consentimento.
  - `src/modules/account-lifecycle/server/get-account-status.ts` — `getAccountStatus(userId, jwtMirror?)`: leitura direta do Postgres com detecção de drift contra o `JwtAccountMirror` (quando o middleware o passa).
  - `src/modules/account-lifecycle/server/transition.ts` — `applyTransition(userId, event, tx?)`: orquestra `transitionStatus` + UPDATE Drizzle dentro de uma transação, opcionalmente reaproveitando uma transação externa.
  - `src/modules/account-lifecycle/components/verify-email-page.tsx` — Client Component bloqueante para `pending_verification`.
  - `src/modules/account-lifecycle/components/crp-review-page.tsx` — Server Component bloqueante para `pending_crp_validation`.
- **Schema e migrations** (`src/shared/db/schema/auth/` + `src/shared/db/migrations/`):
  - `psychologist-profiles.ts` — tabela `psychologist_profiles` (PK `user_id` FK→`auth.users`), CHECK em `status`, UNIQUE em `(crp_number, crp_uf)`, três timestamps de consentimento + três strings de versão.
  - `policies.ts` — strings de RLS (owner-scoped via `auth.uid() = user_id`).
  - `0001_left_phalanx.sql` — migração que cria as tabelas, instala FK para `auth.users`, habilita RLS, define `set_app_metadata(uuid, text)` SECURITY DEFINER e os triggers `psychologist_profiles_set_timestamps` (BEFORE UPDATE) e `psychologist_profiles_mirror_status` (AFTER UPDATE OF status).
- **Route shells consumidores** (`src/app/(auth)/auth/`):
  - `verify-email/page.tsx` + `verify-email/actions.ts` — wiring da `<VerifyEmailPage/>` com `resendVerificationEmail` e `signOut`.
  - `crp-review/page.tsx` + `crp-review/actions.ts` — wiring da `<CrpReviewPage/>` com `signOut`.
  - `src/app/auth/callback/route.ts` — `GET /auth/callback`: troca o `code` por sessão via Supabase, dispara `applyTransition(userId, 'email_verified')` e redireciona.
- **Middleware**: `src/middleware.ts` consome `getAccountStatus` para rotear cada request por status (passthrough vs bloqueante vs cookie-clear).

## Superfície pública

- **Server Actions / helpers server-side** (importáveis de `@/modules/account-lifecycle`):
  - `transitionStatus(current, event): TransitionResult` — pura.
  - `applyTransition(userId, event, tx?): Promise<TransitionResult>` — escreve na tabela; aceita transação externa para evitar deadlock com o pool `postgres({ max: 1 })`.
  - `getAccountStatus(userId, jwtMirror?): Promise<AccountStatusResult>` — devolve `{ status, source: 'jwt' | 'db', drift }`.
  - `documentVersions` (constante) e `getDocumentVersion(kind: DocumentKind)`.
- **Tipos exportados**: `AccountStatus`, `TransitionEvent`, `TransitionResult`, `AccountStatusResult`, `JwtAccountMirror`, `DocumentKind`, `VerifyEmailPageProps`, `VerifyEmailResendResult`, `CrpReviewPageProps`.
- **Componentes**: `<VerifyEmailPage email resendAction signOutAction />` e `<CrpReviewPage crpNumber crpUf signOutAction contactEmail />`.
- **Rotas HTTP**:
  - `GET /auth/verify-email` — bloqueante, render do componente para usuários `pending_verification`.
  - `GET /auth/crp-review` — bloqueante, render do componente para usuários `pending_crp_validation`.
  - `GET /auth/callback?code=...` — handshake do email-confirmation flow do Supabase; idempotente (re-clique no link nunca regride o status).
- **DB / SQL**:
  - Tabela `psychologist_profiles` (CHECK `status IN (...)`, UNIQUE `(crp_number, crp_uf)`).
  - Função `public.set_app_metadata(uuid, text)` SECURITY DEFINER (EXECUTE granted apenas a `service_role`).
  - Triggers `psychologist_profiles_set_timestamps` (BEFORE UPDATE) e `psychologist_profiles_mirror_status` (AFTER UPDATE OF status).
- **Env vars consumidas** (via `serverEnv`/`clientEnv` em `src/shared/env/`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Nenhuma var dedicada de account-lifecycle.

## Comportamento e invariantes

- **Tabela de transições** (única autoridade — alterações exigem migration na CHECK):

  | De                       | Evento            | Para                     |
  | ------------------------ | ----------------- | ------------------------ |
  | `pending_verification`   | `email_verified`  | `pending_crp_validation` |
  | `pending_crp_validation` | `crp_approved`    | `active`                 |
  | `pending_crp_validation` | `crp_rejected`    | `suspended`              |
  | `active`                 | `admin_suspend`   | `suspended`              |
  | `active`                 | `user_cancel`     | `cancelled`              |
  | `suspended`              | `admin_reinstate` | `active`                 |

  Qualquer outra combinação `(from, event)` retorna `{ ok: false, error: 'invalid_transition' }`. `cancelled` é terminal — nenhuma transição parte dele.

- **`transitionStatus` / `applyTransition` são os ÚNICOS escritores de `status`.** O teste unitário `no-direct-status-writes.test.ts` faz grep no repositório e falha se `\.status\s*=` aparecer em qualquer outro caminho de `src/` que não seja o módulo `account-lifecycle/lib/` ou seus testes. Adicionar um Drizzle `.set({ status: ... })` fora desse módulo quebra o build.

- **Triggers do banco são fonte da verdade dos timestamps.** `applyTransition` deliberadamente NÃO seta `status_changed_at` nem `updated_at` no payload do UPDATE — quem faz isso é o trigger `psychologist_profiles_set_timestamps` (avança `updated_at` em todo UPDATE; avança `status_changed_at` apenas quando `status` muda). Se o trigger parar de disparar o teste de integração captura.

- **JWT mirror via `set_app_metadata`** (SECURITY DEFINER): o trigger AFTER UPDATE OF status copia o novo valor para `auth.users.raw_app_meta_data.account_status`, de onde ele vai para o JWT no próximo refresh. EXECUTE da função é granted apenas a `service_role` — código de aplicação NÃO pode chamar diretamente; só o trigger (que roda como o definer) pode usar.

- **Detecção de drift**: `getAccountStatus` sempre lê o banco. Quando recebe um `jwtMirror`, compara `accountStatus` e `iat` contra o row; qualquer divergência (mirror stale ou status divergente) loga `status_mirror_drift` em WARN com identificadores apenas (sem PII). O retorno carrega `drift: true` e `source: 'db'` mesmo quando o JWT teria fornecido a resposta.

- **`applyTransition` aceita uma transação externa.** Quando o caller já está dentro de `db.transaction(...)` (caso típico: `approveCrpValidation` / `rejectCrpValidation`), passar a `tx` evita o deadlock que ocorreria com o pool postgres-js configurado em `max: 1` se um `db.transaction` interno tentasse pegar uma conexão enquanto a externa segura o lock da row. Sem `tx`, abre a própria.

- **Idempotência do callback de verificação**: `applyTransition(userId, 'email_verified')` retornando `invalid_transition` (porque o status já é `pending_crp_validation` ou além) é tratado como sucesso — o handler `/auth/callback` redireciona para `/dashboard` mesmo assim e o middleware decide o destino real pelo status atual. Re-clicar no link nunca regride a conta.

- **RLS owner-scoped em `psychologist_profiles`**: políticas SELECT/INSERT/UPDATE/DELETE para `authenticated` exigem `auth.uid() = user_id`. Nenhum psicólogo lê ou escreve linhas de outro. `service_role` bypassa a RLS no nível do role para seeds/admin.

- **LGPD — três consentimentos independentes**: `terms_accepted_at`, `privacy_accepted_at`, `sensitive_data_consent_at` são timestamps NOT NULL distintos, cada um pareado com sua string de versão (`terms_version`, `privacy_version`, `sensitive_data_consent_version`). Persistir os três simultaneamente no momento do signup é requisito do schema (NOT NULL); o signup falha cedo se algum estiver ausente.

- **`statusChangedAt` é o relógio de transição, não `updatedAt`.** `updatedAt` avança em todo UPDATE (ex.: o usuário troca o nome); `statusChangedAt` avança apenas quando `status` muda. Detecção de drift no JWT mirror compara `iat` contra `statusChangedAt`, não `updatedAt`.

- **`cancelled` é terminal — não há transição de saída.** Reativação de conta cancelada exige reonboarding completo. `admin_reinstate` só sai de `suspended`.

## Testes

- **Unit** (`src/__tests__/unit/modules/account-lifecycle/`):
  - `lib/state-machine.test.ts` — cobre exaustivamente a tabela de transições e os branches `invalid_transition`.
  - `lib/document-versions.test.ts` — pinned versions e tipo do accessor.
  - `lib/no-direct-status-writes.test.ts` — grep guard que falha se `\.status\s*=` aparecer fora do módulo state-machine.
  - `components/verify-email-page.test.tsx` — render do email, rate-limit/forbidden/unknown UI, botão de logout.
  - `components/crp-review-page.test.tsx` — render do CRP/UF formatado, contact email, logout.
- **Integration** (`src/__tests__/integration/`):
  - `modules/account-lifecycle/server/transition.int.test.ts` — happy path de cada transição contra Postgres real, asserções nos triggers de timestamp e no mirror em `auth.users.raw_app_meta_data`, nesting de tx (`applyTransition` aceita tx externa sem deadlocar).
  - `modules/account-lifecycle/server/get-account-status.int.test.ts` — JWT mirror fresh / stale / disagree, log `status_mirror_drift`, fallback sem mirror, `null` para usuário sem profile.
  - `auth/verify-email-route-shell.int.test.ts` — page shell redireciona `active` → `/dashboard`, renderiza para `pending_verification`, action de resend fluida.
  - `auth/crp-review-route-shell.int.test.ts` — page shell redireciona `active`, renderiza para `pending_crp_validation`, expõe contact email.
  - `auth/callback-route.int.test.ts` — `GET /auth/callback` exchange + transition + idempotência (re-clique).
  - `middleware-status.int.test.ts` — matriz completa auth × status × path.
- **E2E (seeded)** (`src/__tests__/e2e/seeded/`):
  - `signup-happy-path.spec.ts` — fluxo de signup chega na página `verify-email`.
  - `auth-verify-callback.spec.ts` — clique no link do email completa a transição e roteia.
  - `middleware-routing.spec.ts` — combinações status × path no navegador.
  - `signin-suspended.spec.ts` — login de usuário suspenso é deslogado e redirecionado para `/login?reason=suspended`.

## Histórico de changes

- 2026-05-03 add-account-signup-and-lifecycle — capability criada: state machine de 5 estados + `transitionStatus`/`applyTransition`, schema `psychologist_profiles` com triggers de mirror + timestamps, `getAccountStatus` com detecção de drift, três timestamps LGPD independentes com `documentVersions`, páginas bloqueantes `<VerifyEmailPage/>` e `<CrpReviewPage/>`, callback `/auth/callback` idempotente. Veja [`../openspec/changes/archive/2026-05-03-add-account-signup-and-lifecycle/`](../openspec/changes/archive/2026-05-03-add-account-signup-and-lifecycle/).
