## Context

Os pontos de entrada da integração WhatsApp (lembretes) já estão visíveis na UI, mas o recurso não está funcional. Precisamos congelá-los com sinalização "Em breve" e poder religá-los apenas mudando uma variável de ambiente.

Estado atual (verificado no código):

- **Menu lateral** — `src/app/(app)/sidebar-nav.tsx` é um **client component** (`'use client'`). Os itens vêm de um array estático `navItems: readonly NavItem[]`. O item "Caixa de entrada" já tem a flag `showUnreadBadge` e renderiza `<Badge variant="danger">` com o contador. Item ativo usa classes `brand-*`; não existe estado `disabled` hoje.
- **Configurações (nível 1)** — `src/app/(app)/configuracoes/settings-areas.ts` exporta `SETTINGS_AREAS` (inclui "WhatsApp" e "Lembretes"); renderizado em `configuracoes/page.tsx` como grid de `<Link><Card/></Link>` (server component). Sem estado disabled/badge hoje.
- **Integrações** — `src/app/(app)/configuracoes/integracoes/integrations.ts` exporta `INTEGRATIONS` (inclui "WhatsApp"); renderizado em `integracoes/page.tsx`.
- **Env** — `src/shared/env/client-schema.ts` define `clientEnvSchema` (Zod) com 3 vars `NEXT_PUBLIC_*`; `src/shared/env/client.ts` parseia explicitamente cada chave de `process.env`. Não há nenhum padrão de boolean coercion ainda (apenas `z.coerce.number` e `z.enum` no schema server). WhatsApp hoje é gateado implicitamente por credenciais `TWILIO_*` opcionais — mas isso gateia **backend**, não a UI.
- **Badge** — `src/shared/ui/badge.tsx` tem variante `neutral` (surface-muted bg + text-secondary). Já existe precedente de tag "Em breve" no produto: `medical-records/components/document-editor.tsx` usa `<Badge variant="neutral" className="ml-2">Em breve</Badge>` ao lado de um botão `disabled`.

Restrições:

- **Design System** (`docs/design-system/rules.md`) é mandatório: Badge `neutral` 12px/weight 500/radius full; estado disabled = `text-disabled`, nunca `brand`; sem underline em nav; `aria-disabled`; contraste WCAG AA; respeitar `prefers-reduced-motion`; alvo clicável não aplicável quando desabilitado.
- A flag gateia UI em **client component** (menu), então **obriga** prefixo `NEXT_PUBLIC_` (inlinado no bundle do cliente em build time).

## Goals / Non-Goals

**Goals:**

- Introduzir `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` (boolean, default `false`) como único ponto de liga/desliga.
- Congelar (visível + não-navegável + tag "Em breve") o item "Caixa de entrada" e os cards "WhatsApp"/"Lembretes" de Configurações quando a flag está off.
- Conformidade total com o Design System e acessibilidade.
- Reversibilidade trivial: ligar a flag restaura o comportamento original sem mudança de código.

**Non-Goals:**

- Não bloquear/redirecionar as rotas por acesso direto (decisão do usuário: escopo mínimo, só pontos de entrada).
- Não alterar backend, Inngest, webhooks Twilio, Server Actions, banco/RLS ou middleware.
- Não remover os itens da UI (devem permanecer visíveis com "Em breve").
- Não criar um sistema genérico de feature flags — apenas esta flag pontual e autocontida.

## Decisions

### Decisão 1 — `NEXT_PUBLIC_` boolean flag, default `false`

Adicionar `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` ao `clientEnvSchema` e ao objeto parseado em `client.ts`.

Coerção de boolean (padrão a introduzir, já que não existe no repo):

```ts
// client-schema.ts
NEXT_PUBLIC_WHATSAPP_UI_ENABLED: z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true'),
```

Consumo:

```ts
import { clientEnv } from '@/shared/env/client';
const whatsappUiEnabled = clientEnv.NEXT_PUBLIC_WHATSAPP_UI_ENABLED; // boolean
```

- **Por que `NEXT_PUBLIC_`?** O `sidebar-nav.tsx` é client component; só vars `NEXT_PUBLIC_*` são inlinadas no bundle do cliente. Usar a mesma flag também nos server components de Configurações mantém uma única fonte de verdade.
- **Por que default `false`?** O recurso está quebrado hoje; o estado seguro padrão é congelado. Religar é uma ação deliberada de ambiente.
- **Por que `z.enum(['true','false'])` e não `z.coerce.boolean()`?** `z.coerce.boolean()` trata qualquer string não-vazia como `true` (inclusive `"false"`), o que seria um bug perigoso. O enum + transform é explícito e à prova de erro. Alternativa considerada e rejeitada: `z.coerce.boolean()`.

### Decisão 2 — Gating dirigido por dados nos arrays de config

Em vez de espalhar `if (flag)` no JSX, marcar o item/card como desabilitado na própria estrutura de dados e tratar o estado disabled genericamente no render.

- **Menu**: estender `NavItem` com `disabled?: boolean` e `comingSoon?: boolean` (ou um único campo). O array continua estático; o cálculo do `disabled` para "Caixa de entrada" deriva de `!clientEnv.NEXT_PUBLIC_WHATSAPP_UI_ENABLED`. O `renderNavItems()` passa a: quando `disabled`, renderizar `<span>` (não `<Link>`) com classes `text-disabled`, `aria-disabled="true"`, sem hover/active de `brand`, suprimir o badge de não-lidas e anexar `<Badge variant="neutral">Em breve</Badge>`.
- **Configurações**: estender `SettingsArea`/`Integration` com `disabled?: boolean`. Como esses arrays podem ser lidos em server component, derivar `disabled` no ponto de render (a partir de `clientEnv`, que é seguro em server e client). O grid renderiza `<div>`/`<Card>` não-clicável (sem `<Link>`) quando `disabled`, com `aria-disabled` e a tag "Em breve".
- **Por que data-driven?** Reaproveita o padrão existente (`showUnreadBadge`, `placeholder` em patient-tabs) e mantém o JSX limpo, facilitando teste e a futura remoção da flag.
- **Alternativa rejeitada**: filtrar (remover) os itens — contraria o requisito de mostrar "Em breve".

### Decisão 3 — Reuso do `Badge variant="neutral"` para a tag "Em breve"

Seguir o precedente já existente (`document-editor.tsx`). O Badge é 12px/weight 500 — naturalmente menor que o label (body 15px), satisfazendo "tag visualmente menor que o texto principal" sem CSS ad-hoc.

- **Alternativa rejeitada**: texto simples `text-tertiary` (como em `patient-tabs.tsx`). É menos consistente com o pedido de "tag" e com o precedente de item desabilitado + Badge.

### Decisão 4 — Estado desabilitado segue tokens do Design System

`text-disabled` para o rótulo/ícone; **nunca** `brand` (reservado a item ativo, conforme regra de cor); sem underline (proibido em nav); `aria-disabled="true"`; cursor `not-allowed`; sem comportamento de hover de navegação. Dark mode automático via tokens.

## Risks / Trade-offs

- **[Inlining em build time]** `NEXT_PUBLIC_*` é fixado no bundle em build. Mudar a flag exige novo build/deploy do frontend, não só restart. → Aceitável: liga/desliga é evento raro e deliberado; documentar isso no `.env.example`. Para o ambiente Docker local, a var entra no `docker-compose.yml` e vale a partir do próximo build.
- **[Divergência client/server da flag]** Se algum ponto ler a flag de fonte diferente, pode haver inconsistência. → Mitigação: uma única fonte (`clientEnv`), importada tanto em server quanto client components.
- **[Acesso direto à rota não-funcional]** Como decidido, rotas continuam acessíveis por URL; um usuário que digite a URL chega a uma tela possivelmente não-funcional. → Aceitável e explícito (escopo mínimo). Pode ser endereçado depois se necessário, sem retrabalho desta entrega.
- **[Boolean coercion incorreta]** Risco clássico de `"false"` virar `true`. → Mitigado pela Decisão 1 (enum + transform), com teste unitário cobrindo `"true"`, `"false"`, ausente e inválido.
- **[Regressão visual no menu]** Suprimir o badge de não-lidas no estado congelado pode confundir testes existentes do sidebar. → Cobrir com teste de UI nos dois estados (ligado/desligado).

## Migration Plan

1. Adicionar a flag ao `clientEnvSchema` (default `false`) e ao parse em `client.ts`.
2. Implementar suporte a `disabled` + tag "Em breve" no `sidebar-nav` e nos grids de Configurações/Integrações.
3. Documentar a var em `.env.example` e `docker-compose.yml` (valor `false` em dev).
4. Deploy: como default é `false`, o congelamento entra em vigor automaticamente.
5. **Rollback / religar**: definir `NEXT_PUBLIC_WHATSAPP_UI_ENABLED=true` no ambiente e rebuildar/redeployar o frontend. Quando o backend de WhatsApp estiver pronto, religar a flag (ou remover o spec e o gating) restaura a UI original.

## Open Questions

- Nenhuma pendência bloqueante. (Confirmado: escopo só-UI; sem bloqueio de URL direta; comportamento "visível + não-navegável".)
