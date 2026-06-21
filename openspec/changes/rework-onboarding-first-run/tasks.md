# Tasks — rework-onboarding-first-run

> Convenção de sequenciamento (design D7): cada bloco de teste é escrito **imediatamente após** a alteração de código que o motiva, dentro do mesmo grupo — nunca agrupado no fim. Lint/format/type-check rodam via Husky em cada commit (sem `--no-verify`).

## 1. Remoção do tour — código (Frontend + Backend)

- [x] 1.1 Deletar componentes do tour: `src/modules/onboarding/components/dashboard-tour.tsx` e `dashboard-tour-impl.tsx`.
- [x] 1.2 Deletar o catálogo de passos `src/modules/onboarding/lib/tour-steps.ts` e a Server Action impl `src/modules/onboarding/server/complete-tour.ts`.
- [x] 1.3 Remover os exports de tour do barrel `src/modules/onboarding/index.ts` (`DashboardTour`, `TOUR_STEPS`, `TourStep`, `completeTourImpl`, `CompleteTourResult`).
- [x] 1.4 Em `src/app/(app)/dashboard/page.tsx`: remover o import e o render de `<DashboardTour>` (e o import de `completeTour`).
- [x] 1.5 Em `src/app/(app)/dashboard/actions.ts`: remover a Server Action `completeTour`.
- [x] 1.6 Remover o `ReplayTourButton` (`src/app/(app)/configuracoes/ajuda/primeiros-passos/replay-tour-button.tsx`) e seu uso em `.../primeiros-passos/page.tsx`, preservando o restante da página.
- [x] 1.7 Remover as 5 âncoras `data-tour-anchor` em `src/app/(app)/sidebar-nav.tsx`, `src/modules/dashboard/components/section-today.tsx`, `section-pendencias.tsx` e `section-actions.tsx` (2 âncoras).
- [x] 1.8 Remover a dependência `driver.js` do `package.json` e rodar `npm install` para atualizar o lockfile.

## 2. Remoção do tour — testes e specs

- [x] 2.1 Deletar as suites do tour: `src/__tests__/unit/modules/onboarding/lib/tour-steps.test.ts`, `src/__tests__/integration/onboarding/complete-tour.int.test.ts`, `src/__tests__/e2e/seeded/onboarding/tour.spec.ts`.
- [x] 2.2 Remover o stamping/reset de `tour_completed_at` dos seeds e2e (`src/__tests__/e2e/seeded/setup/global-setup.ts`, `seed-state.ts`) — sem deixar referências órfãs à coluna.
- [x] 2.3 Remover o diretório de spec arquivada `openspec/specs/onboarding-tour/` (a remoção é formalizada pelo delta da change) e a menção ao "tour" em `openspec/specs/dashboard-home/spec.md`.
- [x] 2.4 Rodar a suíte unit + a relevante de integração para garantir que nenhuma referência a tour quebrou o build (`grep -r "tour" src` não deve achar código vivo, só ausência).

## 3. Drop da coluna `tour_completed_at` (Backend / Dados)

- [x] 3.1 Remover `tourCompletedAt` de `src/shared/db/schema/auth/tables.ts` (e do docstring do tipo).
- [x] 3.2 Remover `'tour_completed_at'` do select e `tourCompletedAt` do mapeamento em `src/modules/registration/server/get-profile-edge.ts` (o tipo `Profile` deriva do schema, então some automaticamente).
- [x] 3.3 Gerar a migration com `drizzle-kit generate` (confirmar via **Context7** o fluxo `generate`→`migrate`); revisar o SQL emitido (`ALTER TABLE "profiles" DROP COLUMN "tour_completed_at"`), confirmar que nenhuma policy RLS referencia a coluna.
- [x] 3.4 Aplicar via `npm run db:migrate` no ambiente local (Docker Compose) e validar que a app sobe sem a coluna.
- [x] 3.5 Ajustar `src/__tests__/integration/onboarding/data-model.int.test.ts` (remover asserção de `tour_completed_at`) e qualquer seed/integração que selecione a coluna (ex.: `public-routes-gating.int.test.ts`).
- [x] 3.6 Teste de integração: novo perfil migrado mantém defaults das colunas remanescentes e `tour_completed_at` não existe no schema (cobre o cenário "The tour_completed_at column no longer exists").

## 4. Middleware — gating de onboarding (Backend / Edge)

- [x] 4.1 Em `src/middleware.ts`: adicionar a classe `'onboarding-wizard'` ao tipo `PathClass` e mover `/onboarding/welcome` + `/onboarding/setup` de `APP_PREFIXES` para essa classe em `classifyPath()` (manter o check estrito prefixo+`/` contra `/onboarding/welcomex`).
- [x] 4.2 Garantir que a nova classe reproduz, para anon/pending/suspended/cancelled, exatamente o comportamento que `'app'` dava (anon → `/login?redirectTo=`, pending → `/onboarding/pending`, suspended/cancelled → clear+redirect) nos pontos que hoje testam `pathClass === 'app'`.
- [x] 4.3 Em `decideWithProfile()`, caso `ProfileStatus.Active` (após o guard de `requiresPasswordReset`, intocado): computar `onboardingComplete = onboarding_step === 'done' || onboarding_completed_at != null` e dividir o ramo — incompleto: `onboarding-wizard`/`reset-password` → pass, `app`/`onboarding`/`auth`/`complete-profile`/`link-account` → redirect `/onboarding/welcome` (reason `active-onboarding-incomplete`); completo: comportamento atual (app/reset-password → pass; wizard/auth/onboarding/… → redirect `/dashboard`).
- [x] 4.4 Atualizar a **tabela de decisão** no topo de `src/middleware.ts` para refletir as duas sub-colunas de `active` (incompleto vs completo). (Consultar **Context7** para padrões de `middleware`/matcher do Next.js se necessário.)
- [x] 4.5 Testes de integração de middleware (`src/__tests__/integration/middleware/onboarding-wizard-gating.int.test.ts` ou novo arquivo): active+incompleto em `/dashboard` → redirect `/onboarding/welcome`; active+incompleto em `/onboarding/welcome` → pass (sem loop); skip (`step='done'`) em `/dashboard` → pass; active+completo em `/agenda` → pass.
- [x] 4.6 **Teste de auth negativo** (convenção #4 do CLAUDE.md): anon em `/onboarding/setup/profile` → `/login?redirectTo=...`; pending em rota do wizard → `/onboarding/pending`; suspended/cancelled → clear+redirect `/login`.

## 5. Wizard data-aware + `first_access_at` (Backend + Frontend)

- [ ] 5.1 Tornar `configureLocationImpl` (`src/modules/onboarding/server/configure-location.ts`) **idempotente**: se o owner já tem ≥1 local, não inserir outro — garantir `agenda_settings`, marcar passo satisfeito e avançar o cursor; só inserir quando não há local.
- [ ] 5.2 Teste de integração (real Postgres): conta com 1 local existente passa pelo passo 2 sem criar local duplicado e com `location_configured = TRUE` (cobre "An existing location is not duplicated" e o bug de conta reativada).
- [ ] 5.3 Tornar o resume data-aware (`src/modules/onboarding/server/resume-step.ts`): derivar o primeiro passo pendente de dados reais (`full_name` setado, ≥1 location, ≥1 active patient) além do cursor, e sincronizar `onboarding_step` idempotentemente (escrita absoluta).
- [ ] 5.4 Teste de integração: usuário com `onboarding_step='location'` e um local já criado em Configurações é roteado para `patients` (fast-forward) e o cursor é sincronizado.
- [ ] 5.5 Frontend `StepProfile`: pré-preencher `displayName` a partir de `profiles.full_name` (passar o valor atual do perfil como prop a partir de `src/app/(app)/onboarding/setup/[step]/page.tsx`).
- [ ] 5.6 Frontend `StepPatients`: reconhecer pacientes existentes como satisfazendo o passo (permitir avançar sem re-adicionar).
- [ ] 5.7 Unificar o leitor do passo "done": `StepDone`/`readSummary` passa a derivar de dados reais (mesma fonte do `recomputeChecklistImpl`) em vez dos flags armazenados em `src/app/(app)/onboarding/setup/[step]/page.tsx`.
- [ ] 5.8 Teste de integração: resumo do passo 4 reflete um local criado fora do wizard (paridade com o checklist do painel).
- [ ] 5.9 Mover `stampFirstAccess`: remover a chamada do `src/app/(app)/dashboard/page.tsx` e disparar (fire-and-forget, idempotente, `auth.uid()`) no render do wizard (`/onboarding/welcome/page.tsx` e, defensivamente, `setup/[step]/page.tsx`), reusando o helper do módulo `dashboard` via barrel.
- [ ] 5.10 Teste de integração: primeiro render do wizard com `first_access_at IS NULL` carimba `now()`; render subsequente não sobrescreve; o dashboard não carimba mais.

## 6. E2E e verificação final

- [ ] 6.1 E2E (Playwright seeded) do fluxo feliz: psicólogo recém-validado (active, onboarding incompleto) é levado a `/onboarding/welcome`, completa profile+location, e só então alcança `/dashboard` — sem banner de "configuração inicial" coexistindo com o checklist.
- [ ] 6.2 E2E: caminho "Pular e explorar" leva ao `/dashboard` (gate suave) com o checklist ainda nudificando e sem banner.
- [ ] 6.3 E2E de regressão: usuário reativado com local pré-existente não vê o passo de local pedir criação nem gera local duplicado.
- [ ] 6.5 `openspec validate "rework-onboarding-first-run"` permanece verde; conferir que `proposal`/`design`/`specs`/`tasks` estão coerentes com o implementado antes de `/opsx:archive`.
