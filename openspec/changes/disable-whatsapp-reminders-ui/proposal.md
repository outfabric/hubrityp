## Why

A integração com WhatsApp para envio de lembretes de sessões ainda não está funcional, mas seus pontos de entrada já aparecem na UI ("Caixa de entrada" no menu, "WhatsApp" e "Lembretes" em Configurações). Isso induz o usuário a tentar configurar/usar algo que não opera, gerando frustração e tickets de suporte. Precisamos congelar esses pontos de entrada de forma controlada — sinalizando "Em breve" — e poder religá-los instantaneamente quando o backend estiver pronto, sem novo deploy de código.

## What Changes

- **Feature flag de UI (env var)**: introduzir `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` (booleana, default **desligada** = `false`) que controla a disponibilidade dos pontos de entrada de WhatsApp na UI. Ligar/desligar é só mudar a variável de ambiente.
- **Menu — "Caixa de entrada"**: quando o flag está desligado, o item fica desabilitado/congelado (não navegável, estado `disabled`) e exibe uma tag **"Em breve"** visualmente menor que o texto principal.
- **Configurações — "WhatsApp" e "Lembretes"**: os cards/opções correspondentes em `/configuracoes` (e o card "WhatsApp" em `/configuracoes/integracoes`) ficam desabilitados/congelados e exibem a mesma tag **"Em breve"**, sem navegação.
- **Escopo apenas de UI**: backend, Inngest jobs, webhooks Twilio e Server Actions permanecem inalterados. Esta mudança não desliga nenhum processamento — apenas oculta/congela os pontos de entrada visuais. (Decisão registrada: escopo "só UI".)
- **Conformidade com o Design System** (`docs/design-system/rules.md`): a tag "Em breve" usa o componente `Badge` variante `neutral` (12px, weight 500, radius full); o estado desabilitado usa o token `text-disabled`, nunca a cor `brand` (reservada a item ativo); acessibilidade via `aria-disabled` e remoção do alvo de navegação.

## Capabilities

### New Capabilities

- `whatsapp-ui-feature-flag`: define a feature flag de ambiente que governa a disponibilidade dos pontos de entrada de WhatsApp na UI e o comportamento de "congelamento" (item desabilitado + tag "Em breve" conforme Design System) no menu lateral e no painel de Configurações. Capability autocontida e reversível — ao religar o flag (ou remover este spec quando o backend estiver pronto), a UI volta ao comportamento original sem alterações espalhadas.

### Modified Capabilities

<!-- Nenhuma. O comportamento de congelamento é inteiramente condicional ao novo flag e fica
     contido na nova capability `whatsapp-ui-feature-flag`. Os specs existentes de navegação/
     configurações (app-shell, settings-shell, whatsapp-inbox, whatsapp-account,
     whatsapp-reminder-settings) descrevem o comportamento quando o flag está LIGADO, que
     permanece o default semântico desses specs — por isso não há deltas de requisito neles. -->

## Impact

- **Env / config**:
  - `src/shared/env/client-schema.ts` — adicionar `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` (coerção string→boolean, default `false`).
  - `src/shared/env/client.ts` — incluir a nova chave no objeto parseado.
  - `.env.example` e `docker-compose.yml` — documentar a nova variável.
- **Menu lateral**:
  - `src/app/(app)/sidebar-nav.tsx` — suporte a item `disabled` + badge "Em breve"; gating do item "Caixa de entrada" pelo flag.
- **Configurações**:
  - `src/app/(app)/configuracoes/settings-areas.ts` + `configuracoes/page.tsx` — gating/congelamento dos cards "WhatsApp" e "Lembretes".
  - `src/app/(app)/configuracoes/integracoes/integrations.ts` + `integracoes/page.tsx` — gating/congelamento do card "WhatsApp".
- **Componentes UI**: reutiliza `src/shared/ui/badge.tsx` (variante `neutral`), seguindo o precedente já existente de tag "Em breve" no produto.
- **Testes**: unit (schema do flag), e cobertura de UI para os estados ligado/desligado do menu e dos cards de configurações.
- **Sem impacto** em: banco de dados/RLS, rotas de API, Inngest, Twilio, autenticação ou middleware de gating (as rotas continuam existindo; apenas seus pontos de entrada visuais ficam congelados).
