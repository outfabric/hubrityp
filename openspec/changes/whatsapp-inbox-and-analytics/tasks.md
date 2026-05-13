## 1. Dependencies

- [x] 1.1 Adicionar env var `TWILIO_WHATSAPP_TEMPLATE_PRICE_BRL` ao modulo de env validado (`src/shared/env/server.ts`) com Zod coerce number, default `0.10`. Documentar no `.env.example`

## 2. Database Schema — Inbox Additions

- [x] 2.1 Adicionar colunas em `whatsapp_messages` no schema Drizzle existente (`src/shared/db/schema/whatsapp/tables.ts`): `read_at_by_psychologist` (timestamptz, nullable), `resolved_at` (timestamptz, nullable), `risk_flag` (boolean, NOT NULL, DEFAULT false), `risk_keywords` (jsonb, nullable — array de strings detectadas)
- [x] 2.2 Criar tabela `whatsapp_conversations` em `src/shared/db/schema/whatsapp/tables.ts` — colunas: id (uuid PK), user_id (uuid NOT NULL, FK auth.users manual na migration), patient_id (uuid NOT NULL, FK patients manual na migration), last_message_id (uuid NOT NULL, FK whatsapp_messages manual na migration), last_message_at (timestamptz NOT NULL), last_message_preview (varchar 80 NOT NULL), unread_count (integer NOT NULL DEFAULT 0), has_risk (boolean NOT NULL DEFAULT false), updated_at (timestamptz DEFAULT now()). UNIQUE constraint em (user_id, patient_id). Indexes: (user_id, last_message_at DESC) para inbox list, (user_id, has_risk) para filtro de risco
- [x] 2.3 Adicionar RLS policies para `whatsapp_conversations` em `src/shared/db/schema/whatsapp/policies.ts` — SELECT/INSERT/UPDATE/DELETE com `user_id = auth.uid()`. Adicionar policy UPDATE em `whatsapp_messages` para permitir psicólogo atualizar `read_at_by_psychologist` e `resolved_at` nos registros dele
- [x] 2.4 Adicionar index GIN para full-text search em `whatsapp_messages.body` usando tsvector `portuguese` config — incluir na migration SQL. Adicionar index (user_id, patient_id, created_at DESC) para thread queries
- [x] 2.5 Atualizar barrel `src/shared/db/schema/whatsapp/index.ts` com novas exportacoes
- [x] 2.6 Rodar `npm run db:generate`, editar migration para incluir: RLS policies SQL, FK constraints manuais, UNIQUE constraint, GIN index, CHECK constraints se aplicavel
- [x] 2.7 Testar migration com `npm run db:migrate` local
- [x] 2.8 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/inbox/inbox-schema.int.test.ts` — verificar: colunas adicionadas em whatsapp_messages existem (read_at_by_psychologist, resolved_at, risk_flag, risk_keywords), tabela whatsapp_conversations existe com UNIQUE(user_id, patient_id), RLS habilitado em whatsapp_conversations, indexes existem (GIN em body, composite em user_id+last_message_at), FK constraints funcionam, RLS cross-user bloqueado

## 3. Pure Functions — Risk Detection and Clinical Content Blocker

- [ ] 3.1 Criar `src/modules/whatsapp/lib/inbox/detect-risk-keywords.ts` — funcao pura `detectRiskKeywords(body: string): { flagged: boolean; keywords: string[] }`. Dicionario PT-BR curado: "suicidio", "suicidar", "me matar", "acabar com tudo", "autolesao", "me cortar", "sumir pra sempre", "nao quero mais viver", "quero morrer", "tirar minha vida", "desistir de tudo", "nao aguento mais" (com variantes de acento). Regex case-insensitive com word boundaries. Lista de exclusao de falsos positivos: "matar saudade", "morrer de rir", "morrer de vontade", "matar a fome". Retorna array de keywords encontradas
- [ ] 3.2 **Testes unitarios:** Criar `src/__tests__/unit/modules/whatsapp/inbox/detect-risk-keywords.test.ts` — testar: keyword exata detectada ("me matar"), variante sem acento ("suicidio" vs "suicídio"), case-insensitive ("ME MATAR"), multiplas keywords no mesmo texto, falso positivo excluido ("matar saudade" nao flagga), texto neutro nao flagga ("confirmo a sessao"), retorno com array vazio quando sem match, retorno com array de todas keywords quando multiplas
- [ ] 3.3 Criar `src/modules/whatsapp/lib/inbox/clinical-content-blocker.ts` — funcao pura `checkClinicalContent(text: string): { allowed: boolean; reason?: string }`. Padroes detectados: codigos CID-10 (regex F\d{2}), referencias DSM-5, termos diagnosticos ("transtorno", "depressao maior", "ansiedade generalizada", "esquizofrenia"), marcadores de conteudo de sessao ("evolucao da sessao", "sessao de hoje", "conteudo da sessao", "relato do paciente"), referencias psicometricas ("score", "percentil", "escala", "resultado do teste", "BDI", "BAI", "WISC"). Retorna reason descritiva quando bloqueado
- [ ] 3.4 **Testes unitarios:** Criar `src/__tests__/unit/modules/whatsapp/inbox/clinical-content-blocker.test.ts` — testar: texto administrativo aprovado ("Confirmo seu horario de amanha"), texto clinico bloqueado (menciona diagnostico, score de teste, conteudo de evolucao, codigo CID), reason retornada descreve categoria do bloqueio, texto ambiguo tratado (erro no lado da cautela)

## 4. Pure Functions — Timestamp Formatting

- [ ] 4.1 Criar `src/modules/whatsapp/lib/inbox/format-conversation-time.ts` — funcao pura `formatConversationTime(date: Date, now?: Date): string`. Regras: <1 min = "agora", hoje = "h HH:mm" (ex: "h 14:30"), ontem = "ontem", <1 ano = "DD/MM", >=1 ano = "DD/MM/YYYY". Usa date-fns com locale pt-BR e timezone America/Sao_Paulo
- [ ] 4.2 **Testes unitarios:** Criar `src/__tests__/unit/modules/whatsapp/inbox/format-conversation-time.test.ts` — testar: "agora" (<1min), "h 14:30" (hoje), "ontem" (dia anterior), "15/05" (mesmo ano), "15/05/2025" (ano diferente), boundary cases (exatamente 1 min, meia-noite)

## 5. Validators — Zod Schemas

- [ ] 5.1 Criar `src/modules/whatsapp/lib/inbox/free-text-reply-schema.ts` — Zod schema: body (string min 1 max 4096), refinement que chama checkClinicalContent e retorna erro se blocked. Exportar tipo via z.infer
- [ ] 5.2 Criar `src/modules/whatsapp/lib/inbox/search-message-schema.ts` — Zod schema: query (string min 1 max 200), patientId (string uuid optional), dateRange (object { from: string ISO date, to: string ISO date } optional com refinement to >= from), page (number int min 1 default 1), pageSize (number int min 10 max 100 default 20). Exportar tipo via z.infer
- [ ] 5.3 **Testes unitarios:** Criar `src/__tests__/unit/modules/whatsapp/inbox/free-text-reply-schema.test.ts` — testar: body valido aceito, body vazio rejeitado, body >4096 rejeitado, body com conteudo clinico rejeitado (refinement), body administrativo aceito
- [ ] 5.4 **Testes unitarios:** Criar `src/__tests__/unit/modules/whatsapp/inbox/search-message-schema.test.ts` — testar: query valida, query vazia rejeitada, dateRange valido (to >= from), dateRange invalido (to < from) rejeitado, patientId UUID valido/invalido, paginacao defaults

## 6. Inngest — Inbox Message Ingest

- [ ] 6.1 Criar `src/modules/whatsapp/inngest/inbox/inbox-message-ingest.ts` — Inngest function que escuta evento `whatsapp.message.persisted`. Steps: 1) Busca mensagem por messageId do payload em whatsapp_messages; 2) Roda detectRiskKeywords(body); se flagged, atualiza whatsapp_messages SET risk_flag=true, risk_keywords=[...]; 3) Upsert em whatsapp_conversations (INSERT ON CONFLICT (user_id, patient_id) DO UPDATE — incrementa unread_count, atualiza last_message_id/at/preview, seta has_risk=true se flagged); 4) Dispara notificacao in-app para psicologo — se risk_flag=true, usa variant='danger' com icone AlertTriangle e titulo "Mensagem com alerta de risco recebida de [paciente]"; se nao, usa variant='info' com titulo "Nova mensagem de [paciente]"
- [ ] 6.2 Registrar a funcao no array de funcoes Inngest em `src/modules/whatsapp/inngest/index.ts`
- [ ] 6.3 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/inbox/message-ingest-flow.int.test.ts` — testar contra Postgres real: inserir whatsapp_message direction='inbound' e simular evento whatsapp.message.persisted → verificar que whatsapp_conversations foi criada/atualizada com unread_count=1, last_message_preview truncado, mensagem subsequente incrementa unread_count para 2
- [ ] 6.4 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/inbox/risk-flow.int.test.ts` — testar: mensagem com keyword "me matar" → risk_flag=true em whatsapp_messages, has_risk=true em whatsapp_conversations, notificacao com variant='danger' criada. Mensagem sem keyword → risk_flag=false, has_risk inalterado

## 7. Server Actions — Inbox

- [ ] 7.1 Criar `src/modules/whatsapp/server/inbox/list-conversations.ts` — Server Action paginada (50/pagina). Query whatsapp_conversations JOIN patients (nome, iniciais). Ordenar por last_message_at DESC. Filtros: only_unread (unread_count > 0), only_risk (has_risk=true), search (patient name ILIKE). Retorna array com patient info + conversation metadata
- [ ] 7.2 Criar `src/modules/whatsapp/server/inbox/get-conversation.ts` — Server Action: recebe patientId, busca ultimas 30 whatsapp_messages WHERE patient_id AND user_id ORDER BY created_at ASC. Side effect: UPDATE whatsapp_messages SET read_at_by_psychologist=now() WHERE read_at_by_psychologist IS NULL AND direction='inbound'. UPDATE whatsapp_conversations SET unread_count=0 WHERE patient_id AND user_id. Retorna mensagens + patient info
- [ ] 7.3 Criar `src/modules/whatsapp/server/inbox/send-free-text-reply.ts` — Server Action: valida com freeTextReplySchema, autentica via session, verifica janela 24h (query last inbound message created_at, rejeita se >24h), chama twilio adapter sendFreeText, persiste em whatsapp_messages (direction='outbound', template_key=null, status='sent'), upsert whatsapp_conversations com last_message atualizada. Retorna mensagem persistida
- [ ] 7.4 Criar `src/modules/whatsapp/server/inbox/send-template-reply.ts` — Server Action: recebe templateKey + variables, autentica, busca template aprovado, chama renderTemplate + sendTemplate (reuso change 1/2), persiste em whatsapp_messages (direction='outbound', template_key=templateKey). Retorna mensagem persistida
- [ ] 7.5 Criar `src/modules/whatsapp/server/inbox/mark-conversation-resolved.ts` — Server Action: recebe patientId, UPDATE whatsapp_messages SET resolved_at=now() WHERE patient_id AND user_id AND resolved_at IS NULL. Retorna count de mensagens resolvidas
- [ ] 7.6 Criar `src/modules/whatsapp/server/inbox/search-message-history.ts` — Server Action: valida com searchMessageSchema, query whatsapp_messages usando full-text search (to_tsvector('portuguese', body) @@ plainto_tsquery('portuguese', query)) filtrado por patientId e dateRange. JOIN patients para nome. Paginated. Retorna array + total count
- [ ] 7.7 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/inbox/conversation-list.int.test.ts` — testar: listagem paginada (seed 60 conversas, pagina 1 retorna 50, pagina 2 retorna 10), filtro only_unread, filtro only_risk, busca por nome de paciente, ordem cronologica DESC, RLS cross-user bloqueado
- [ ] 7.8 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/inbox/send-free-text-reply.int.test.ts` — testar: envio dentro da janela 24h (sucesso, mensagem persistida como outbound), envio fora da janela (erro), bloqueio quando clinical content detectado (erro com reason), adapter sendFreeText chamado com parametros corretos (mock)
- [ ] 7.9 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/inbox/send-template-reply.int.test.ts` — testar: envio com template aprovado (sucesso, mensagem persistida com template_key), template nao aprovado (erro), renderTemplate chamado corretamente
- [ ] 7.10 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/inbox/mark-resolved.int.test.ts` — testar: resolved_at setado em todas as mensagens da conversa, RLS cross-user nao permite resolver conversa alheia

## 8. Server Actions — Analytics

- [ ] 8.1 Criar `src/modules/whatsapp/server/inbox/get-analytics-summary.ts` — Server Action: recebe periodo (dateFrom, dateTo, defaults mes corrente). Queries agregadas em whatsapp_messages WHERE user_id AND created_at BETWEEN: total_sent (direction='outbound'), total_delivered (status IN ('delivered','read')), total_read (status='read'), total_confirmed (COUNT sessions com confirmed_at no periodo via JOIN whatsapp_messages.session_id), total_failed (status='failed'). Custo estimado: COUNT(direction='outbound' AND template_key IS NOT NULL) * TWILIO_WHATSAPP_TEMPLATE_PRICE_BRL. Retorna objeto com todas as metricas
- [ ] 8.2 **Teste de integracao:** Criar `src/__tests__/integration/whatsapp/inbox/analytics-summary.int.test.ts` — testar: contagens corretas por periodo (seed mensagens com diversos status), custo calculado com preco default, filtros de periodo funcionam, RLS cross-user isolado

## 9. Module Barrel

- [ ] 9.1 Atualizar `src/modules/whatsapp/index.ts` — adicionar reexports de: Server Actions inbox (listConversations, getConversation, sendFreeTextReply, sendTemplateReply, markConversationResolved, searchMessageHistory, getAnalyticsSummary), lib (detectRiskKeywords, checkClinicalContent, formatConversationTime), validators (freeTextReplySchema, searchMessageSchema), tipos inferidos

## 10. Frontend — Sidebar Update (Modify app-shell)

> **Design System Salvia**: sidebar nav item com MessageCircle icon, Badge danger para unread count, seguindo pattern ativo.

- [ ] 10.1 Atualizar sidebar/nav component para adicionar item "Caixa de entrada" com icone `MessageCircle` (Lucide 20px), link para `/app/caixa-de-entrada`, posicionado entre "Pacientes" e "Agenda". Active state: text `brand-700`, bg `brand-50`, border-left 3px `brand-500`. Quando unread_count total > 0, mostrar `Badge danger` com count a direita do label. Query para unread count via Server Action ou cache

## 11. Frontend — Pagina Caixa de Entrada (Layout)

> **Design System Salvia**: h1 28px/600 "Caixa de entrada", layout 2 colunas desktop (lista 380px + thread flex), mobile lista full com Sheet para thread.

- [ ] 11.1 Criar Server Component `src/app/(app)/caixa-de-entrada/page.tsx` — titulo h1 "Caixa de entrada" (28px/600). Carrega conversas iniciais via Server Action listConversations. Layout flex: lista esquerda 380px + thread direita flex-1. Mobile: lista full-width, thread em Sheet bottom-up ao clicar. Renderiza ConversationList + ConversationThread (Client Components)

## 12. Frontend — Conversation List Item

> **Design System Salvia**: padding space-3 space-4, gap space-3. Avatar 40px lg com iniciais brand-700 sobre brand-100. Body-sm para preview. Caption para timestamp.

- [ ] 12.1 Criar componente `src/modules/whatsapp/components/inbox/conversation-list-item.tsx` (Client Component) — **Design system:** padding `space-3` vertical `space-4` horizontal, gap `space-3`. Avatar 40px (lg) com iniciais do paciente em `brand-700` sobre `brand-100`. Coluna texto: nome em `body` (15px/600 se unread, 15px/400 se lido) + preview em `body-sm` (13px/400 `text-secondary`) truncate 1 linha. Coluna direita: timestamp em `caption` (12px/500 `text-tertiary`) formatado via formatConversationTime. Indicador unread: dot 8px `brand-500` a esquerda do nome. Indicador risco: icone `AlertTriangle` 16px `danger-500` ao lado do nome. Linha selecionada: bg `brand-50`. Hover: bg `surface-muted`. Separador: `border-subtle` entre items. Acessibilidade: role="button", aria-label="Conversa com [paciente], [N] mensagens nao lidas", foco visivel com shadow-focus

## 13. Frontend — Filtros e Busca

> **Design System Salvia**: Tabs underline para filtros, Input com icone Search 16px para busca.

- [ ] 13.1 Criar componente `src/modules/whatsapp/components/inbox/conversations-filters.tsx` (Client Component) — **Design system:** barra flex row entre tabs e busca. shadcn `Tabs` underline: "Todas" | "Nao lidas" | "Risco" (active: border-bottom 2px `brand-500`, text `primary`; idle: text `secondary`). Input de busca a direita com icone `Search` 16px `text-tertiary`, placeholder "Buscar paciente...", border `border`, radius `md`. Debounce de 300ms na busca. Mobile: tabs acima, busca abaixo (stack vertical)

## 14. Frontend — Conversation Thread

> **Design System Salvia**: bolhas com radius lg. Outbound: bg brand-100 text brand-700, alinhado direita. Inbound: bg surface-muted text text-primary, alinhado esquerda. Status icons no footer.

- [ ] 14.1 Criar componente `src/modules/whatsapp/components/inbox/conversation-thread.tsx` (Client Component) — **Design system:** header com Avatar 40px + nome do paciente em h3 (18px/600) + botao "Marcar como resolvida" (Button ghost, icone Check 16px). Lista cronologica de bolhas em scroll area. Outbound: bg `brand-100`, text `brand-700`, alinhado direita, radius `lg`, padding `space-3`. Footer: hora em caption 12px `text-tertiary` + icone status (Check 12px enviado / CheckCircle2 12px entregue / CheckCircle2 12px `brand-500` lido). Inbound: bg `surface-muted`, text `text-primary`, alinhado esquerda, radius `lg`, padding `space-3`. Footer: hora em caption 12px `text-tertiary`. Risco (risk_flag=true): borda `danger-500` 1.5px + icone `AlertTriangle` 14px `danger-500` no canto superior direito da bolha. Scroll automatico para ultima mensagem ao abrir. Sem cards aninhados (DS proibe)

## 15. Frontend — Risk Alert Banner

> **Design System Salvia**: Alert danger no topo do thread. bg danger-50, border-left danger-500 4px, icone AlertTriangle 24px, text danger-700.

- [ ] 15.1 Criar componente `src/modules/whatsapp/components/inbox/risk-alert-banner.tsx` — **Design system:** shadcn `Alert` variante danger. bg `danger-50`, border-left `danger-500` 4px, icone `AlertTriangle` 24px, text `danger-700`. Texto: "Mensagem com conteudo de risco detectado. Atencao: avalie pessoalmente. O sistema NAO substitui escuta clinica." Link "Saiba mais" em text `danger-700` underline on hover (sem JS — link para docs interno futuro, href="#"). Condicional: exibido apenas quando conversa tem has_risk=true. aria-live="assertive" para acessibilidade

## 16. Frontend — Message Composer

> **Design System Salvia**: footer da thread com 2 estados. Textarea shadcn auto-grow. Button primary "Enviar" com icone Send. Alert warning para clinical block. Alert info para janela expirada. Dialog para template.

- [ ] 16.1 Criar componente `src/modules/whatsapp/components/inbox/message-composer.tsx` (Client Component) — **Design system:** footer fixo do thread, border-top `border-subtle`, padding `space-4`. **Estado 1 — dentro da janela 24h** (ultima inbound <24h): shadcn `Textarea` (1-5 linhas auto-grow, border `border`, radius `md`, bg `surface-sunken`), placeholder "Escreva uma mensagem...". Botao `Button primary` sm "Enviar" com icone `Send` 16px. Button ghost para anexar (icone `Paperclip` 16px, disabled com tooltip "Em breve"). Loading state obrigatorio no envio (spinner no botao). Se clinical-content-blocker retorna blocked: shadcn `Alert` variante warning inline (bg `warning-50`, icone `AlertTriangle`, text `warning-700`): "Esse conteudo parece ser clinico. Por politica do WhatsApp e LGPD, conversas clinicas devem ficar no prontuario. Use mensagens administrativas apenas." Botao Enviar fica disabled enquanto alert visivel. **Estado 2 — fora da janela 24h** (ultima inbound >=24h): composer desabilitado (Textarea readonly, opacity 50%). Alert info inline (bg `info-50`, icone `Info` 16px, text `info-700`): "A janela de 24h expirou. Use um template aprovado." Botao `Button secondary` "Enviar template..." que abre Dialog
- [ ] 16.2 Criar componente `src/modules/whatsapp/components/inbox/template-reply-dialog.tsx` (Client Component) — **Design system:** shadcn `Dialog` (max-width 640px, radius `2xl`, padding `space-8`). Titulo h3 "Enviar template" (18px/600). shadcn `Combobox` (Command + Popover) para selecionar template aprovado. Ao selecionar, exibe form de variaveis (campos Input para cada variavel do template, label = nome da variavel). Preview do template renderizado em Card flat (bg surface-muted, radius lg, padding space-4, body-sm text-secondary). Footer: "Enviar" Button primary (loading state), "Cancelar" Button secondary. Mobile: Dialog vira Sheet bottom-up

## 17. Frontend — Mark Resolved Button

- [ ] 17.1 Criar componente `src/modules/whatsapp/components/inbox/mark-resolved-button.tsx` (Client Component) — **Design system:** `Button ghost` sm no header do thread. Icone `Check` 16px + texto "Marcar como resolvida". Tooltip (shadcn Tooltip) "Move conversa para Resolvidas". Loading state no click. Apos sucesso: toast Sonner success "Conversa marcada como resolvida" com CheckCircle2, border-left success-500

## 18. Frontend — Pagina Historico e Analytics

> **Design System Salvia**: h1 28px/600, cards flat em grid 4 colunas (mobile 2). Caption-upper para labels. Select para periodo. Tabela com Badge semantico. Mobile: cards stackados.

- [ ] 18.1 Criar Server Component `src/app/(app)/configuracoes/lembretes/historico/page.tsx` — titulo h1 "Historico de Lembretes" (28px/600). Carrega analytics summary via Server Action. Renderiza AnalyticsDashboard (Client Component)
- [ ] 18.2 Criar componente `src/modules/whatsapp/components/inbox/analytics-dashboard.tsx` (Client Component) — **Design system:** Grid 4 colunas desktop (gap space-6), 2 colunas mobile. Cada card: `Card flat` (border, radius `xl`, padding `space-6`). Label em `caption-upper` (12px/500, tracking 0.06em, uppercase, text-tertiary). Valor em h2 (22px/600). Helper text em body-sm text-tertiary (ex: "+12% vs mes anterior" — calculado se dados do periodo anterior disponiveis). Cards: "Enviadas no mes", "Taxa de entrega" (%), "Taxa de leitura" (%), "Taxa de confirmacao" (%), "Custo estimado" (formatado "R$ XX,XX" em body-lg 17px/400). Filtro de periodo: shadcn `Select` (Mes corrente / Mes anterior / Ultimos 90 dias / Personalizado). Quando "Personalizado" selecionado, shadcn `Popover` + shadcn `Calendar` para range. Abaixo dos cards: tabela shadcn com colunas: Paciente (nome), Template (template_key ou "Texto livre"), Data/hora (formatado DD/MM HH:mm), Status (Badge semantico: "Enviada" neutral, "Entregue" info, "Lida" success, "Falhou" danger). Botao `MoreHorizontal` para detalhes. Mobile: tabela vira cards stackados. Paginacao na base

## 19. Frontend — Risk Keyword Config

> **Design System Salvia**: Textarea para keywords, Button primary "Salvar", helper text body-sm text-tertiary.

- [ ] 19.1 Criar componente `src/modules/whatsapp/components/inbox/risk-keyword-config.tsx` (Client Component) — **Design system:** Posicionado em Configuracoes > Lembretes > Avancado. Card default (border, radius xl, padding space-6). Titulo h3 "Palavras-chave de risco" (18px/600). shadcn `Textarea` (10 rows, border `border`, radius `md`, bg `surface-sunken`), placeholder "Uma palavra-chave por linha". Helper text em `body-sm` (13px/400) `text-tertiary`: "Heuristica — nunca substitui escuta clinica." Footer: `Button primary` "Salvar" com loading state. Toast success "Palavras-chave atualizadas" apos salvar

## 20. Frontend — Notificacao In-App de Risco

- [ ] 20.1 Integrar notificacao de risco com sistema de notificacao existente. Quando notificacao recebida com risk_flag=true: Toast Sonner com border-left `danger-500`, icone `AlertTriangle`, titulo "Mensagem com alerta de risco recebida de [paciente]", descricao "Avalie pessoalmente", action link para `/app/caixa-de-entrada?patient=[patientId]`. autoDismiss=0 (fixado ate dismiss manual). Quando risk_flag=false: Toast Sonner padrao com border-left `info-500`, titulo "Nova mensagem de [paciente]", autoDismiss=4000

## 21. Route Actions

- [ ] 21.1 Criar `src/app/(app)/caixa-de-entrada/actions.ts` com `'use server'` — delega listConversations, getConversation, sendFreeTextReply, sendTemplateReply, markConversationResolved
- [ ] 21.2 Criar `src/app/(app)/configuracoes/lembretes/historico/actions.ts` com `'use server'` — delega getAnalyticsSummary, searchMessageHistory

## 22. E2E Tests

- [ ] 22.1 **Teste E2E:** Criar `src/__tests__/e2e/seeded/whatsapp/inbox/inbox-list-and-open.spec.ts` — fluxo: seed conversas (3 pacientes com mensagens inbound), navegar `/app/caixa-de-entrada`, verificar lista mostra 3 conversas com nome/preview/timestamp, clicar na primeira, verificar thread exibe mensagens cronologicamente, verificar bolhas inbound (esquerda, bg surface-muted) e outbound (direita, bg brand-100)
- [ ] 22.2 **Teste E2E:** Criar `src/__tests__/e2e/seeded/whatsapp/inbox/risk-alert-flow.spec.ts` — fluxo: seed mensagem inbound com keyword "me matar" (risk_flag=true, has_risk=true na conversa), navegar caixa de entrada, verificar AlertTriangle visivel na lista ao lado do nome do paciente, clicar na conversa, verificar banner danger no topo do thread ("Mensagem com conteudo de risco detectado..."), verificar Toast Sonner persistente (nao desaparece sozinho)
- [ ] 22.3 **Teste E2E:** Criar `src/__tests__/e2e/seeded/whatsapp/inbox/send-reply-inside-window.spec.ts` — fluxo: seed conversa com mensagem inbound recente (<24h), navegar caixa de entrada, abrir conversa, verificar Textarea habilitado, digitar "Confirmo seu horario de amanha", clicar "Enviar", verificar loading state no botao, verificar nova bolha outbound aparece no thread com status 'sent'
- [ ] 22.4 **Teste E2E:** Criar `src/__tests__/e2e/seeded/whatsapp/inbox/send-template-outside-window.spec.ts` — fluxo: seed conversa sem mensagem inbound recente (>24h), navegar caixa de entrada, abrir conversa, verificar Textarea desabilitado com Alert info "A janela de 24h expirou", clicar "Enviar template...", verificar Dialog abre, selecionar template "lembrete_24h" no Combobox, preencher variaveis, clicar "Enviar", verificar bolha outbound aparece
- [ ] 22.5 **Teste E2E:** Criar `src/__tests__/e2e/seeded/whatsapp/inbox/clinical-block.spec.ts` — fluxo: seed conversa com mensagem inbound recente, abrir conversa, digitar "a paciente apresenta sintomas de ansiedade generalizada", verificar Alert warning aparece ("Esse conteudo parece ser clinico..."), verificar botao "Enviar" esta disabled
- [ ] 22.6 **Teste E2E:** Criar `src/__tests__/e2e/seeded/whatsapp/inbox/history-and-analytics.spec.ts` — fluxo: seed mensagens com diversos status (sent/delivered/read/failed), navegar `/app/configuracoes/lembretes/historico`, verificar cards de resumo (total enviadas, taxa de entrega, taxa de leitura, custo estimado com valor formatado), mudar filtro de periodo para "Mes anterior", verificar cards atualizam
