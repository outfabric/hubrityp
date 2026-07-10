## Context

O módulo `src/modules/whatsapp/` já contém um pipeline de lembretes funcional (dispatcher cron → sender → adapter Twilio → webhook receiver) **e** um subsistema de inbox conversacional completo. O pipeline foi construído sobre um modelo **multi-número**: o fluxo `start-twilio-connection` → `complete-twilio-connection` registra um *sender* próprio por psicólogo via Twilio Channels/Senders API, verifica por SMS, insere a linha `whatsapp_accounts` (com `consent_given_at`) e seeda os templates.

Para o MVP, o produto será estreitado para **um único número da plataforma** (`serverEnv.TWILIO_WHATSAPP_FROM`, já usado pelo adapter) enviando **apenas lembretes de sessão** — sem administração de comunicação bidirecional. O inbox é "passado" a ser reativado depois.

Restrições herdadas do código atual que condicionam o design:

- `remindersDispatcher.fetchActivePsychologists` faz `INNER JOIN whatsapp_accounts WHERE status = 'active'`. Sem essa linha, o psicólogo é invisível ao dispatcher.
- `remindersDispatcher.fetchTemplate` retorna `null` quando `message_templates.meta_template_id IS NULL`. O `seedDefaultTemplates` atual grava `meta_template_id: null` / `meta_status: 'pending'` — logo, mesmo seedado, nada é enviado.
- `whatsapp_accounts.consent_given_at` é `NOT NULL` e representa a base legal LGPD; hoje só é preenchido no fluxo de conexão (`consent: z.literal(true)`).
- `saveReminderSettingsImpl` escreve **apenas** em `reminder_settings` — não cria conta nem seeda templates.
- O flag único `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` congela em bloco inbox **e** lembretes (`WHATSAPP_DEPENDENT_SLUGS = {'whatsapp','lembretes'}`).
- O adapter já expõe `sendFreeText` (mensagem free-form sem `contentSid`), com docstring notando a restrição da janela de 24h.
- Confirmação/cancelamento resolvem o tenant via `OriginalRepliedMessageSid` → `whatsapp_messages.bspMessageId` (imune à ambiguidade de número compartilhado); PARAR e texto livre resolvem por telefone (podem casar múltiplos pacientes).

Stakeholders: psicólogos autônomos (usuários), pacientes (destinatários), e o time de produto/operações (registro dos templates na WABA da plataforma).

## Goals / Non-Goals

**Goals:**

- Fazer o MVP de lembretes funcionar de ponta a ponta com **um único número da plataforma**, sem tela de conexão.
- Provisionar `whatsapp_accounts` + templates de forma **lazy e idempotente** no primeiro save de lembretes.
- Preencher `meta_template_id` com **Content SIDs de ENV** (nível-plataforma, `approved`) para que o dispatcher envie.
- Coletar o **consentimento LGPD** na tela de lembretes como pré-condição do provisionamento, sem fabricar base legal.
- Responder texto livre do paciente com uma **auto-resposta fixa em free-form**, dentro da janela de 24h, com throttle.
- **Granularizar** o feature flag para permitir "lembretes ON, inbox/conexão/edição-de-template OFF".
- Manter as quatro camadas de segurança (middleware, layout/RSC, Server Action, RLS) e a cobertura de testes (unit/integration/E2E), com testes escritos imediatamente após o código que os motiva.

**Non-Goals:**

- Reativar ou modificar comportamento do inbox conversacional (conversas, resposta manual do psicólogo, analytics, detecção de risco). Permanece congelado.
- Suporte a múltiplos números / senders por psicólogo. Explicitamente adiado.
- Edição de texto de template por psicólogo (conflita com Content SIDs compartilhados). Congelada.
- Registro programático dos templates na Meta/WABA — isso é um passo operacional externo; o código apenas consome os Content SIDs via ENV.
- Roteamento de texto livre para caixas de entrada por tenant (não há inbox no MVP).

## Decisions

### D1 — Provisionamento lazy no primeiro save de lembretes (vs. no signup/onboarding)

`saveReminderSettingsImpl` passa a, após validar e fazer upsert de `reminder_settings`, garantir a existência da conta e dos templates:

1. `INSERT INTO whatsapp_accounts (...) ON CONFLICT (user_id) DO NOTHING` — `account_id`/`phone_number` derivados do número da plataforma (via `serverEnv`), `display_name` do `profiles.full_name`, `status='active'`, `consent_given_at = NOW()` (só se o consentimento foi aceito — ver D3).
2. `seedDefaultTemplates(userId)` — já idempotente; ajustado em D2.

**Por que lazy (sob demanda) e não no signup:** a conta só faz sentido quando o psicólogo decide usar lembretes e aceita o termo LGPD. Provisionar no signup gravaria `consent_given_at` sem consentimento — base legal fabricada. Lazy amarra o provisionamento ao ato de consentir.

**Alternativa considerada:** job de backfill/admin criando contas para todos. Rejeitada para novos usuários pela mesma razão de consentimento; o backfill fica restrito a usuários que **já** consentiram no fluxo antigo (ver Migration Plan).

**Concorrência:** `whatsapp_accounts` tem `UNIQUE(user_id)`; dois saves simultâneos → `23505`. `ON CONFLICT DO NOTHING` resolve; o seed já checa existência antes de inserir.

### D2 — Content SIDs via ENV, seed grava `approved` (vs. lifecycle de aprovação por psicólogo)

No modelo multi-número, cada psicólogo registrava templates e o `meta_template_id` era preenchido após aprovação da Meta. No modelo de número único, a plataforma registra os templates **uma vez** na WABA compartilhada e todos os psicólogos usam os **mesmos** Content SIDs.

- Novas ENVs server-only, validadas por Zod no boot (`shared/env/schemas.ts`): `TWILIO_CONTENT_SID_LEMBRETE_24H`, `TWILIO_CONTENT_SID_LEMBRETE_2H`, `TWILIO_CONTENT_SID_LINK_VIDEO`, `TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA`, `TWILIO_CONTENT_SID_CANCELAMENTO_AVISO`.
- `seedDefaultTemplates` passa a mapear `templateKey → Content SID de ENV` e gravar `meta_template_id = <sid>`, `meta_status = 'approved'`.
- **Nunca** `NEXT_PUBLIC_*` (são identificadores de infra; sem razão de ir ao cliente). Acesso somente via `serverEnv`.

**Alternativa considerada:** tabela de config no banco para os SIDs. Rejeitada para o MVP — ENV é mais simples, versionável por ambiente, e valida no boot. Migrar para tabela é reversível no futuro.

### D3 — Consentimento LGPD na tela de lembretes (vs. manter no fluxo de conexão)

O campo `consent: z.literal(true)` migra do `startConnectionInputSchema` para o `reminderSettingsSchema`. A UI (`reminder-settings-form.tsx`) ganha um checkbox de consentimento com cópia que cobre: (a) uso do WhatsApp da plataforma para contatar pacientes; (b) responsabilidade do psicólogo pelo consentimento do próprio paciente.

- O `consent_given_at` só é gravado quando `consent === true` no save que provisiona a conta.
- Uma vez provisionada a conta, saves subsequentes (editar horários) **não** re-exigem o checkbox — a Server Action detecta conta existente e trata o consentimento como já registrado. Isso evita fricção sem perder a base legal.

**Segurança:** validação Zod no boundary; autenticação via `supabase.auth.getUser()`; autorização derivada da sessão (`user.id`), nunca de input. Cliente RLS-scoped (não service-role) para as escritas originadas do usuário.

### D4 — Auto-resposta a texto livre em free-form, dentro da janela de 24h (vs. template)

Confirmado na doc do Twilio: uma mensagem *inbound* do usuário abre uma janela de atendimento de 24h durante a qual o negócio pode enviar mensagens **free-form sem template**. Como a auto-resposta é sempre uma reação imediata a uma mensagem que o paciente acabou de enviar, a janela está aberta e fresca.

- O ramo `inbound_text` do webhook (`app/api/webhooks/twilio/whatsapp/route.ts`) deixa de emitir `whatsapp/inbound.received` (que alimentava `inbox-message-ingest`) e passa a acionar a auto-resposta via `sendFreeText({ to, body })` com uma string fixa não-clínica (ex.: "Este é um canal automático de lembretes. Para falar com seu psicólogo, entre em contato por [contato]").
- **Prontidão:** a auto-resposta deve sair sem enfileiramento longo; se roteada por Inngest, com prioridade/execução imediata, jamais agendada >24h.
- **Throttle:** no máximo 1 auto-resposta por telefone a cada 24h — checado consultando `whatsapp_messages` (outbound, corpo/rotulo de auto-resposta, `created_at` na janela). Evita loop/spam se o paciente enviar várias mensagens.
- **Escopo:** somente o ramo `inbound_text`. `status_update`, `button_confirm`, `button_cancel`, `stop_command` seguem seus handlers atuais e **não** recebem auto-resposta.

**Alternativa considerada:** template dedicado de auto-resposta. Rejeitada — desnecessário dentro da janela, adiciona custo de aprovação Meta e um Content SID a mais. Free-form é o uso de manual da janela.

**Registro para auditoria:** a auto-resposta (outbound) é gravada em `whatsapp_messages`; opcionalmente registra-se o inbound apenas para trilha LGPD, sem alimentar `whatsapp_conversations`.

### D5 — Granularização do feature flag (vs. flag único)

O flag único é dividido em superfícies independentes para expressar o MVP:

- `NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED` → tela de configuração de lembretes (ativa no MVP).
- `NEXT_PUBLIC_WHATSAPP_INBOX_UI_ENABLED` → inbox/conversas (congelado).
- `NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED` → conectar número + editar texto de template (congelado; resquício multi-número).

`sidebar-nav.tsx`, `configuracoes/page.tsx` e `configuracoes/integracoes/page.tsx` passam a decidir o congelamento por superfície. Cartões congelados permanecem renderizados como não-navegáveis, `aria-disabled`, com selo "Em breve" — padrão visual já existente, a ser mantido conforme `docs/design-system/rules.md`.

**Alternativa considerada:** um enum único de "modo WhatsApp". Rejeitada — flags booleanos por superfície são mais simples de raciocinar e de testar isoladamente, e a granularidade combina com reativação incremental pós-MVP.

### D6 — Frontend segue o Design System e usa Context7

Toda alteração de UI desta change (checkbox de consentimento, estados congelados, mensagens "Em breve", formulários) deve consultar `docs/design-system/rules.md` para tokens, tipografia, espaçamento, componentes shadcn/ui e padrões de acessibilidade, garantindo consistência visual. Para dúvidas de API/integração de qualquer biblioteca (Twilio, Zod, shadcn/ui, React Hook Form, Inngest, Drizzle), consultar o MCP Context7 antes de fixar a especificação técnica.

## Risks / Trade-offs

- **[Provisionamento lazy sem seed correto = zero lembretes]** → Garantir que D1 e D2 sejam entregues juntos e cobertos por teste de integração que valida: após o primeiro save consentido, existe `whatsapp_accounts.status='active'` **e** `message_templates.meta_template_id` não-nulo, e o dispatcher enxerga o psicólogo.
- **[Consentimento fabricado / base legal inválida]** → `consent_given_at` só é escrito com `consent === true` no boundary Zod; teste negativo garante que save sem consentimento não cria conta. Backfill restrito a quem já consentiu.
- **[Número compartilhado = ponto único de falha de entregabilidade]** → Fora do escopo de código, mas documentado: monitorar quality rating e tiering de throughput do número da plataforma; degradação afeta todos os psicólogos.
- **[Auto-resposta fora da janela de 24h]** → Improvável (resposta imediata), mas o design proíbe agendamento longo; se a janela estiver fechada por atraso extremo, o envio free-form falharia — nesse caso, apenas logar e descartar (sem fallback de template no MVP).
- **[Loop/spam de auto-resposta]** → Throttle de 1x/24h por telefone; escopo restrito ao ramo `inbound_text`.
- **[Content SID ausente/incorreto em ENV]** → Validação Zod no boot falha o deploy antes de rodar; teste unitário do mapeamento `templateKey → SID`.
- **[Colunas vestigiais em `whatsapp_accounts`]** → `account_id`/`phone_number` refletem o número da plataforma; documentar em comentário que são reservadas para multi-número pós-MVP, evitando confusão.
- **[Regressão de gating por flag granular]** → Cada superfície congelada precisa de teste (unit RTL de "frozen/Em breve" + E2E de não-navegabilidade); rota gated precisa de teste negativo de auth.

## Migration Plan

1. **Pré-deploy (operacional):** registrar os ~5 templates de lembrete na WABA da plataforma, obter os Content SIDs e configurar as ENVs `TWILIO_CONTENT_SID_*` no ambiente. O boot valida por Zod — deploy falha se faltarem.
2. **Schema/ENV:** adicionar as ENVs de Content SID (server) e os flags granulares (`NEXT_PUBLIC_*`) ao `shared/env`. Manter o flag legado temporariamente para transição, se necessário, ou substituir com defaults seguros (inbox/conexão OFF).
3. **Backend:** ajustar `seedDefaultTemplates` (Content SIDs + `approved`), `saveReminderSettingsImpl` (provisionamento lazy + consentimento), e o ramo `inbound_text` do webhook (auto-resposta + throttle). Cada mudança acompanhada imediatamente do seu teste.
4. **Frontend:** consentimento na tela de lembretes; lógica de congelamento por superfície nas telas de settings/sidebar (consultando o Design System).
5. **Backfill (opcional):** para psicólogos que já possuem `whatsapp_accounts` do fluxo antigo, atualizar `meta_template_id` dos templates existentes para os Content SIDs da plataforma (migração de dados idempotente). Não criar consentimento para quem não tem.
6. **Rollback:** as mudanças são reversíveis — flags voltam a congelar tudo; o provisionamento lazy é aditivo (não remove dados); os Content SIDs em ENV podem ser revertidos. Migração de dados do backfill deve ser reversível ou apenas aditiva.

## Open Questions

- **Texto e canal da auto-resposta:** qual o conteúdo exato e o canal alternativo de contato a indicar ("entre em contato por ___")? R: Conteúdo exato é "Olá, esse canal é utilizado apenas para envio de lembretes. Para falar com seu psicólogo (a), entre em contato diretamente com ele.".
- **Número/`display_name` da conta lazy:** `display_name` vem de `profiles.full_name`? Confirmar a fonte para `account_id`/`phone_number` derivados do número da plataforma (constante de env vs. valor fixo).
- **Backfill:** há psicólogos em produção com `whatsapp_accounts` do fluxo antigo cujos templates têm `meta_template_id` nulo? R: Não há.
- **Flag legado:** remover `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` de imediato ou manter como alias durante uma janela de transição? R: Remover de imediato
