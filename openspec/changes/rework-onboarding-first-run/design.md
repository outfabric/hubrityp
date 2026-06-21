## Context

Hoje, ao ter o CRP validado (`profiles.status = 'active'`), o psicólogo é redirecionado de `/onboarding/pending` para `/dashboard` (`middleware.ts` → ramo `Active`, `reason: 'active-already-in'`). O wizard de configuração inicial (`/onboarding/welcome` → `/onboarding/setup/{profile,location,patients,done}`) existe mas **nunca é forçado**: está na classe de path `'app'` (via `APP_PREFIXES`), então um usuário `active` simplesmente passa. Resultado: o usuário cai no painel com **dois nudges redundantes** — o `UnfinishedSetupBanner` (layout do app) e o `ChecklistSlot` ("Primeiros passos").

Três sistemas paralelos governam o primeiro acesso:

1. **Middleware (Edge).** `getCurrentProfileEdge` já carrega `onboarding_step`, `onboarding_completed_at`, `first_access_at` e `tour_completed_at` (`get-profile-edge.ts`). `classifyPath()` + `decideWithProfile()` decidem pass/redirect.
2. **Wizard (cursor linear).** Avança por `profiles.onboarding_step`; `resumeOnboardingStepImpl` resolve o passo **somente** pelo cursor, cego a dados reais. `configureLocationImpl` faz **INSERT incondicional** de local. O passo "done" lê os **flags armazenados** (`readOnboardingChecklistSummary`).
3. **Checklist do painel (recompute).** `recomputeChecklistImpl` re-deriva cada item de **dados reais** (`locations`, `patients`, `profiles`…) a cada render e sobrescreve o cache `onboarding_checklist`.

O tour guiado (Driver.js) é um quarto sistema, isolado: componente client `dynamic ssr:false`, coluna `profiles.tour_completed_at`, action `completeTour`, âncoras `data-tour-anchor`, replay em Configurações → Ajuda. Decidiu-se que é inútil e será removido.

Restrições do projeto (CLAUDE.md): middleware roda na **Edge** (sem deps Node — daí `registration/edge.ts`); toda tabela tem RLS + policies por operação; mudanças em `classifyPath()` exigem teste de auth negativo no mesmo PR; `shared/` não importa de `modules/`; specs por domínio com `tables.ts` + `policies.ts` + `index.ts`.

## Goals / Non-Goals

**Goals:**
- Redirecionar o usuário `active` com onboarding incompleto para `/onboarding/welcome` em vez do painel, sem loop de redirect.
- Manter o gate **suave**: `onboarding_step === 'done'` OU `onboarding_completed_at != null` libera o painel; o atalho "Pular" continua funcionando.
- Tornar o wizard **data-aware** para que dado preenchido em qualquer superfície conte na outra e nunca seja pedido/duplicado duas vezes.
- Remover o tour por completo, incluindo o drop da coluna `tour_completed_at`.
- Preservar a âncora do NPS dia-7 movendo `stampFirstAccess` para o primeiro destino real (o wizard).

**Non-Goals:**
- Tornar o gate **rígido** (não removeremos o "Pular"; não exigiremos `completed_at` para liberar).
- Mudar a barra de conclusão do wizard: continua **profile + location** (pacientes opcional).
- Preservar `redirectTo` em deep links: ao concluir, o destino é sempre `/dashboard`.
- Reescrever o checklist do painel: ele já recomputa de dados reais e permanece como tracker de ativação.
- Alterar o fluxo de validação de CRP / transições de `ProfileStatus`.

## Decisions

### D1 — Classe de path própria para o wizard (evitar loop)
O wizard (`/onboarding/welcome`, `/onboarding/setup`) sai de `APP_PREFIXES` e ganha uma classe própria em `classifyPath()` (ex.: `'onboarding-wizard'`). Sem isso, "app incompleto → redirect para o wizard" se auto-redirecionaria (o wizard é `'app'`), gerando loop.
- **Alternativa considerada:** special-case por `pathname.startsWith('/onboarding/welcome'|'/onboarding/setup')` dentro do ramo `Active`. Rejeitada: espalha a lógica de roteamento fora de `classifyPath()`, contra a convenção de funilar a classificação num único ponto.
- **Impacto:** `PathClass` ganha um membro; os pontos que tratam `'app'` (linhas que hoje fazem `pathClass === 'app' || …`) precisam decidir explicitamente o comportamento da nova classe para **todos** os status (anon → `/login?redirectTo=`, pending → `/onboarding/pending`, suspended/cancelled → clear+redirect), preservando o comportamento atual desses status.

### D2 — Split do ramo `Active` por conclusão do onboarding
`decideWithProfile`, caso `ProfileStatus.Active` (após o guard de `requiresPasswordReset`, que tem prioridade e permanece intocado), passa a ramificar:

```
onboardingComplete = onboarding_step === 'done' || onboarding_completed_at != null

se NÃO completo:
  classe 'onboarding-wizard' | 'reset-password'         → pass
  classe 'app' | 'onboarding' | 'auth'
        | 'complete-profile' | 'link-account'           → redirect /onboarding/welcome  (reason: 'active-onboarding-incomplete')
  default                                                → pass
se completo (comportamento atual):
  classe 'app' | 'reset-password'                        → pass
  classe 'onboarding-wizard' | 'auth' | 'onboarding'
        | 'forgot-password' | 'link-account'
        | 'complete-profile'                             → redirect /dashboard (reason: 'active-already-in')
  default                                                → pass
```
- A condição é avaliada **na Edge** com campos já presentes no `Profile` — **zero mudança na camada de dados**.
- `forgot-password` permanece `pass` (usuário pode trocar senha voluntariamente), como hoje.
- Atualizar a **tabela de decisão** no topo de `middleware.ts` para refletir as duas sub-colunas de `active`.

### D3 — Mover `stampFirstAccess` para o wizard
`stampFirstAccess` (idempotente, fire-and-forget, só escreve se `first_access_at IS NULL`) migra do render de `/dashboard/page.tsx` para o primeiro destino real do usuário. Como o gate envia o usuário para `/onboarding/welcome`, o carimbo passa a ser disparado no render dessa página (e, defensivamente, também no `setup/[step]`), preservando a âncora do NPS dia-7 no verdadeiro "primeiro acesso autenticado".
- **Alternativa:** carimbar no middleware. Rejeitada: middleware Edge não deve fazer escrita de domínio via Drizzle (Node-only); manter o carimbo num Server Component é coerente com o padrão atual.
- O `stampFirstAccess` permanece reutilizável a partir do módulo `dashboard` (o wizard importa do barrel; não há violação `shared`→`modules`).

### D4 — Wizard data-aware: resume por dados reais + idempotência
O princípio: **fonte de verdade = linhas reais de domínio**; o cursor `onboarding_step` deixa de ser a única autoridade.
- **Resume com fast-forward:** ao resolver o passo de retomada, além do cursor, consultar as mesmas sondagens de existência do recompute (`≥1 location`, `≥1 active patient`, `full_name` presente). Um passo cujo dado real já existe é considerado satisfeito e o usuário é avançado para o próximo passo pendente. Implementação preferida: uma função server-side que deriva o "primeiro passo pendente" de dados reais e **sincroniza `onboarding_step`** (escrita idempotente), mantendo o cursor como cache coerente em vez de fonte divergente.
- **Profile:** `StepProfile` recebe o `full_name` atual como valor inicial de `displayName` (confirma, não re-digita). Persiste via UPDATE (sem duplicação por natureza).
- **Location idempotente:** `configureLocationImpl` passa a verificar existência de local do owner antes de inserir. Se já existe ≥1 local, **não cria outro**: trata o passo como satisfeito e avança o cursor (mantendo o `agenda_settings` garantido). Corrige a duplicação em conta reativada.
  - **Alternativa:** transformar em "editar o local existente". Rejeitada para o MVP: adiciona UI de seleção/edição; o objetivo é não duplicar nem re-pedir — avançar é suficiente. (Edição de locais já existe em `/configuracoes/locais`.)
- **Patients:** já é opcional; quando há pacientes, o passo os reconhece como satisfeitos e permite avançar sem re-adicionar.

### D5 — Unificar o leitor do passo "done" com o recompute
O `StepDone` deixa de ler os flags armazenados (`readOnboardingChecklistSummary`) e passa a derivar de **dados reais** (mesma fonte do `recomputeChecklistImpl`), eliminando a divergência entre as duas superfícies. O cache `onboarding_checklist` continua existindo, mas nenhuma decisão de UI passa a depender de flag potencialmente defasada.

### D6 — Remoção do tour + drop da coluna `tour_completed_at`
- **Código:** deletar `dashboard-tour.tsx`, `dashboard-tour-impl.tsx`, `lib/tour-steps.ts`, `server/complete-tour.ts`, `replay-tour-button.tsx`; remover exports do barrel `onboarding/index.ts`, o render em `dashboard/page.tsx`, a action em `dashboard/actions.ts`, o uso em `ajuda/primeiros-passos`, as 5 âncoras `data-tour-anchor` e a dep `driver.js` do `package.json`.
- **Schema/migration:** remover `tourCompletedAt` de `auth/tables.ts`, do select e do mapeamento em `get-profile-edge.ts`. Gerar a migration com `drizzle-kit generate` (o diff emite `ALTER TABLE "profiles" DROP COLUMN "tour_completed_at"`) e aplicar via `npm run db:migrate`. A coluna é nullable e sem FK/policy dedicada → drop direto, sem backfill. RLS da `profiles` não referencia a coluna, então as policies não mudam.
  - **Alternativa:** manter a coluna inerte. Rejeitada pelo usuário (limpeza completa; evita dado morto no select edge).
- **Specs:** remover `openspec/specs/onboarding-tour/` (delta com `## REMOVED Requirements`) e a menção em `dashboard-home`.

### D7 — Sequenciamento de testes (tasks.md)
Cada bloco de teste (unit/integração/E2E) é redigido **imediatamente após** a alteração de código que o motiva, não agrupado no fim — para o agente fullstack manter o contexto da mudança. Refletido na ordenação de `tasks.md`.

## Risks / Trade-offs

- **[Loop de redirect na Edge]** Se a nova classe do wizard não passar para `active` incompleto, ou se `/onboarding/welcome` for classificado como `'app'`, há loop infinito. → Mitigação: teste de integração de middleware cobrindo `active + incompleto` em `/dashboard` (redirect uma vez) e em `/onboarding/welcome` (pass); manter `/onboarding/welcome` como destino dentro da própria classe `'onboarding-wizard'`.
- **[Gate suave é escapável]** Com gate suave, "Pular" leva ao painel com checklist incompleto. → Aceito por decisão de produto; o checklist do painel continua nudificando. Documentado como Non-Goal.
- **[Drift cursor × dados reais]** Sincronizar `onboarding_step` a partir de dados reais pode conflitar com submissões concorrentes (duas abas). → Mitigação: escritas idempotentes e absolutas (set do passo-alvo, não incremento), padrão já usado em `saveOnboardingStepImpl`/`configureLocationImpl`.
- **[Regressão de auth nos status não-active]** Tirar o wizard de `APP_PREFIXES` muda a classe para **todos** os status. → Mitigação: a nova classe deve reproduzir, para anon/pending/suspended/cancelled, exatamente o que `'app'` fazia (anon → `/login?redirectTo=`, pending → `/onboarding/pending`, etc.); cobrir com os casos existentes de `onboarding-wizard-gating.int.test.ts` + teste de auth negativo.
- **[Migration destrutiva irreversível]** Drop de coluna apaga dados de `tour_completed_at`. → Aceito: é timestamp de UI, não PII clínica; rollback do código não recria os dados, mas a coluna pode ser readicionada por nova migration se necessário (sem valor de negócio).
- **[Âncora do NPS desloca]** Mover `stampFirstAccess` muda quando `first_access_at` é carimbado (agora no wizard, não no painel). → Efeito desejado: o "primeiro acesso" passa a ser o verdadeiro primeiro destino; a janela do NPS dia-7 fica mais fiel.

## Migration Plan

1. **Schema/dados:** remover `tourCompletedAt` do schema + `get-profile-edge`; `drizzle-kit generate` → revisar o `DROP COLUMN`; aplicar com `npm run db:migrate`. Deploy da migration antes/junto do código que deixa de ler a coluna (o select edge não pode referenciar coluna inexistente).
2. **Middleware:** nova classe + split do ramo `Active` + tabela de decisão; testes de gating.
3. **Wizard:** resume data-aware, `StepProfile` pré-preenchido, `configureLocationImpl` idempotente, `StepDone` via recompute, `stampFirstAccess` no wizard; testes por bloco.
4. **Tour:** remoção de componentes/action/âncoras/dep + specs; remoção das suites de tour e ajustes de seeds.
5. **Rollback:** reverter o PR restaura o código; a coluna dropada não retorna automaticamente (sem impacto funcional). Nenhuma feature flag necessária — a mudança é de roteamento e remoção, não de dado clínico.

## Open Questions

- Nenhuma pendente. Todas as decisões de produto (gate suave, mínimo profile+location, deep links → `/dashboard`, mover `first_access`, drop da coluna, escopo combinado) foram resolvidas na exploração.
