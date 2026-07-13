# whatsapp-ui-feature-flag — Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
