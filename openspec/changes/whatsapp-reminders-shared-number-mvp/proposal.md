## Why

O subsistema de WhatsApp já implementado no repositório foi desenhado para um modelo **multi-número** (cada psicólogo conecta e verifica seu próprio número via Twilio Channels/Senders) e inclui uma superfície de **inbox conversacional** completa (conversas, resposta em texto livre, detecção de risco, analytics). Para o MVP, o produto será deliberadamente **mais estreito**: um **único número da plataforma** envia lembretes de sessão para todos os psicólogos, sem administração de comunicação bidirecional.

Nesse recorte, o fluxo atual está quebrado de forma silenciosa: a criação da conta WhatsApp (o único ponto que provisiona `whatsapp_accounts`, o `consent_given_at` de LGPD e os templates) depende de uma tela de conexão que não faz sentido num número compartilhado. Se essa tela for simplesmente desabilitada, o dispatcher — que exige `whatsapp_accounts.status = 'active'` e `message_templates.meta_template_id` não-nulo — **não dispara nenhum lembrete**. Esta change reconfigura o provisionamento, a fronteira de UI e o tratamento de mensagens de entrada para que o MVP de lembretes funcione de ponta a ponta, mantendo o inbox congelado para reativação pós-MVP.

## What Changes

- **Número único da plataforma**: todos os envios usam `serverEnv.TWILIO_WHATSAPP_FROM` (já é o comportamento do adapter). Formaliza-se que `whatsapp_accounts.account_id`/`phone_number` refletem o número da plataforma, não um número por psicólogo.
- **Provisionamento lazy** da conta WhatsApp: no **primeiro** save das configurações de lembrete, cria-se a linha `whatsapp_accounts` (status `active`, apontando para o número da plataforma) e seedam-se os templates. Idempotente e resistente a corrida (`UNIQUE(user_id)`).
- **Consentimento LGPD movido para a tela de lembretes**: o aceite explícito (`z.literal(true)`) que hoje vive no fluxo de conexão passa a ser coletado na tela de configuração de lembretes, com cópia que cobre a base legal (uso do WhatsApp da plataforma para contatar pacientes + responsabilidade do psicólogo pelo consentimento do paciente). `consent_given_at` só é gravado mediante aceite real.
- **Content SIDs via ENV**: os identificadores de template aprovados na WABA compartilhada da plataforma passam a ser lidos de variáveis de ambiente (validadas por Zod no boot). O seed grava `meta_template_id` = Content SID da plataforma e `meta_status = 'approved'` (em vez de `null`/`pending`).
- **Auto-resposta a texto livre**: quando um paciente envia texto livre ao número da plataforma, o sistema responde uma mensagem fixa em **texto livre** (via `sendFreeText`, aproveitando a janela de atendimento de 24h aberta pela mensagem do paciente), sem template. Throttle de no máximo 1 auto-resposta por telefone a cada 24h. O ramo deixa de alimentar o inbox.
- **Granularização do feature flag de UI**: o flag único `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` (que hoje congela inbox **e** lembretes juntos) é dividido para permitir "lembretes ON, inbox/conexão/edição-de-template OFF".
- **BREAKING (UI)**: a tela de **conectar WhatsApp** e a tela de **editar texto de template** ficam congeladas ("Em breve") no MVP — edição de texto conflita com Content SIDs compartilhados aprovados pela Meta.
- **Inbox congelado**: a UI de inbox permanece congelada e o ramo de ingestão de texto livre (`inbox-message-ingest`) deixa de ser alimentado durante o MVP; será reativado depois.

## Capabilities

### New Capabilities
- `whatsapp-auto-reply`: auto-resposta fixa, em texto livre, a mensagens de entrada não estruturadas (não-Confirmar/Cancelar/PARAR), aproveitando a janela de 24h; inclui regra de throttle e requisito de não vazar PII.
- `whatsapp-shared-number-provisioning`: modelo de provisionamento lazy da conta WhatsApp da plataforma e do seed de templates com Content SIDs de ENV, disparado pelo primeiro save de lembretes; captura de consentimento LGPD como pré-condição.

### Modified Capabilities
- `whatsapp-account`: deixa de exigir fluxo de conexão/verificação por psicólogo; conta provisionada de forma lazy apontando para o número único da plataforma.
- `whatsapp-reminder-settings`: a tela de lembretes passa a ser o gatilho do provisionamento e o ponto de captura do consentimento LGPD.
- `whatsapp-templates`: Content SIDs passam a vir de ENV (nível-plataforma, `approved`); edição de texto por psicólogo é congelada no MVP.
- `whatsapp-ui-feature-flag`: flag único é granularizado em superfícies independentes (lembretes vs. inbox vs. conexão vs. edição de template).
- `whatsapp-webhook-receiver`: o ramo `inbound_text` passa a acionar a auto-resposta em vez de emitir evento de ingestão para o inbox.

## Impact

- **Backend / Server Actions**: `modules/whatsapp/server/reminders/save-reminder-settings.ts` (provisionamento lazy + consentimento), `seed-default-templates.ts` (Content SIDs de ENV + `approved`), `app/api/webhooks/twilio/whatsapp/route.ts` (ramo `inbound_text` → auto-resposta), adapter `twilio-bsp.ts` (reutiliza `sendFreeText`).
- **Inngest**: `inngest/inbox/inbox-message-ingest.ts` deixa de receber texto livre durante o MVP; possível nova função/handler para a auto-resposta com throttle.
- **Env**: `shared/env/schemas.ts` + `shared/env/index.ts` — novas vars `TWILIO_CONTENT_SID_*` (server-only, nunca `NEXT_PUBLIC_*`); novos flags de UI (`NEXT_PUBLIC_*`) para granularização.
- **Frontend**: `modules/whatsapp/components/reminder-settings-form.tsx` (campo de consentimento LGPD), `app/(app)/configuracoes/page.tsx`, `configuracoes/integracoes/page.tsx`, `sidebar-nav.tsx` (nova lógica de congelamento por superfície). Toda alteração de UI deve consultar `docs/design-system/rules.md`.
- **Banco**: sem novas tabelas; `whatsapp_accounts`/`message_templates` continuam com RLS owner-scoped. Verificar índice de `whatsapp_messages` para a consulta de throttle da auto-resposta.
- **Testes**: unit (schema de consentimento, seleção de Content SID por ENV, regra de throttle), integração (save-reminder-settings provisionando conta+templates com RLS, webhook `inbound_text` → auto-resposta, dispatcher enxergando conta lazy), E2E (fluxo de configurar lembretes com consentimento; telas congeladas não-navegáveis; negativa de auth nas superfícies gated).
- **Operacional (fora do código)**: registro dos ~5 templates de lembrete na WABA da plataforma e preenchimento dos Content SIDs nas ENVs antes do go-live. Monitorar quality rating do número compartilhado (ponto único de falha de entregabilidade).
