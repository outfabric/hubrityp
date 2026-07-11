## Requirements

### Requirement: WhatsApp UI feature flag

O sistema SHALL substituir a flag única `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` por três feature flags de ambiente, expostas ao cliente, que governam superfícies independentes de WhatsApp na UI:

- `NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED` — página de configuração de lembretes (`/configuracoes/lembretes`) e seu card em Configurações.
- `NEXT_PUBLIC_WHATSAPP_INBOX_UI_ENABLED` — item "Caixa de entrada" no menu lateral e a UI de inbox.
- `NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED` — card "WhatsApp" de conexão em Configurações/Integrações e a tab "Templates" em `/configuracoes/lembretes` (oculta por completo quando desligada — ver requirement dedicado).

Cada flag SHALL ser validada pelo schema de env do cliente (`clientEnvSchema`), aceitar os valores string `"true"` e `"false"`, ser coagida para boolean, e ter default `false` (desligada) quando ausente ou vazia. Por gatearem UI renderizada em client component, as flags MUST usar o prefixo `NEXT_PUBLIC_`. As três flags SHALL ser independentes — habilitar uma NÃO SHALL habilitar as demais. A configuração-alvo do MVP é: reminders `true`, inbox `false`, connection `false`.

#### Scenario: Flag ausente assume desligada

- **WHEN** qualquer uma das variáveis de flag de WhatsApp não está definida no ambiente
- **THEN** o sistema interpreta a flag correspondente como `false` (desligada) e congela apenas a superfície que ela governa

#### Scenario: Valor inválido é rejeitado na validação de env

- **WHEN** qualquer flag de WhatsApp recebe um valor que não seja `"true"` nem `"false"`
- **THEN** a validação do `clientEnvSchema` falha em build/boot, sinalizando configuração inválida

#### Scenario: Configuração do MVP habilita lembretes sem inbox nem conexão

- **WHEN** `NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED="true"`, `NEXT_PUBLIC_WHATSAPP_INBOX_UI_ENABLED="false"` e `NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED="false"`
- **THEN** a tela de lembretes fica navegável com as tabs "Configuração" e "Histórico", a tab "Templates" não é renderizada, e os pontos de entrada de inbox e conexão permanecem congelados ("Em breve")

### Requirement: Item de menu "Caixa de entrada" congelado quando desligado

Quando a flag `NEXT_PUBLIC_WHATSAPP_INBOX_UI_ENABLED` está DESLIGADA, o item "Caixa de entrada" do menu lateral (`sidebar-nav`) SHALL permanecer visível, porém desabilitado e não-navegável, exibindo uma tag "Em breve" visualmente menor que o texto principal.

O estado desabilitado SHALL seguir o Design System (`docs/design-system/rules.md`): texto no token `text-disabled`, sem uso da cor `brand` (reservada a item ativo), e sem underline. O item MUST NOT renderizar um link navegável (`<a>`/`<Link>`) quando desabilitado, e MUST expor `aria-disabled="true"` para tecnologia assistiva. A tag "Em breve" SHALL usar o componente `Badge` na variante `neutral` (12px, weight 500, radius full), naturalmente menor que o rótulo do item (texto body 15px).

#### Scenario: Caixa de entrada desabilitada com tag "Em breve"

- **WHEN** a flag de inbox está desligada e o menu lateral é renderizado
- **THEN** o item "Caixa de entrada" aparece em estado desabilitado (token `text-disabled`), sem ser um link navegável, com `aria-disabled="true"` e uma tag "Em breve" (Badge `neutral`) ao lado do rótulo

#### Scenario: Clique/navegação não tem efeito

- **WHEN** o usuário tenta clicar ou ativar via teclado o item "Caixa de entrada" desabilitado
- **THEN** nenhuma navegação ocorre e a rota `/caixa-de-entrada` não é acionada a partir do menu

#### Scenario: Badge não suprime o contador de não lidas porque o item está congelado

- **WHEN** a flag de inbox está desligada
- **THEN** o item "Caixa de entrada" não exibe o badge de mensagens não lidas; apenas a tag "Em breve" é exibida

### Requirement: Cards de Configurações "WhatsApp" e "Lembretes" congelados quando desligado

O congelamento dos cards de Configurações relacionados a WhatsApp SHALL ser governado por superfície:

- O card "Lembretes" em `/configuracoes` SHALL estar habilitado e navegável quando `NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED` está LIGADA, e congelado quando DESLIGADA.
- O card "WhatsApp" em `/configuracoes` e o card "WhatsApp" em `/configuracoes/integracoes` (conexão) SHALL ser congelados quando `NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED` está DESLIGADA.

Cada card congelado MUST NOT renderizar um link navegável, MUST expor `aria-disabled="true"`, e SHALL aplicar o tratamento visual de desabilitado do Design System (token `text-disabled`, sem cor `brand`). A tag "Em breve" SHALL usar o `Badge` variante `neutral`, visualmente menor que o título do card.

#### Scenario: Card "Lembretes" navegável no MVP

- **WHEN** a flag de reminders está ligada e a página `/configuracoes` é renderizada
- **THEN** o card "Lembretes" aparece habilitado e navegável, sem a tag "Em breve"

#### Scenario: Card "WhatsApp" de conexão congelado no MVP

- **WHEN** a flag de connection está desligada e as páginas `/configuracoes` e `/configuracoes/integracoes` são renderizadas
- **THEN** os cards "WhatsApp" aparecem desabilitados, não-navegáveis, com `aria-disabled="true"` e a tag "Em breve"

#### Scenario: Demais cards de configurações permanecem inalterados

- **WHEN** as flags de WhatsApp estão na configuração do MVP
- **THEN** os outros cards de `/configuracoes` (ex.: "Locais de atendimento", "Agenda", "Transcrição IA") continuam totalmente navegáveis e sem a tag "Em breve"

### Requirement: Rotas de WhatsApp permanecem acessíveis por URL direta

Esta mudança de flags é de escopo exclusivamente visual. Independentemente do estado das flags de UI de WhatsApp, o sistema SHALL congelar apenas os pontos de entrada de navegação; as rotas em si (`/caixa-de-entrada`, `/configuracoes/lembretes`, `/configuracoes/integracoes/whatsapp`) MUST NOT ser bloqueadas, redirecionadas ou alteradas pelas flags. Nenhum processamento de backend, job Inngest, webhook Twilio ou Server Action SHALL ser alterado por estas flags. A gating de autenticação dessas rotas permanece responsabilidade do middleware, não das flags.

#### Scenario: Acesso direto à URL continua funcionando

- **WHEN** o usuário autenticado navega diretamente para `/configuracoes/lembretes` (ou outra rota de WhatsApp) com a flag correspondente desligada
- **THEN** a rota responde normalmente, sem redirecionamento ou bloqueio causado pela flag

#### Scenario: Backend não é afetado pelas flags

- **WHEN** as flags de UI estão desligadas
- **THEN** jobs de lembrete, webhooks e Server Actions de WhatsApp mantêm o comportamento existente, pois as flags governam apenas a camada de UI

### Requirement: Tab "Templates" oculta quando a flag de connection está desligada

Quando `NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED` está DESLIGADA, a tab "Templates" da navegação de `/configuracoes/lembretes` (`LembretesTabs`) MUST NOT ser renderizada — ocultação completa, sem o padrão "Em breve" desabilitado usado em cards e itens de menu. As tabs "Configuração" e "Histórico" permanecem visíveis e navegáveis. O componente é client-side e MUST importar a flag de `@/shared/env/client` (leaf), nunca do barrel `@/shared/env` (server-only). As rotas `/configuracoes/lembretes/templates*` permanecem acessíveis por URL direta (escopo visual — ver requirement "Rotas de WhatsApp permanecem acessíveis por URL direta"); o bloqueio por URL e o guard server-side de `updateTemplateImpl` são trabalho futuro documentado no proposal.

#### Scenario: Tab Templates ausente com flag desligada

- **WHEN** a flag de connection está desligada e `/configuracoes/lembretes` é renderizada
- **THEN** a navegação de tabs exibe apenas "Configuração" e "Histórico" — nenhum elemento (nem desabilitado) para "Templates"

#### Scenario: Tab Templates visível com flag ligada

- **WHEN** a flag de connection está ligada e `/configuracoes/lembretes` é renderizada
- **THEN** a tab "Templates" aparece navegável entre "Configuração" e "Histórico"

#### Scenario: Acesso por URL direta não é bloqueado pela flag

- **WHEN** o usuário autenticado navega diretamente para `/configuracoes/lembretes/templates` com a flag desligada
- **THEN** a rota responde normalmente (a flag governa apenas o ponto de entrada de navegação)
