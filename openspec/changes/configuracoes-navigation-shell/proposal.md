## Why

As features de configurações (locais de atendimento, integração WhatsApp, lembretes, agenda) já estão implementadas como rotas em `/configuracoes/*`, mas o usuário não consegue navegar entre elas pela UI: o item "Configuracoes" do sidebar leva direto para `/configuracoes/locais` e, uma vez lá, não há nenhum elemento visual que permita acessar as outras seções (integrações, lembretes, agenda) sem digitar URL na mão. As features estão prontas mas invisíveis ao usuário.

## What Changes

- Adicionar página índice em `/configuracoes` que lista as quatro áreas de configuração como cards navegáveis (`Card interactive` do DS), seguindo o padrão "Calmo antes de bonito" (mobile-first, sem chrome adicional).
- Adicionar breadcrumb persistente (`Configurações > <seção> [> <subseção>]`) em todas as páginas sob `/configuracoes/*`, usando o componente `breadcrumb` do shadcn previsto no DS.
- Adicionar tabs internas (DS `Tabs` underline) na página `/configuracoes/lembretes` para alternar entre as facetas relacionadas do mesmo conceito: configuração geral, templates e histórico — substituindo a navegação atual por URL direta.
- **BREAKING (UI)**: Sidebar principal — corrigir o label `Configuracoes` para `Configurações` (glossário fixo do DS) e trocar o `href` de `/configuracoes/locais` para `/configuracoes` (a nova página índice).
- Garantir que o item "Configurações" do sidebar continue marcado como ativo em qualquer rota sob `/configuracoes/*` (comportamento atual `pathname.startsWith` já cobre, validar).
- Página índice e cards seguem mobile-first: 1 coluna `<sm`, 2 colunas `sm-lg`, 3 colunas `lg+`.

## Capabilities

### New Capabilities

- `settings-shell`: Estrutura de navegação para a área de configurações — página índice com cards, breadcrumb persistente em sub-rotas e padrão de tabs internas para subseções relacionadas. Aplica os tokens, componentes e microcopy do DS Sálvia. Não altera o comportamento das settings em si (locais, WA, lembretes, agenda) — apenas as torna acessíveis e descobríveis.

### Modified Capabilities

- `app-shell`: O item "Configurações" do sidebar tem seu label corrigido (cedilha) e seu `href` apontado para a nova página índice `/configuracoes`. O comportamento de active state (border-left brand-500 + bg brand-50 + text brand-700) permanece e MUST cobrir todas as sub-rotas de `/configuracoes/*`.

## Impact

- **Código afetado**:
  - `src/app/(app)/sidebar-nav.tsx` — label e href do item de configurações.
  - `src/app/(app)/configuracoes/page.tsx` (novo) — índice com cards.
  - `src/app/(app)/configuracoes/layout.tsx` (novo) — breadcrumb persistente nas sub-páginas.
  - `src/app/(app)/configuracoes/lembretes/page.tsx` + `templates/page.tsx` + `historico/page.tsx` — adoção do padrão de tabs internas (provavelmente por composição/refatoração leve, sem mudar lógica de dados).
- **Componentes shadcn/ui**: precisará instalar `breadcrumb` (e confirmar que `tabs` já está disponível).
- **Sem impacto em backend**: nenhuma Server Action, schema ou RLS é alterado. Apenas UI/navegação.
- **Sem impacto em testes existentes**: testes E2E que entram via URL direta (`/configuracoes/locais` etc.) continuam funcionando. Novos E2E cobrem o fluxo de descoberta via sidebar → índice → seção.
- **Microcopy/glossário**: alinha com a regra "Configurações" (não "preferências", não sem cedilha) já estabelecida no DS.
- **Acessibilidade**: breadcrumb com `aria-label="breadcrumb"`; cards com área clicável >=44×44px em mobile; navegação por teclado completa nas tabs.
