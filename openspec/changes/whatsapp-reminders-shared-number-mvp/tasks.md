# Tasks

> Convenção desta change: **cada tarefa de teste vem imediatamente após a tarefa de código que a motiva** — nunca em lote no fim — para preservar o contexto do agente. Toda tarefa de UI DEVE consultar `docs/design-system/rules.md`. Use o MCP Context7 para confirmar APIs/integração (Twilio, Zod, shadcn/ui, React Hook Form, Inngest, Drizzle) antes de fixar detalhes técnicos.

## 1. Env & config (Content SIDs + flags granulares)

- [x] 1.1 Adicionar ao schema de env **server** (`src/shared/env/schemas.ts` + `index.ts`) as vars `TWILIO_CONTENT_SID_LEMBRETE_24H`, `TWILIO_CONTENT_SID_LEMBRETE_2H`, `TWILIO_CONTENT_SID_LINK_VIDEO`, `TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA`, `TWILIO_CONTENT_SID_CANCELAMENTO_AVISO` (Zod, obrigatórias, server-only, nunca `NEXT_PUBLIC_`).
- [x] 1.2 Substituir a flag `NEXT_PUBLIC_WHATSAPP_UI_ENABLED` por três flags no client env (`src/shared/env/client-schema.ts` + `client.ts`): `NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED`, `NEXT_PUBLIC_WHATSAPP_INBOX_UI_ENABLED`, `NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED` (coerção string→boolean, default `false`). Decidir manter alias legado ou remover (ver Open Questions).
- [x] 1.3 **Teste (unit)**: validar coerção/default das 3 flags e a rejeição de valor inválido no `clientEnvSchema`; validar presença obrigatória das `TWILIO_CONTENT_SID_*` no server env (falha de boot quando ausente).
- [x] 1.4 Atualizar `.env.example` / docs de env com as novas vars e a config-alvo do MVP (reminders `true`, inbox `false`, connection `false`).

## 2. Seed de templates com Content SIDs da plataforma

- [x] 2.1 Alterar `src/modules/whatsapp/server/seed-default-templates.ts` para mapear `templateKey → TWILIO_CONTENT_SID_*` (via `serverEnv`) e gravar `metaTemplateId = <sid>` + `metaStatus = 'approved'` nos templates de lembrete (`lembrete_24h`, `lembrete_2h`, `link_video`, `confirmacao_recebida`, `cancelamento_aviso`). Manter idempotência.
- [x] 2.2 **Teste (unit)**: mapeamento `templateKey → Content SID` correto e completo; templates de lembrete nascem `approved` com `metaTemplateId` não-nulo.
- [x] 2.3 **Teste (integration)**: após seed, `message_templates` tem `meta_template_id` não-nulo/`approved`; `fetchTemplate` do dispatcher retorna `contentSid` para cada kind; segunda chamada não duplica (idempotência) — contra Postgres real com RLS.

## 3. Provisionamento lazy + consentimento LGPD (Server Action)

- [ ] 3.1 Adicionar `consent` (`z.literal(true)`) ao `reminderSettingsSchema` (`src/modules/whatsapp/lib/reminders/reminder-settings-schema.ts`), condicionado a "obrigatório apenas quando não há conta ainda".
- [ ] 3.2 **Teste (unit)**: schema aceita input com `consent: true`; rejeita `consent` ausente/false quando exigido; mantém validação dos demais campos.
- [ ] 3.3 Alterar `saveReminderSettingsImpl` (`server/reminders/save-reminder-settings.ts`): autenticar via `getUser()`; no 1º save consentido, `INSERT whatsapp_accounts ... ON CONFLICT (user_id) DO NOTHING` (número da plataforma via `serverEnv`, `display_name` de `profiles.full_name`, `status='active'`, `consent_given_at=NOW()`) e chamar `seedDefaultTemplates(userId)`. `user_id` sempre da sessão.
- [ ] 3.4 Remover o `consent` do `startConnectionInputSchema` / fluxo de conexão (agora congelado) sem quebrar tipos.
- [ ] 3.5 **Teste (integration)**: 1º save consentido cria `whatsapp_accounts` (active) + templates, scoped por `auth.uid()`, e o dispatcher passa a enxergar o psicólogo; saves subsequentes não duplicam conta nem re-exigem consentimento; `consent_given_at` preservado.
- [ ] 3.6 **Teste (integration, negativo/segurança)**: save sem consentimento NÃO cria conta e nunca grava `consent_given_at`; RLS impede provisionar/ler conta de outro `user_id`; corrida de dois 1º-saves resulta em exatamente uma conta (sem `23505` não tratado).

## 4. Webhook `inbound_text` → auto-resposta free-form + throttle

- [ ] 4.1 Criar helper de auto-resposta (texto fixo não-clínico) usando `sendFreeText` do adapter; incluir checagem de throttle (≤1 auto-resposta por telefone em 24h) consultando `whatsapp_messages`. Confirmar via Context7 a semântica da janela de 24h do Twilio se necessário.
- [ ] 4.2 **Teste (unit)**: regra de throttle (permite 1ª, suprime dentro de 24h, permite após 24h); corpo fixo sem PII.
- [ ] 4.3 Alterar `src/app/api/webhooks/twilio/whatsapp/route.ts`: ramo `inbound_text` deixa de emitir `whatsapp/inbound.received` (inbox) e passa a acionar a auto-resposta; garantir retorno 200 imediato e log sem PII em falha de disparo. Persistir inbound em `whatsapp_messages` (audit/throttle) sem tocar `whatsapp_conversations`.
- [ ] 4.4 **Teste (integration)**: `inbound_text` dispara auto-resposta (via `sendFreeText` mockado), NÃO cria/atualiza `whatsapp_conversations`, persiste inbound; `button_confirm`/`button_cancel`/`stop_command`/`status_update` seguem seus handlers e NÃO recebem auto-resposta; assinatura HMAC inválida → 403.

## 5. Frontend — consentimento na tela de lembretes

- [ ] 5.1 Adicionar o controle de consentimento LGPD ao `reminder-settings-form.tsx` (React Hook Form + Zod resolver), exibido/obrigatório apenas quando o psicólogo ainda não tem conta; cópia cobrindo (a) uso do WhatsApp da plataforma e (b) responsabilidade pelo consentimento do paciente. **Consultar `docs/design-system/rules.md`** para o componente, tokens e acessibilidade.
- [ ] 5.2 **Teste (unit/RTL)**: form renderiza o consentimento no estado "sem conta"; bloqueia submit sem consentimento; oculta/dispensa o checkbox quando a conta já existe.
- [ ] 5.3 **Teste (E2E, seeded)**: fluxo de configurar lembretes com consentimento → toast de sucesso; segundo acesso não re-exige consentimento.

## 6. Frontend — congelamento granular por superfície (flags)

- [ ] 6.1 Atualizar `sidebar-nav.tsx` para congelar "Caixa de entrada" por `NEXT_PUBLIC_WHATSAPP_INBOX_UI_ENABLED` (não-navegável, `aria-disabled`, Badge "Em breve"). **Design System.**
- [ ] 6.2 Atualizar `configuracoes/page.tsx` e `configuracoes/integracoes/page.tsx`: card "Lembretes" navegável por `WHATSAPP_REMINDERS_UI_ENABLED`; cards "WhatsApp"/conexão e edição de template congelados por `WHATSAPP_CONNECTION_UI_ENABLED`. **Design System.**
- [ ] 6.3 **Teste (unit/RTL)**: com config do MVP (reminders on, inbox/connection off) — "Lembretes" navegável; "Caixa de entrada", "WhatsApp"/conexão e edição de template congelados (`aria-disabled`, sem `<a>`, "Em breve"); demais cards inalterados.
- [ ] 6.4 **Teste (E2E, seeded)**: item/cards congelados são não-navegáveis (clique/teclado não navega); a tela de lembretes permanece acessível.
- [ ] 6.5 **Teste (integration/negativo de auth)**: as rotas de WhatsApp (`/configuracoes/lembretes`, `/caixa-de-entrada`) continuam gated pelo middleware — requisição anônima é redirecionada/rejeitada, independentemente das flags.

## 7. Atualização de artefatos, se necessário

- [ ] 7.1 Atualizar a árvore de pastas/notas em `CLAUDE.md` se novos arquivos de módulo/rota foram criados nesta worktree.
