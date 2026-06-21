## Why

Após o CRP ser validado, o psicólogo cai direto no painel, onde recebe **dois nudges simultâneos e redundantes** de configuração — o banner "Você ainda não terminou a configuração inicial" e a seção "Primeiros passos (X% concluído)" — enquanto o wizard de configuração inicial nunca é forçado e é facilmente ignorado. Em paralelo, o tour guiado (Driver.js) provou-se inútil e só adiciona peso, e wizard e checklist coletam as mesmas informações (perfil, local, paciente) por caminhos diferentes, criando risco de re-preenchimento e de dados duplicados (ex.: segundo local em conta reativada). Esta change consolida o primeiro acesso: leva o usuário recém-validado para a configuração inicial antes do painel, remove o tour, e garante que cada informação preenchida em um lugar conte no outro.

## What Changes

**Eixo A — Gating: redirecionar para a configuração inicial (em vez do painel)**
- O middleware passa a redirecionar um usuário `active` com onboarding **incompleto** para `/onboarding/welcome`, em vez de liberar `/dashboard` e demais rotas do app.
- Gate **suave**: o onboarding é considerado concluído quando `onboarding_step === 'done'` **OU** `onboarding_completed_at IS NOT NULL`. O atalho "Pular e explorar" é preservado (marca `done` e abre o portão).
- O wizard (`/onboarding/welcome`, `/onboarding/setup/*`) ganha uma **classe de path própria** no `classifyPath()` (removido de `APP_PREFIXES`) para que o redirect não entre em loop; o ramo `Active` de `decideWithProfile()` é dividido em "onboarding incompleto → wizard" / "completo → comportamento atual".
- `stampFirstAccess` (âncora do NPS dia-7) **move** do render de `/dashboard` para o wizard, já que o painel deixa de ser o primeiro destino.
- Consequência (sem código novo): o `UnfinishedSetupBanner` deixa de aparecer no painel, pois ao chegar lá o onboarding já está `done`/completo.

**Eixo B — Remoção do tour inicial (Driver.js)**
- **BREAKING (UX):** remoção completa do tour guiado e do controle "Refazer tour" em Configurações → Ajuda.
- Remove componentes (`dashboard-tour*`), catálogo de passos (`tour-steps`), Server Action (`complete-tour`), botão de replay, as 5 âncoras `data-tour-anchor` e a dependência `driver.js`.
- **BREAKING (schema):** drop da coluna `profiles.tour_completed_at` via migration Drizzle (removida do schema, do select edge e do tipo `Profile`).

**Eixo C — Consistência wizard ↔ checklist ("preencher uma vez, conta nos dois")**
- O wizard passa a ser **data-aware**: o ponto de retomada faz *fast-forward* dos passos cujo dado real já existe; `StepProfile` pré-preenche `displayName` a partir de `profiles.full_name`; o passo de pacientes reconhece pacientes existentes.
- O passo de local torna-se **idempotente**: nunca faz INSERT cego quando já existe ≥1 local (corrige a duplicação em conta reativada).
- Fonte de verdade única = linhas reais de domínio. O leitor do passo "done" do wizard é unificado para derivar de dados reais (recompute), eliminando a divergência entre os flags armazenados e o checklist do painel.

**Testes**
- Cobertura unitária / integração / E2E para cada eixo (gating do middleware com teste de auth negativo; remoção do tour; idempotência e data-awareness do wizard), seguindo o princípio de escrever o teste imediatamente após a alteração que o motiva.

## Capabilities

### New Capabilities
<!-- Nenhuma capability nova: a change reorganiza e remove comportamento existente. -->

### Modified Capabilities
- `middleware-gating`: novo requisito de redirecionar `active` + onboarding incompleto para o wizard (com classe de path própria do wizard para evitar loop); usuário `active` completo mantém o comportamento atual.
- `onboarding-wizard`: passos data-aware (pré-preenchimento e fast-forward de passos já satisfeitos por dados reais), passo de local idempotente, e `stampFirstAccess` realizado ao entrar no wizard.
- `onboarding-checklist`: dados reais (recompute) declarados como fonte única compartilhada por wizard e painel; o banner de configuração inicial deixa de coexistir com o checklist no painel.
- `onboarding-data-model`: remoção da coluna `tour_completed_at` do modelo `profiles`.
- `onboarding-tour`: **capability REMOVIDA** — o tour guiado deixa de existir (todos os requisitos removidos).
- `dashboard-home`: remoção do render do tour; `first_access` deixa de ser carimbado no painel; banner de configuração inicial não é mais necessário no painel.

## Impact

**Frontend**
- `src/app/(app)/dashboard/page.tsx` (remove `<DashboardTour>`, remove `stampFirstAccess`), `src/app/(app)/dashboard/actions.ts` (remove `completeTour`).
- `src/app/(app)/onboarding/welcome/page.tsx` e `src/app/(app)/onboarding/setup/[step]/page.tsx` (pré-preenchimento, fast-forward, carimbo de first_access), componentes `StepProfile`/`StepLocation`/`StepPatients`.
- `src/app/(app)/configuracoes/ajuda/primeiros-passos/*` (remove `ReplayTourButton`).
- Remoção das âncoras `data-tour-anchor` em `sidebar-nav.tsx` e nas seções do dashboard.
- Componente `UnfinishedSetupBanner` (passa a nunca renderizar no painel por consequência do gating).

**Backend / Edge**
- `src/middleware.ts` (tabela de decisão, `classifyPath()`, `decideWithProfile()`).
- `src/modules/onboarding/server/*` (`resume-step`, `configure-location` idempotente, `save-onboarding-step`, leitor do "done"); remoção de `complete-tour.ts`.
- `src/modules/registration/server/get-profile-edge.ts` e `src/modules/registration/lib/profile.ts` (remoção de `tour_completed_at`).
- `src/modules/dashboard/server/stamp-first-access.ts` (reuso a partir do wizard).

**Dados**
- `src/shared/db/schema/auth/tables.ts` + nova migration Drizzle: drop de `profiles.tour_completed_at`.

**Dependências**
- Remoção de `driver.js` (`package.json`).

**Specs / Testes**
- Remoção de `openspec/specs/onboarding-tour/` e ajustes em `dashboard-home`.
- Suites afetadas: `onboarding-wizard-gating.int.test.ts`, testes de tour (`tour-steps.test.ts`, `complete-tour.int.test.ts`, `tour.spec.ts` — removidos), seeds e2e (`global-setup.ts`, `seed-state.ts`), `data-model.int.test.ts`.
