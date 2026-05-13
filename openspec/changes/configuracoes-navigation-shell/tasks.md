## 1. Setup e dependências

- [ ] 1.1 Instalar componente `breadcrumb` do shadcn (`npx shadcn-ui@latest add breadcrumb`) e confirmar que o arquivo gerado em `src/shared/ui/breadcrumb.tsx` usa os tokens do DS (sem cores hardcoded)
- [ ] 1.2 Confirmar que o componente `tabs` shadcn ainda NÃO é necessário (decisão: tabs como `<Link>` estilizados, não componente shadcn)
- [ ] 1.3 Verificar com `grep` que o ícone `Settings` da Lucide já é importado em `src/app/(app)/sidebar-nav.tsx` (já está, conforme leitura do arquivo)

## 2. Fonte de dados da navegação de settings

- [ ] 2.1 Criar `src/app/(app)/configuracoes/settings-areas.ts` exportando uma constante `SETTINGS_AREAS` (array readonly) com `{ href, label, description, icon }` para as quatro áreas, usando os labels exatos e ícones do Decisão 7 do design (Locais → `MapPin`, WhatsApp → `MessageCircle`, Lembretes → `Bell`, Agenda → `Calendar`)
- [ ] 2.2 No mesmo arquivo, exportar `SETTINGS_BREADCRUMB_LABELS` (record) mapeando segmentos/paths para labels exibidos no breadcrumb — incluindo segmentos colapsáveis como `integracoes` (que não vira label visível, só prefixo) e segmentos dinâmicos (`templates/[templateKey]` → "Editar template")
- [ ] 2.3 Adicionar testes unitários (`__tests__/unit/app/configuracoes/settings-areas.test.ts`) cobrindo: (a) shape e ordem das áreas, (b) que todos os hrefs declarados existem como rotas (snapshot do array), (c) que o map de breadcrumb cobre todos os paths usados nas áreas

## 3. Página índice de Configurações

- [ ] 3.1 Criar `src/app/(app)/configuracoes/page.tsx` como Server Component (sem `'use client'`), renderizando h1 "Configurações" (token h1 / 28px / weight 600) e um grid CSS responsivo: 1 col `<sm`, 2 cols `sm-lg`, 3 cols `lg+`
- [ ] 3.2 Renderizar cada item de `SETTINGS_AREAS` como `Card interactive` do DS, com ícone (size 24, `text-text-secondary`), h3 com label, body-sm com descrição em `text-text-secondary`; o card inteiro é um `<Link>` cobrindo a área toda
- [ ] 3.3 Garantir tap target ≥ 44×44px em mobile e `aria-label` consistente nos links de card (ex.: "Abrir configurações de WhatsApp")
- [ ] 3.4 Adicionar `data-testid="settings-index-page"` no container raiz e `data-testid="settings-card-<slug>"` em cada card (slug derivado do label, ex.: `settings-card-locais`, `settings-card-whatsapp`, `settings-card-lembretes`, `settings-card-agenda`)

## 4. Layout de grupo + breadcrumb

- [ ] 4.1 Criar `src/app/(app)/configuracoes/layout.tsx` como Server Component que renderiza o `<BreadcrumbNav />` (client) acima de `{children}` e respeita `max-w-[1200px] mx-auto` (token de largura geral do DS)
- [ ] 4.2 Criar `src/app/(app)/configuracoes/breadcrumb-nav.tsx` como Client Component (`'use client'`), lendo `usePathname()` e derivando a trilha a partir de `SETTINGS_BREADCRUMB_LABELS`; renderizar via o componente `breadcrumb` shadcn com `aria-label="breadcrumb"`
- [ ] 4.3 A trilha deve omitir-se na rota `/configuracoes` (índice) e renderizar a trilha completa em todas as sub-rotas, colapsando segmentos sem label (ex.: `integracoes`)
- [ ] 4.4 Último segmento renderiza como não-link com `text-text-primary`; intermediários como `<Link>` em `text-text-tertiary` com hover `text-text-primary`
- [ ] 4.5 Adicionar `data-testid="settings-breadcrumb"` no `<nav>` do breadcrumb e `data-testid="breadcrumb-segment-<n>"` em cada segmento

## 5. Tabs internas em Lembretes

- [ ] 5.1 Criar `src/app/(app)/configuracoes/lembretes/layout.tsx` como Server Component que renderiza o `<LembretesTabsNav />` (client) e abaixo `{children}` — o layout substitui o h1 "Configuracoes de Lembretes" hoje em `page.tsx`
- [ ] 5.2 Criar `src/app/(app)/configuracoes/lembretes/tabs-nav.tsx` como Client Component (`'use client'`), renderizando três tabs `<Link>` com a aparência DS `Tabs underline` (idle: `text-text-secondary`; active: `text-text-primary` + `border-b-2 border-brand-500`; padding `space-3 space-4`)
- [ ] 5.3 Active determinada por matching mais específico de `pathname.startsWith` (templates ganha de lembretes); container com `overflow-x-auto` para viewports < 640px e cada tab >= 44×44px
- [ ] 5.4 Remover/ajustar o h1 redundante em `src/app/(app)/configuracoes/lembretes/page.tsx` (não duplicar o breadcrumb tail); manter o conteúdo da aba "Configuração" como o que já existe lá
- [ ] 5.5 Adicionar `data-testid="lembretes-tabs"` no nav das tabs e `data-testid="lembretes-tab-<slug>"` em cada tab (`configuracao`, `templates`, `historico`)

## 6. Ajustes nas páginas existentes

- [ ] 6.1 Em `src/app/(app)/configuracoes/locais/page.tsx`: garantir que o h1 "Locais de Atendimento" continue presente (não duplica breadcrumb tail; é a única wayfinding da seção)
- [ ] 6.2 Em `src/app/(app)/configuracoes/integracoes/whatsapp/page.tsx`: garantir que o h1 da seção use a cedilha correta ("Configurações") onde aplicável; revisar para não conflitar com o breadcrumb
- [ ] 6.3 Em `src/app/(app)/configuracoes/agenda/page.tsx`: corrigir cedilha em strings visíveis ao usuário ("Configurações da Agenda") onde se aplicar
- [ ] 6.4 Em `src/app/(app)/configuracoes/lembretes/templates/page.tsx` e `historico/page.tsx`: garantir que h1 (se houver) não duplique tab + breadcrumb

## 7. Sidebar nav

- [ ] 7.1 Em `src/app/(app)/sidebar-nav.tsx`, atualizar o item de configurações: `label: 'Configurações'` (cedilha), `href: '/configuracoes'` (índice)
- [ ] 7.2 Verificar que `pathname.startsWith(item.href)` continua marcando o item como ativo em todas as sub-rotas de `/configuracoes/*` (testar manualmente com cada sub-rota)

## 8. Testes E2E

- [ ] 8.1 Adicionar teste E2E seeded em `__tests__/e2e/seeded/configuracoes-navigation.spec.ts` cobrindo o fluxo: login → click no item "Configurações" do sidebar → assert URL = `/configuracoes` → assert que os 4 cards aparecem
- [ ] 8.2 Cobrir, no mesmo arquivo, navegação para cada uma das 4 seções via card e volta para o índice via link "Configurações" do breadcrumb
- [ ] 8.3 Cobrir, ainda no mesmo arquivo, o fluxo de tabs em Lembretes: entrar em `/configuracoes/lembretes`, clicar em "Templates" → assert URL e tab ativa, clicar em "Histórico" → assert, voltar no browser → assert volta para Templates
- [ ] 8.4 Cobrir o breadcrumb em `/configuracoes/lembretes/templates`: verificar trilha "Configurações > Lembretes > Templates" e funcionamento dos links intermediários

## 9. Testes de a11y e responsivos

- [ ] 9.1 Validar com Playwright em viewport 375×667 que: (a) o grid do índice fica em 1 coluna, (b) o tab bar de Lembretes scrolla horizontalmente, (c) tap targets >= 44×44 nos cards e nas tabs
- [ ] 9.2 Validar navegação por teclado: Tab passa por cada card do índice em ordem, Enter ativa o link; Tab passa pelas tabs em Lembretes, Enter navega; foco visível em todos (ring `shadow-focus`)
- [ ] 9.3 Validar `prefers-reduced-motion`: nenhuma transição supera 200ms no shell de settings (já default via DS); confirmar visualmente

## 10. Verificação final

- [ ] 10.1 Rodar `npm run lint`, `npm run type-check` — zero erros
- [ ] 10.2 Rodar suíte unit + integration relevantes (`vitest run`)
- [ ] 10.3 Rodar suíte E2E seeded localmente — todos verdes
- [ ] 10.4 Smoke manual em dark mode: cards, breadcrumb e tabs respeitam tokens dark (sem cores travadas)
- [ ] 10.5 Confirmar com `grep -r "Configuracoes" src/` que não há mais ocorrências da grafia sem cedilha em código visível ao usuário (strings em testes podem usar a forma renderizada com cedilha)
- [ ] 10.6 Rodar `openspec verify --change configuracoes-navigation-shell` (ou equivalente) — sem warnings de cobertura
