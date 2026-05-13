## 1. Dependencies

- [x] 1.1 Instalar Twilio Node.js SDK: `npm install twilio`
- [x] 1.2 Verificar que `inngest` ja esta instalado no projeto (change 1 deve ter adicionado); se nao, instalar: `npm install inngest`
- [x] 1.3 Adicionar env vars ao schema Zod de serverEnv (`src/shared/env/server.ts`): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (numero from do BSP), `TWILIO_WEBHOOK_URL` (URL publica do webhook para validacao HMAC). Adicionar ao `.env.example`

## 2. Database Schema — reminder_settings + whatsapp_messages + sessions column

- [x] 2.1 Criar/estender `src/shared/db/schema/whatsapp/tables.ts` — adicionar tabela `reminder_settings`: id (uuid PK), user_id (uuid NOT NULL, UNIQUE, FK auth.users manual na migration), early_reminder_hours (integer nullable), final_reminder_hours (integer nullable), video_link_minutes (integer NOT NULL DEFAULT 30), send_during_night (boolean NOT NULL DEFAULT false), created_at (timestamptz DEFAULT now()), updated_at (timestamptz DEFAULT now())
- [x] 2.2 Adicionar tabela `whatsapp_messages` em `src/shared/db/schema/whatsapp/tables.ts` — colunas: id (uuid PK), user_id (uuid NOT NULL, FK auth.users), patient_id (uuid nullable, FK patients), session_id (uuid nullable, FK sessions), direction (text NOT NULL, CHECK 'outbound'/'inbound'), to_phone (varchar 20), from_phone (varchar 20), body (text), template_key (varchar 50), bsp_message_id (varchar 255), idempotency_key (varchar 64), status (text, CHECK 'queued'/'sent'/'delivered'/'read'/'failed'/'unable_to_send'), error_reason (text), sent_at (timestamptz), delivered_at (timestamptz), read_at (timestamptz), created_at (timestamptz DEFAULT now()). Indexes: (user_id, created_at DESC), (session_id), (patient_id, created_at DESC). UNIQUE parcial em bsp_message_id (WHERE bsp_message_id IS NOT NULL). UNIQUE parcial em idempotency_key (WHERE status != 'failed' AND idempotency_key IS NOT NULL)
- [x] 2.3 Adicionar coluna `reminders_disabled` (boolean DEFAULT false) ao schema Drizzle de `sessions` em `src/shared/db/schema/agenda/tables.ts`
- [x] 2.4 Criar/estender `src/shared/db/schema/whatsapp/policies.ts` — RLS policies: reminder_settings usa `user_id = auth.uid()` (SELECT/INSERT/UPDATE/DELETE). whatsapp_messages usa `user_id = auth.uid()` (SELECT/INSERT/UPDATE). Seguir pattern de `src/shared/db/schema/patients/policies.ts`
- [x] 2.5 Atualizar `src/shared/db/schema/whatsapp/index.ts` — barrel reexportando tables e policies (incluindo tabelas da change 1)
- [x] 2.6 Atualizar `src/shared/db/schema/index.ts` — garantir reexport de `./whatsapp` (se change 1 ja fez, apenas verificar)
- [x] 2.7 Rodar `npm run db:generate`, editar migration para incluir: RLS policies SQL, FK constraints manuais, CHECK constraints para direction/status enums, ALTER TABLE sessions ADD COLUMN reminders_disabled BOOLEAN DEFAULT false
- [x] 2.8 Testar migration com `npm run db:migrate` local
- [x] 2.9 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/reminders-schema.int.test.ts` — verificar: tabelas reminder_settings/whatsapp_messages existem, RLS habilitado, CHECK constraints funcionam (direction invalido rejeitado, status invalido rejeitado), indexes existem, FK constraints funcionam, UNIQUE parcial em bsp_message_id funciona, UNIQUE parcial em idempotency_key funciona, coluna reminders_disabled existe em sessions com default false

## 3. Validators — Zod Schemas

- [x] 3.1 Criar `src/modules/whatsapp/lib/reminders/reminder-settings-schema.ts` — Zod schema: early_reminder_hours (z.number().nullable(), refinement: se nao null, deve ser um de [12, 24, 48]), final_reminder_hours (z.number().nullable(), refinement: se nao null, deve ser um de [0.5, 1, 2]), video_link_minutes (z.number(), um de [15, 30, 60]), send_during_night (z.boolean()). Exportar tipo via z.infer
- [x] 3.2 **Teste unitario:** Criar `src/__tests__/unit/modules/whatsapp/lib/reminders/reminder-settings-schema.test.ts` — testar: input valido com todos os campos, early_reminder_hours null aceito, valor invalido (6) rejeitado, final_reminder_hours null aceito, video_link_minutes invalido (45) rejeitado, campos obrigatorios ausentes rejeitados

## 4. Pure Functions — compute-reminder-window, select-template-variables, idempotency-key

- [x] 4.1 Criar `src/modules/whatsapp/lib/reminders/compute-reminder-window.ts` — funcao pura `computeReminderWindow(session: { startAt: Date; createdAt: Date; modality?: string }, settings: ReminderSettings, now: Date, timezone: string): { earlyDueAt: Date|null, finalDueAt: Date|null, videoDueAt: Date|null }`. Implementar: calculo de early/final/video due times, RN-04.03 (skip early se sessao criada com menos de janela), regra de madrugada (22h-07h deferred para 07h se send_during_night=false), sessao no passado retorna tudo null, video so para modality='online'. Usar date-fns-tz com timezone America/Sao_Paulo
- [x] 4.2 **Teste unitario:** Criar `src/__tests__/unit/modules/whatsapp/lib/reminders/compute-reminder-window.test.ts` — testar: early/final/video calculo correto para sessao padrao, RN-04.03 (sessao criada com menos de 24h pula antecipado mas nao final), madrugada com send_during_night=false enfileira para 07h, madrugada com send_during_night=true mantem horario original, timezone Sao Paulo correto, sessao no passado retorna nulls, reminder desabilitado (null) retorna null para aquele tipo, video somente para online, edge case sessao exatamente no limite da janela
- [x] 4.3 Criar `src/modules/whatsapp/lib/reminders/select-template-variables.ts` — funcao pura que dado (session, patient, psychologist, location, kind) retorna Record<string, string> com as 12 variaveis do PRD preenchidas. Importar dicionario de `template-variables.ts` da change 1. Variaveis nao aplicaveis ao kind sao omitidas (ex: link_video so para kind 'video' ou sessao online)
- [x] 4.4 **Teste unitario:** Criar `src/__tests__/unit/modules/whatsapp/lib/reminders/select-template-variables.test.ts` — testar: todas 12 variaveis preenchidas para kind 'early', link_video presente para kind 'video', link_video ausente para in_person, paciente sem endereco usa nome do local apenas, sessao sem location, modalidade online vs in_person, kind 'confirmed_ack' retorna nome/data/hora, kind 'cancelled' retorna nome/data/hora/mensagem
- [x] 4.5 Criar `src/modules/whatsapp/lib/reminders/idempotency-key.ts` — funcao `generateIdempotencyKey(sessionId: string, kind: string): string` que retorna `sha256(sessionId + ":" + kind)`. Usar crypto.createHash('sha256')
- [x] 4.6 **Teste unitario:** Criar `src/__tests__/unit/modules/whatsapp/lib/reminders/idempotency-key.test.ts` — testar: determinismo (mesmo input = mesmo output), kinds diferentes = chaves diferentes, sessions diferentes = chaves diferentes, formato do output (hex string de 64 chars)

## 5. Twilio BSP Adapter

- [x] 5.1 Criar `src/modules/whatsapp/server/adapters/twilio-bsp.ts` — funcao `sendTemplate(input: { to: string, fromAccountId: string, templateKey: string, variables: Record<string, string>, bodyRendered: string, consentFooter?: string }): Promise<{ bspMessageId: string, status: string }>`. Usar twilio SDK para enviar via client.messages.create com contentSid e contentVariables. Mapear erros Twilio: 21211 -> INVALID_PHONE, 21610 -> BLOCKED_BY_USER, 21614 -> OPT_OUT, 20429 -> RATE_LIMIT, default -> UNKNOWN. Exportar tipo TwilioSendError
- [x] 5.2 Criar `src/modules/whatsapp/server/adapters/twilio-signature.ts` — funcao `validateTwilioSignature(authToken: string, signature: string, url: string, params: Record<string, string>): boolean` usando twilio.validateRequest

## 6. Inngest Functions — Dispatcher + Sender

- [ ] 6.1 Criar/verificar `src/modules/whatsapp/inngest/client.ts` — instancia do Inngest client se nao existir. Exportar tipos de eventos: `whatsapp.reminder.send`, `whatsapp.status.updated`, `whatsapp.confirmation.received`, `whatsapp.cancellation.received`, `whatsapp.stop.received`, `whatsapp.inbound.received`, `whatsapp.confirmation.ack`
- [ ] 6.2 Criar `src/modules/whatsapp/inngest/reminders-dispatcher.ts` — Inngest function com cron `TZ=America/Sao_Paulo */5 * * * *`. Usa step.run para: buscar psicologos com whatsapp_accounts.status='active' E reminder_settings configurado, para cada buscar sessoes com status='scheduled' E reminders_disabled=false na janela de tempo, computar reminder window, verificar idempotency key nao existe em whatsapp_messages, fan-out emitindo eventos `whatsapp.reminder.send` via step.sendEvent
- [ ] 6.3 Criar `src/modules/whatsapp/inngest/reminder-sender.ts` — Inngest function trigger `whatsapp.reminder.send`, idempotency key `event.data.idempotencyKey`, retries: 3. Steps: (1) check idempotency em DB, (2) check se e primeira mensagem ao paciente (consent footer), (3) selectTemplateVariables, (4) renderTemplate, (5) sendTemplate via adapter, (6) INSERT whatsapp_messages. Em caso de INVALID_PHONE ou BLOCKED_BY_USER: status='unable_to_send', sem retry. Em caso de falha apos retries: status='failed', notificar psicologo
- [ ] 6.4 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/reminders-dispatcher.int.test.ts` — mock do Inngest (ou usar inngest test framework): criar psicologo com whatsapp_accounts.status='active' e reminder_settings, criar sessao amanha, rodar dispatcher, verificar que evento de send foi enfileirado. Executar novamente (idempotencia) e verificar que NAO enfileira de novo. Patient opt-out nao enfileira. Session reminders_disabled nao enfileira. Account em erro nao enfileira. Sessao cancelled nao enfileira
- [ ] 6.5 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/reminder-sender.int.test.ts` — mock do Twilio adapter: executar sender com evento valido, verificar whatsapp_messages criada com bsp_message_id e status='sent'. Caso de falha BSP: verificar status='failed' apos retries e notificacao criada. Caso INVALID_PHONE: status='unable_to_send' sem retry. Verificar consent footer adicionado na primeira mensagem, omitido na segunda

## 7. Inngest Functions — Confirmation ACK + Cancellation Notice + Consent Footer

- [ ] 7.1 Criar `src/modules/whatsapp/inngest/confirmation-ack-sender.ts` — Inngest function trigger `whatsapp.confirmation.ack`. Busca sessao + paciente, seleciona variaveis para kind 'confirmed_ack', renderiza template `confirmacao_recebida`, envia via adapter, persiste whatsapp_messages
- [ ] 7.2 Criar `src/modules/whatsapp/inngest/cancellation-notice-sender.ts` — Inngest function trigger `agenda/session.cancelled`. Verifica: cancelled_by != 'patient' (paciente ja sabe), patient.whatsapp_opt_out = false, whatsapp_accounts.status = 'active'. Se ok: seleciona variaveis para kind 'cancelled', renderiza `cancelamento_aviso`, envia via adapter, persiste whatsapp_messages
- [ ] 7.3 Criar `src/modules/whatsapp/inngest/consent-footer-sender.ts` — logica inline no reminder-sender (nao funcao separada). Ja coberto pela step 2 do reminder-sender (6.3). Este item apenas documenta que o consent footer e implementado como parte do fluxo do sender, nao como funcao Inngest separada
- [ ] 7.4 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/cancellation-notice-on-cancel.int.test.ts` — mock do adapter: cancelar sessao pelo psicologo, verificar que cancelamento_aviso foi enviado. Cancelar pelo paciente: nao envia. Patient opt-out: nao envia. Account erro: nao envia

## 8. Inngest Function — Reconciliation Poller

- [ ] 8.1 Criar `src/modules/whatsapp/inngest/reconciliation-poller.ts` — Inngest function com cron `*/30 * * * *`. Busca whatsapp_messages com status IN ('queued', 'sent') e sent_at < NOW() - 5 min. Para cada, consulta Twilio Messages API por bsp_message_id e atualiza status/timestamps no DB
- [ ] 8.2 **Teste de integracao (inline no sender test):** O teste de reconciliacao e coberto ao verificar que mensagens stuck sao atualizadas. Se necessario, adicionar caso em `reminder-sender.int.test.ts` que simula mensagem stuck e verifica atualizacao

## 9. Route Handler — Twilio Webhook

- [ ] 9.1 Criar `src/app/api/webhooks/twilio/whatsapp/route.ts` — Route Handler POST. Sequencia: (1) ler raw body, (2) validar X-Twilio-Signature via validateTwilioSignature, (3) parsear payload (detectar tipo: status update, button reply, inbound text, PARAR), (4) emitir evento Inngest correspondente, (5) retornar 200. Nenhuma logica de negocio sincrona alem do parse
- [ ] 9.2 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/webhook-status.int.test.ts` — POST com payload de status 'delivered'/'read'/'failed' e assinatura HMAC valida: verificar que whatsapp_messages e atualizado corretamente. Assinatura invalida: 403
- [ ] 9.3 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/webhook-button-confirm.int.test.ts` — POST com Quick Reply "Confirmar" e assinatura valida: verificar sessions.status='confirmed', confirmed_at setado, evento de ack enfileirado. Duplicata ignorada
- [ ] 9.4 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/webhook-button-cancel.int.test.ts` — POST com Quick Reply "Nao posso comparecer" e assinatura valida: sessao cancelada (cancelled_by='patient'), regra de antecedencia aplicada. Duplicata ignorada
- [ ] 9.5 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/webhook-stop-command.int.test.ts` — POST com texto "PARAR"/"parar"/" PARAR ": paciente marcado como opt-out, confirmacao enviada, psicologo notificado. Texto "quero parar de ir na quarta": NAO processa como opt-out

## 10. Server Actions — Settings + Toggle

- [ ] 10.1 Criar `src/modules/whatsapp/server/reminders/get-reminder-settings.ts` — Server Action que busca reminder_settings por user_id. Se nao existe, retorna defaults (early=24, final=2, video=30, night=false)
- [ ] 10.2 Criar `src/modules/whatsapp/server/reminders/save-reminder-settings.ts` — Server Action que valida input com reminderSettingsSchema, faz upsert (INSERT ON CONFLICT user_id DO UPDATE). Revalida path '/app/configuracoes/lembretes'
- [ ] 10.3 Criar `src/modules/whatsapp/server/reminders/toggle-session-reminders.ts` — Server Action que recebe sessionId e remindersDisabled (boolean), verifica ownership, atualiza sessions.reminders_disabled
- [ ] 10.4 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/reminder-settings-crud.int.test.ts` — testar contra Postgres real: get sem registro (retorna defaults), save cria registro, save atualiza existente, RLS cross-user bloqueado, toggle-session-reminders funciona e verifica ownership

## 11. Notifications In-App (minimal)

- [ ] 11.1 Verificar se existe helper `notify(userId, payload)` ou tabela `notifications`. Se nao existir, criar tabela `notifications` em `src/shared/db/schema/notifications/tables.ts`: id (uuid PK), user_id (uuid NOT NULL, FK auth.users), type (varchar 50 NOT NULL), title (varchar 200 NOT NULL), body (text), action_url (text), read_at (timestamptz), created_at (timestamptz DEFAULT now()). RLS por user_id. Criar helper `src/modules/notifications/server/notify.ts` que insere na tabela
- [ ] 11.2 Criar `src/modules/notifications/index.ts` — barrel exportando `notify`

## 12. Frontend — Configuracoes > Lembretes

- [ ] 12.1 Criar Server Component `src/app/(app)/configuracoes/lembretes/page.tsx` — titulo h1 "Configuracoes de Lembretes" (28px/600). Carrega settings via Server Action getReminderSettings. Renderiza form component
- [ ] 12.2 Criar componente `src/modules/whatsapp/components/reminder-settings-form.tsx` (Client Component) — Card default (border, radius xl, padding space-6, shadow xs). React Hook Form + Zod (reminderSettingsSchema). Secoes separadas por Separator: "Lembrete antecipado" RadioGroup (Nao enviar/24h/12h/48h), "Lembrete final" RadioGroup (Nao enviar/2h/1h/30min), "Aviso de link de video" Select (15/30/60 min), "Enviar de madrugada" Switch (OFF default) com helper text body-sm text-tertiary. Footer: "Salvar" Button primary (loading state). Toast Sonner success "Configuracoes de lembretes salvas" border-left success-500
- [ ] 12.3 Criar route actions `src/app/(app)/configuracoes/lembretes/actions.ts` com `'use server'` — delega getReminderSettings, saveReminderSettings

## 13. Frontend — Checkbox em session-form (modify agenda-sessions)

- [ ] 13.1 Atualizar `src/modules/agenda/lib/session-input-schema.ts` — adicionar campo `reminders_disabled` (boolean optional default false) ao Zod schema
- [ ] 13.2 Atualizar `src/modules/agenda/components/session-form-modal.tsx` — adicionar Checkbox shadcn "Nao enviar lembretes WhatsApp para esta sessao" apos campo "Observacao", gap space-4. Visivel so se paciente tem phone E whatsapp_opt_out=false. Helper text body-sm text-tertiary "Util quando o paciente avisou que nao pode receber". Controlado pelo campo reminders_disabled do form
- [ ] 13.3 Atualizar Server Actions create-session e update-session para persistir reminders_disabled

## 14. Frontend — Banner de saude WhatsApp

- [ ] 14.1 Criar componente `src/modules/whatsapp/components/whatsapp-health-banner.tsx` — Alert danger (bg danger-50, text danger-700, icone AlertTriangle 20px). Texto: "Sua conexao com WhatsApp expirou. Lembretes nao estao sendo enviados." Button link "Reconectar" para /configuracoes/integracoes/whatsapp. Visivel se whatsapp_accounts.status='error' E reminder_settings tem ao menos um reminder habilitado. role="alert" aria-live="assertive"
- [ ] 14.2 Integrar banner no layout `src/app/(app)/layout.tsx` — renderizar WhatsAppHealthBanner no topo, acima do conteudo. Server Component que carrega status da conta e settings

## 15. Frontend — Route Actions (Inngest registration)

- [ ] 15.1 Registrar todas as Inngest functions no serve handler: reminders-dispatcher, reminder-sender, confirmation-ack-sender, cancellation-notice-sender, reconciliation-poller. Atualizar `src/app/api/inngest/route.ts` (ou criar se nao existir)

## 16. Module Barrel

- [ ] 16.1 Atualizar `src/modules/whatsapp/index.ts` — adicionar reexports de: Server Actions (getReminderSettings, saveReminderSettings, toggleSessionReminders), lib/reminders (computeReminderWindow, selectTemplateVariables, generateIdempotencyKey, reminderSettingsSchema), adapters (sendTemplate), components (ReminderSettingsForm, WhatsAppHealthBanner)

## 17. E2E Tests

- [ ] 17.1 **Teste E2E:** Criar `src/__tests__/e2e/seeded/whatsapp/reminder-settings.spec.ts` — fluxo: navegar para /app/configuracoes/lembretes, verificar formulario com defaults, selecionar early=24h e final=2h, salvar, verificar toast de sucesso, recarregar pagina e verificar que valores persistiram
- [ ] 17.2 **Teste E2E:** Criar `src/__tests__/e2e/seeded/whatsapp/session-disable-reminders.spec.ts` — fluxo: criar sessao com checkbox "Nao enviar lembretes" marcado, verificar que sessao foi criada com reminders_disabled=true na DB (query direta ou via detalhe da sessao)
- [ ] 17.3 **Teste E2E:** Criar `src/__tests__/e2e/seeded/whatsapp/confirmation-flow.spec.ts` — fluxo: simular webhook de "Confirmar" chamando POST /api/webhooks/twilio/whatsapp com payload e mock signature, verificar que UI mostra sessao como "Confirmada" (status badge success) e notificacao aparece
- [ ] 17.4 **Teste E2E:** Criar `src/__tests__/e2e/seeded/whatsapp/whatsapp-health-banner.spec.ts` — fluxo: setar whatsapp_accounts.status='error' e criar reminder_settings na DB, navegar para /app/agenda (ou qualquer pagina autenticada), verificar banner no topo com texto e link "Reconectar", clicar "Reconectar" e verificar navegacao para /configuracoes/integracoes/whatsapp
