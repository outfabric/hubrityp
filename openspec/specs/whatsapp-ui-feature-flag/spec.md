## ADDED Requirements

### Requirement: WhatsApp UI feature flag

O sistema SHALL expor uma feature flag de ambiente, exposta ao cliente, chamada `NEXT_PUBLIC_WHATSAPP_UI_ENABLED`, que governa a disponibilidade dos pontos de entrada de WhatsApp na UI (item "Caixa de entrada" no menu lateral e os cards "WhatsApp" e "Lembretes" em Configurações).

A flag SHALL ser validada pelo schema de env do cliente (`clientEnvSchema`), aceitar os valores string `"true"` e `"false"`, ser coagida para boolean, e ter default `false` (desligada) quando ausente ou vazia. Por gatear UI renderizada em client component (menu lateral), a flag MUST usar o prefixo `NEXT_PUBLIC_`.

Quando a flag está LIGADA (`true`), todos os pontos de entrada de WhatsApp SHALL se comportar exatamente como antes desta mudança (navegáveis, sem tag "Em breve").

#### Scenario: Flag ausente assume desligada

- **WHEN** a variável `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` não está definida no ambiente
- **THEN** o sistema interpreta a flag como `false` (desligada) e congela os pontos de entrada de WhatsApp na UI

#### Scenario: Valor inválido é rejeitado na validação de env

- **WHEN** `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` recebe um valor que não seja `"true"` nem `"false"`
- **THEN** a validação do `clientEnvSchema` falha em build/boot, sinalizando configuração inválida

#### Scenario: Flag ligada restaura comportamento original

- **WHEN** `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` é `"true"`
- **THEN** o item "Caixa de entrada" e os cards "WhatsApp" e "Lembretes" ficam totalmente habilitados e navegáveis, sem a tag "Em breve"

### Requirement: Item de menu "Caixa de entrada" congelado quando desligado

Quando a feature flag está DESLIGADA, o item "Caixa de entrada" do menu lateral (`sidebar-nav`) SHALL permanecer visível, porém desabilitado e não-navegável, exibindo uma tag "Em breve" visualmente menor que o texto principal.

O estado desabilitado SHALL seguir o Design System (`docs/design-system/rules.md`): texto no token `text-disabled`, sem uso da cor `brand` (reservada a item ativo), e sem underline. O item MUST NOT renderizar um link navegável (`<a>`/`<Link>`) quando desabilitado, e MUST expor `aria-disabled="true"` para tecnologia assistiva. A tag "Em breve" SHALL usar o componente `Badge` na variante `neutral` (12px, weight 500, radius full), naturalmente menor que o rótulo do item (texto body 15px).

#### Scenario: Caixa de entrada desabilitada com tag "Em breve"

- **WHEN** a flag está desligada e o menu lateral é renderizado
- **THEN** o item "Caixa de entrada" aparece em estado desabilitado (token `text-disabled`), sem ser um link navegável, com `aria-disabled="true"` e uma tag "Em breve" (Badge `neutral`) ao lado do rótulo

#### Scenario: Clique/navegação não tem efeito

- **WHEN** o usuário tenta clicar ou ativar via teclado o item "Caixa de entrada" desabilitado
- **THEN** nenhuma navegação ocorre e a rota `/caixa-de-entrada` não é acionada a partir do menu

#### Scenario: Badge não suprime o contador de não lidas porque o item está congelado

- **WHEN** a flag está desligada
- **THEN** o item "Caixa de entrada" não exibe o badge de mensagens não lidas; apenas a tag "Em breve" é exibida

### Requirement: Cards de Configurações "WhatsApp" e "Lembretes" congelados quando desligado

Quando a feature flag está DESLIGADA, os cards "WhatsApp" e "Lembretes" na página `/configuracoes`, e o card "WhatsApp" em `/configuracoes/integracoes`, SHALL permanecer visíveis porém desabilitados e não-navegáveis, cada um exibindo a mesma tag "Em breve".

Cada card congelado MUST NOT renderizar um link navegável, MUST expor `aria-disabled="true"`, e SHALL aplicar o tratamento visual de desabilitado do Design System (token `text-disabled`, sem cor `brand`). A tag "Em breve" SHALL usar o `Badge` variante `neutral`, visualmente menor que o título do card.

#### Scenario: Cards "WhatsApp" e "Lembretes" desabilitados em /configuracoes

- **WHEN** a flag está desligada e a página `/configuracoes` é renderizada
- **THEN** os cards "WhatsApp" e "Lembretes" aparecem desabilitados, não-navegáveis, com `aria-disabled="true"` e uma tag "Em breve" cada

#### Scenario: Card "WhatsApp" desabilitado em /configuracoes/integracoes

- **WHEN** a flag está desligada e a página `/configuracoes/integracoes` é renderizada
- **THEN** o card "WhatsApp" aparece desabilitado, não-navegável, com `aria-disabled="true"` e a tag "Em breve"

#### Scenario: Demais cards de configurações permanecem inalterados

- **WHEN** a flag está desligada
- **THEN** os outros cards de `/configuracoes` (ex.: "Locais de atendimento", "Agenda", "Transcrição IA") continuam totalmente navegáveis e sem a tag "Em breve"

### Requirement: Rotas de WhatsApp permanecem acessíveis por URL direta

Esta mudança é de escopo exclusivamente visual. Quando a feature flag está DESLIGADA, o sistema SHALL congelar apenas os pontos de entrada de navegação; as rotas em si (`/caixa-de-entrada`, `/configuracoes/lembretes`, `/configuracoes/integracoes/whatsapp`) MUST NOT ser bloqueadas, redirecionadas ou alteradas pelo flag. Nenhum processamento de backend, job Inngest, webhook Twilio ou Server Action SHALL ser alterado por esta flag.

#### Scenario: Acesso direto à URL continua funcionando

- **WHEN** o usuário navega diretamente para `/caixa-de-entrada` (ou outra rota de WhatsApp) com a flag desligada
- **THEN** a rota responde normalmente, sem redirecionamento ou bloqueio causado pela flag

#### Scenario: Backend não é afetado pela flag

- **WHEN** a flag está desligada
- **THEN** jobs de lembrete, webhooks e Server Actions de WhatsApp mantêm o comportamento existente, pois a flag governa apenas a camada de UI
