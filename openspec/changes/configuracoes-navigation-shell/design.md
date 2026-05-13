## Context

Quatro features de configuração foram entregues em changes recentes (`agenda-foundation-and-sessions`, `agenda-settings`, `whatsapp-foundation-and-templates`, `whatsapp-reminders-engine`), cada uma com sua própria página sob `src/app/(app)/configuracoes/`:

- `/configuracoes/locais`
- `/configuracoes/integracoes/whatsapp`
- `/configuracoes/lembretes` (+ `/templates`, `/templates/[templateKey]`, `/historico`)
- `/configuracoes/agenda`

O sidebar principal (`src/app/(app)/sidebar-nav.tsx:33`) tem um único item `Configuracoes` com `href` hard-coded para `/configuracoes/locais`. Não existe `layout.tsx` nem `page.tsx` em `/configuracoes` — o usuário cai em "Locais" e fica preso ali. Acessar `/configuracoes` puro retorna 404.

Restrições que enquadram a decisão:

- **DS Sálvia (`docs/design-system/rules.md`)** — filosofia "Calmo antes de bonito", proibição de cards aninhados, glossário fixo ("Configurações" com cedilha), componentes `Card interactive`/`Tabs underline`/`Breadcrumb` já catalogados.
- **`docs/design-system/route-layout.md`** — toda página autenticada vive sob `(app)/`; layouts grupais não duplicam chrome do shell.
- **`CLAUDE.md`** — Server Components por padrão, push de `'use client'` apenas para folhas interativas.
- **Estado atual da nav**: `pathname.startsWith(item.href)` já cobre o active state para sub-rotas (validar com novo href `/configuracoes`).
- **Mobile-first** com sidebar overlay já implementado.

Stakeholder único: psicólogo autônomo. Frequência estimada de uso: poucas visitas/mês após onboarding (descoberta importa mais que velocidade).

## Goals / Non-Goals

**Goals:**

- Tornar as quatro áreas de configuração visíveis e descobríveis a partir do sidebar principal, sem dependência de URL manual.
- Aderir aos componentes e padrões já definidos no DS Sálvia — não inventar componente novo.
- Permitir que novas áreas (futuro: perfil, faturamento, segurança, telepsicologia, Receita Saúde) sejam adicionadas no índice sem revisão estrutural.
- Corrigir a inconsistência de microcopy do sidebar (`Configuracoes` → `Configurações`) por estar prevista no glossário fixo.
- Manter mobile-first: layout funciona bem em 375px sem overlay-em-overlay.

**Non-Goals:**

- Reorganizar a hierarquia interna de qualquer feature de settings (locais, WA, lembretes, agenda continuam com a mesma forma de dados, Server Actions e validações).
- Criar ou alterar capabilities de domínio (`whatsapp-*`, `agenda-*`).
- Entregar dark-mode novo — herda do que já existe.
- Adicionar busca, atalhos de teclado globais ou command palette.
- Implementar permissões/role-gating para esconder cards (todos os usuários autenticados veem todas as áreas).

## Decisions

### Decisão 1 — Padrão de navegação: índice com cards (não tabs, não sub-sidebar)

Avaliadas quatro alternativas contra o DS:

| Opção | Aderência DS | Escala | Mobile | Calmo |
|---|---|---|---|---|
| Sub-sidebar 240px à esquerda dentro de `/configuracoes` | ⚠️ Inventa "sidebar dentro de sidebar"; viola "consistência radical" | ✅ | ❌ overlay-em-overlay | ❌ duplica chrome |
| Tabs horizontais no topo | ✅ Tabs catalogada no DS | ❌ quebra >6 abas | ⚠️ scroll horizontal | ✅ |
| **Índice com cards + Breadcrumb** (escolhida) | ✅ Card interactive + Breadcrumb já no DS | ✅ ótimo | ✅ stack natural | ✅ |
| Híbrido (índice + sub-nav) | ✅ | ✅ | ⚠️ | ⚠️ mais elementos |

Escolhida a **terceira** por ser a única que (a) só usa padrões já catalogados no DS, (b) escala monotonicamente quando vierem novas seções, (c) é mobile-first sem precisar resolver overlay-em-overlay e (d) honra "Calmo antes de bonito" sem chrome adicional. A migração futura para "índice + sub-sidebar" (se ultrapassar ~10 seções) é não-traumática; o reverso seria.

### Decisão 2 — Tabs internas APENAS para subseções do mesmo conceito

Em `/configuracoes/lembretes`, há três sub-rotas existentes (`/`, `/templates`, `/historico`) que são **facetas do mesmo objeto** ("lembretes"). Aqui usar `Tabs` underline do DS é o ajuste correto, e não 3 cards-filhos no índice — porque (a) não polui o índice principal, (b) preserva o agrupamento conceitual e (c) `Tabs` é exatamente o componente DS para "facetas relacionadas".

Critério para futuras seções: só usar tabs internas quando as subseções forem variações do MESMO conceito (ex.: lista vs. histórico vs. template do mesmo recurso). Para áreas independentes, novo card no índice principal.

### Decisão 3 — Layout de grupo `(app)/configuracoes/layout.tsx` para o breadcrumb

O breadcrumb é horizontal-cross-cutting nas sub-rotas mas não pertence ao app-shell global (não faz sentido no `/dashboard`, `/pacientes` etc.). Solução: layout grupal em `src/app/(app)/configuracoes/layout.tsx` que renderiza:

```
<Breadcrumb> ... </Breadcrumb>
<main>{children}</main>
```

Isso herda do shell autenticado de `(app)/layout.tsx` sem duplicar header/sidebar. O breadcrumb lê `usePathname()` no client e mapeia segmentos para labels usando uma constante local (`{ '/configuracoes': 'Configurações', '/configuracoes/lembretes': 'Lembretes', ... }`). Para `/configuracoes` puro o breadcrumb é omitido (página índice).

Alternativa rejeitada: passar título via prop em cada page → quebra DRY e abre espaço para divergências entre páginas.

### Decisão 4 — Sidebar item: href `/configuracoes` (não `/configuracoes/locais`)

A versão atual pula o índice indo direto para `/locais`. Manter esse comportamento "salta para a primeira aba" combinado com cards no índice produz o pior dos dois mundos (usuário nunca vê o índice). O `href` passa a ser `/configuracoes`. O custo é "+1 clique" para o caso recorrente, aceitável dado o perfil de uso (poucas visitas/mês). O benefício é descoberta consistente.

`pathname.startsWith('/configuracoes')` continua marcando o item como ativo em qualquer sub-rota — comportamento atual já cobre.

### Decisão 5 — Cards do índice: dados estáticos no servidor, sem RSC fetch

O índice é uma lista fixa de áreas de settings. Não há por que buscar nada no banco. O `page.tsx` é um Server Component com a lista declarada inline (ou em um arquivo `lib/settings-areas.ts` co-localizado) — cada item tem `{ href, label, description, icon }`. Renderiza um grid de `Card` (interactive). Sem `'use client'`.

Estrutura proposta:

```
src/app/(app)/configuracoes/
  layout.tsx              # breadcrumb + <main> wrapper
  page.tsx                # índice (Server Component, grid de cards)
  breadcrumb-nav.tsx      # 'use client' (lê usePathname)
  settings-areas.ts       # constante: lista das áreas + label map para breadcrumb
  locais/                 # já existe
  integracoes/whatsapp/   # já existe
  lembretes/              # já existe (vira host de tabs)
    page.tsx              # vira host com Tabs (idle: "Configuração")
    templates/page.tsx    # tab "Templates"
    historico/page.tsx    # tab "Histórico"
  agenda/                 # já existe
```

### Decisão 6 — Tabs em `/lembretes`: navegação por URL (não state local)

As tabs são implementadas como `Link` estilizado com a aparência DS de `Tabs underline`, não como `Tabs` controlado por estado. Razões:
- Sub-rotas já existem com seus próprios `page.tsx` e Server Actions co-localizadas — manter cada uma como rota navegável preserva deep-link, refresh, back-button.
- Casa naturalmente com o breadcrumb (cada aba tem URL própria → breadcrumb sabe onde está).
- Active tab determinada por `pathname.startsWith` consistente com sidebar.

A "casca" do `/configuracoes/lembretes/layout.tsx` (novo) renderiza o cabeçalho da seção + a tab bar, e cada `page.tsx` renderiza só o conteúdo da sua aba.

### Decisão 7 — Microcopy dos cards

| Card | Label | Descrição (body-sm, ≤ 80 chars) | Ícone Lucide |
|---|---|---|---|
| Locais | "Locais de atendimento" | "Endereços e modalidades onde você atende presencial ou online." | `MapPin` |
| WhatsApp | "WhatsApp" | "Conecte sua conta do WhatsApp para enviar lembretes e mensagens." | `MessageCircle` |
| Lembretes | "Lembretes" | "Personalize quando e como avisar pacientes sobre suas sessões." | `Bell` |
| Agenda | "Agenda" | "Horários de trabalho, duração padrão e regras de agendamento." | `Calendar` |

Todos seguem o glossário fixo do DS. Verbos no infinitivo, sem emojis, tom direto.

## Risks / Trade-offs

- **[Risk] Usuário recorrente reclama do "+1 clique" para chegar em uma settings específica.** → Mitigação: monitorar feedback após release; se virar dor real, adicionar atalho via "ações rápidas" no header sem mudar a estrutura. Custo de reverter para "sidebar pula direto" é trivial (1 linha).
- **[Risk] Tabs em `/lembretes` ficam apertadas em mobile (3 abas + chrome).** → Mitigação: usar `overflow-x-auto` no container das tabs com `scrollbar-hide`, padrão recomendado pelo DS para tab bar em mobile. Cada tab >= 44×44px (a11y).
- **[Risk] Breadcrumb fica fora de lugar em sub-rotas profundas como `/lembretes/templates/[templateKey]`.** → Mitigação: o map de labels já contempla esse caso; segmento dinâmico (`[templateKey]`) renderiza com label "Editar template" (genérico) ou o nome do template se passado via prop pelo page (pode ficar como follow-up).
- **[Risk] Mudar `href` do sidebar quebra bookmarks de usuários que salvaram `/configuracoes/locais`.** → Não-mitigado e aceitável — `/configuracoes/locais` continua válida e funcional; só o ponto de entrada muda. Bookmarks antigos seguem funcionando.
- **[Trade-off] Cards do índice não mostram estado (ex.: "WhatsApp desconectado", "0 lembretes ativos").** → Decisão consciente: estado pertence à sub-página, não ao índice. Adicionar badges de status nos cards aumentaria fetch + acoplamento. Já existe `WhatsAppHealthBanner` global para o caso crítico.
- **[Trade-off] Decisão 6 (tabs como Links) significa um full route change ao trocar de aba, não um swap client-side instantâneo.** → Ganho: deep-link, back-button, paridade com Server Actions co-localizadas. Custo: navegação um pouco menos fluida. Aceitável para essas três sub-rotas.

## Migration Plan

Não há migração de dados. Sequência de deploy:

1. Adicionar `breadcrumb` shadcn (`npx shadcn-ui@latest add breadcrumb`).
2. Criar `(app)/configuracoes/layout.tsx`, `(app)/configuracoes/page.tsx`, `(app)/configuracoes/breadcrumb-nav.tsx`, `(app)/configuracoes/settings-areas.ts`.
3. Criar `(app)/configuracoes/lembretes/layout.tsx` com tab bar; ajustar pages internas para conviver com layout (remover headers duplicados se houver).
4. Atualizar `sidebar-nav.tsx`: label e href do item de Configurações.
5. Cobrir com E2E o fluxo `sidebar → índice → cada seção → voltar via breadcrumb` (adicionar à suíte seeded).

Rollback: revert do PR. Como não há mudança de schema/API, rollback é instantâneo. URLs antigas (`/configuracoes/locais` etc.) seguem funcionando independentemente.

## Open Questions

1. **Breadcrumb dinâmico em `/lembretes/templates/[templateKey]`** — usar label genérico "Editar template" no v1 e enriquecer depois (com chave/nome do template) em follow-up?
2. **Quando aparecer a próxima área de settings** (ex.: "Perfil profissional"), entra como card adicional sem revisão. Confirmado que não há roadmap iminente exigindo agrupamento (ex.: "Conta", "Clínica", "Integrações")?
3. **Cards disabled/condicionais** — Lembretes depende de WhatsApp conectado para funcionar de fato. Decisão atual: card sempre habilitado, página interna educa se não houver conta WA. Ok? (Mantém DS "Calmo" e evita tooltip para info crítica, que é proibido.)
