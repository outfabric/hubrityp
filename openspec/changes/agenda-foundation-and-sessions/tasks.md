## 1. Dependencies

- [x] 1.1 Instalar FullCalendar packages: `npm install @fullcalendar/react @fullcalendar/core @fullcalendar/daygrid @fullcalendar/timegrid @fullcalendar/interaction`
- [x] 1.2 Instalar date-fns-tz para timezone handling: `npm install date-fns-tz`

## 2. Database Schema — Locations

- [x] 2.1 Criar `src/shared/db/schema/agenda/tables.ts` — tabela `locations` com colunas: id (uuid PK), user_id (uuid NOT NULL, FK auth.users manual na migration), name (varchar 120 NOT NULL), address (text, nullable), type (text NOT NULL, CHECK in_person/online/other), color (varchar 7, nullable), arrival_instructions (text, nullable), is_default (boolean DEFAULT false), created_at (timestamptz DEFAULT now()), updated_at (timestamptz DEFAULT now())
- [x] 2.2 Adicionar tabela `agenda_settings` em `src/shared/db/schema/agenda/tables.ts` — colunas: user_id (uuid PK, FK auth.users manual na migration), default_duration_minutes (integer NOT NULL DEFAULT 50), interval_minutes (integer NOT NULL DEFAULT 10), business_hours (jsonb NOT NULL DEFAULT '[{"day":1,"start":"08:00","end":"20:00"},{"day":2,"start":"08:00","end":"20:00"},{"day":3,"start":"08:00","end":"20:00"},{"day":4,"start":"08:00","end":"20:00"},{"day":5,"start":"08:00","end":"20:00"},{"day":6,"start":"08:00","end":"12:00"}]'), cancellation_policy (text, nullable), default_color (varchar 7, nullable), created_at (timestamptz DEFAULT now()), updated_at (timestamptz DEFAULT now())
- [x] 2.3 Adicionar tabela `sessions` em `src/shared/db/schema/agenda/tables.ts` — colunas: id (uuid PK), user_id (uuid NOT NULL, FK auth.users), patient_id (uuid nullable, FK patients), recurrence_id (uuid nullable — reserved for future use), is_blocking (boolean DEFAULT false), blocking_title (varchar 120, nullable), start_at (timestamptz NOT NULL), end_at (timestamptz NOT NULL), duration_minutes (integer NOT NULL), location_id (uuid nullable, FK locations), modality (text nullable, CHECK in_person/online), amount (text nullable — stored as string for decimal safety), notes (text nullable), color (varchar 7 nullable), status (text NOT NULL DEFAULT 'scheduled', CHECK scheduled/done), created_at (timestamptz DEFAULT now()), updated_at (timestamptz DEFAULT now()). Indexes: composite (user_id, start_at) para time-window queries, (patient_id, start_at DESC) para historico do paciente, (status, start_at) para filtros
- [x] 2.4 Adicionar tabela `session_history` em `src/shared/db/schema/agenda/tables.ts` — colunas: id (uuid PK), session_id (uuid NOT NULL, FK sessions ON DELETE CASCADE), user_id (uuid NOT NULL), action (text NOT NULL, CHECK created/updated/rescheduled/status_changed/deleted), changes (jsonb NOT NULL DEFAULT '{}'), created_at (timestamptz DEFAULT now()). Index: (session_id, created_at DESC)
- [x] 2.5 Criar `src/shared/db/schema/agenda/policies.ts` — RLS policies: locations usa `user_id = auth.uid()` (SELECT/INSERT/UPDATE/DELETE). agenda_settings usa `user_id = auth.uid()`. sessions usa `user_id = auth.uid()`. session_history usa `user_id = auth.uid()`. Seguir pattern exato de `src/shared/db/schema/patients/policies.ts`
- [x] 2.6 Criar `src/shared/db/schema/agenda/index.ts` — barrel reexportando tables e policies
- [x] 2.7 Atualizar `src/shared/db/schema/index.ts` — adicionar reexport de `./agenda`
- [x] 2.8 Rodar `npm run db:generate`, editar migration para incluir: RLS policies SQL, FK constraints manuais (user_id -> auth.users, patient_id -> patients, location_id -> locations), CHECK constraints para type/modality/status/action enums
- [x] 2.9 Testar migration com `npm run db:migrate` local
- [x] 2.10 **Teste de integracao:** Criar `src/__tests__/integration/agenda/agenda-schema.int.test.ts` — verificar: tabelas locations/sessions/agenda_settings/session_history existem, RLS habilitado em todas, CHECK constraints funcionam (rejeita type invalido, status invalido), indexes existem, FK constraints funcionam (session com location_id invalido falha)

## 3. Validators — Zod Schemas

- [x] 3.1 Criar `src/modules/agenda/lib/location-input-schema.ts` — Zod schema para criacao/edicao de location: name (string min 1 max 120), address (string optional), type (enum in_person/online/other), color (string regex hex optional), arrival_instructions (string optional), is_default (boolean optional). Exportar tipo via z.infer
- [x] 3.2 Criar `src/modules/agenda/lib/agenda-settings-input-schema.ts` — Zod schema: default_duration_minutes (number int, min 15 max 240), interval_minutes (number int, min 0 max 60), business_hours (array of { day: number 0-6, start: string HH:MM, end: string HH:MM } com refinement: end > start), cancellation_policy (string optional max 2000), default_color (string regex hex optional)
- [x] 3.3 Criar `src/modules/agenda/lib/session-input-schema.ts` — Zod schema para criacao/edicao de sessao: patient_id (string uuid, required quando is_blocking=false), is_blocking (boolean optional default false), blocking_title (string max 120, required quando is_blocking=true), start_at (string datetime ISO), duration_minutes (number int min 15 max 480), location_id (string uuid optional), modality (enum in_person/online, optional), amount (string optional — validar como numero positivo), notes (string optional max 2000), color (string regex hex optional), force_conflict (boolean optional — para forcar criacao apesar de conflito). Refinements: se is_blocking=true, patient_id nao e necessario; se is_blocking=false, patient_id e obrigatorio
- [x] 3.4 **Testes unitarios:** Criar `src/__tests__/unit/modules/agenda/lib/location-input-schema.test.ts` — testar: nome valido/vazio/longo demais, type valido/invalido, color hex valido/invalido, campos opcionais ausentes
- [x] 3.5 **Testes unitarios:** Criar `src/__tests__/unit/modules/agenda/lib/agenda-settings-input-schema.test.ts` — testar: duracao valida/invalida (abaixo de 15, acima de 240), intervalo valido, business_hours valido (end > start), business_hours invalido (end <= start), array vazio
- [x] 3.6 **Testes unitarios:** Criar `src/__tests__/unit/modules/agenda/lib/session-input-schema.test.ts` — testar: sessao valida com patient_id, blocking valido com blocking_title, blocking sem patient_id aceito, sessao normal sem patient_id rejeitado, duracao invalida, start_at invalido, amount como numero valido/invalido

## 4. Conflict Detection — Pure Function

- [x] 4.1 Criar `src/modules/agenda/lib/detect-conflicts.ts` — funcao pura `detectConflicts(candidate: { startAt: Date, endAt: Date }, existingSessions: Array<{ id: string, startAt: Date, endAt: Date, patientName: string | null, blockingTitle: string | null }>): ConflictResult[]`. Retorna array de sessoes que fazem overlap (existingStart < candidateEnd AND existingEnd > candidateStart). ConflictResult inclui session id, nome do paciente ou titulo do bloqueio, horario conflitante
- [x] 4.2 **Testes unitarios:** Criar `src/__tests__/unit/modules/agenda/lib/detect-conflicts.test.ts` — testar: sem conflito, overlap total, overlap parcial (inicio), overlap parcial (fim), sessao adjacente (sem overlap), multiplos conflitos, conflito com bloqueio, array vazio de existentes

## 5. Date/Timezone Helpers

- [x] 5.1 Criar `src/modules/agenda/lib/date-helpers.ts` — funcoes: `toSaoPauloTime(utcDate: Date): Date` (converte UTC para America/Sao_Paulo), `formatSessionTime(date: Date): string` (formata como "14:00"), `formatSessionDate(date: Date): string` (formata como "15 de mai. 2026"), `formatSessionDateFull(date: Date): string` (formata como "quinta-feira, 15 de maio de 2026"), `calculateEndTime(startAt: Date, durationMinutes: number): Date`, `isInPast(date: Date): boolean`. Todas usam date-fns com locale pt-BR e date-fns-tz para timezone
- [x] 5.2 **Testes unitarios:** Criar `src/__tests__/unit/modules/agenda/lib/date-helpers.test.ts` — testar: conversao UTC->SP correta (UTC-3), formatacao de hora/data em pt-BR, calculo de end time, isInPast com datas passadas/futuras/agora

## 6. Server Actions — Locations

- [x] 6.1 Criar `src/modules/agenda/server/list-locations.ts` — Server Action que lista todos os locations do psicólogo autenticado, ordenados por is_default DESC, name ASC
- [x] 6.2 Criar `src/modules/agenda/server/create-location.ts` — Server Action que valida input com locationInputSchema, autentica via session, insere location com user_id = session.user.id. Se is_default=true, limpa default anterior em transacao
- [x] 6.3 Criar `src/modules/agenda/server/update-location.ts` — Server Action que valida input, verifica ownership (query por id + user_id), atualiza. Se is_default mudou para true, limpa default anterior em transacao
- [x] 6.4 Criar `src/modules/agenda/server/delete-location.ts` — Server Action que verifica ownership, verifica se nao tem sessions vinculadas, deleta. Retorna erro se tem sessions vinculadas
- [x] 6.5 **Testes de integracao:** Criar `src/__tests__/integration/agenda/location-crud.int.test.ts` — testar contra Postgres real (Testcontainers): criar location, listar (retorna criado), editar (nome muda), deletar (some da lista), default toggle (limpa anterior), tentar deletar com session vinculada (erro), RLS cross-user (psicologo A nao ve locations de B)

## 7. Server Actions — Agenda Settings

- [x] 7.1 Criar `src/modules/agenda/server/get-agenda-settings.ts` — Server Action que busca agenda_settings por user_id. Se nao existe, retorna defaults (duration 50, interval 10, business hours padrao)
- [x] 7.2 Criar `src/modules/agenda/server/save-agenda-settings.ts` — Server Action que valida input com agendaSettingsInputSchema, faz upsert (INSERT ON CONFLICT user_id DO UPDATE)
- [x] 7.3 **Testes de integracao:** Criar `src/__tests__/integration/agenda/agenda-settings.int.test.ts` — testar: get sem registro (retorna defaults), save cria registro, save atualiza registro existente, RLS cross-user bloqueado

## 8. Server Actions — Sessions

- [x] 8.1 Criar `src/modules/agenda/server/list-sessions.ts` — Server Action que busca sessions por user_id dentro de uma janela de tempo (startDate, endDate). Faz JOIN com patients (para nome) e locations (para nome/tipo). Retorna array ordenado por start_at. Usa index (user_id, start_at) para performance
- [x] 8.2 Criar `src/modules/agenda/server/create-session.ts` — Server Action que: valida input com sessionInputSchema, verifica start_at nao e passado (RN-03.02), busca sessions existentes na janela de 24h, roda detectConflicts, se tem conflito e force_conflict=false retorna warning com conflitos, se force_conflict=true ou sem conflito insere session + history entry "created". Calcula end_at = start_at + duration_minutes
- [x] 8.3 Criar `src/modules/agenda/server/update-session.ts` — Server Action que: valida input, verifica ownership, detecta conflitos (excluindo a propria sessao), atualiza session, cria history entry "updated" ou "rescheduled" (se start_at/end_at mudou) com diff JSONB
- [x] 8.4 Criar `src/modules/agenda/server/delete-session.ts` — Server Action que: verifica ownership e status=scheduled, cria history entry "deleted" com snapshot da sessao, deleta session
- [x] 8.5 Criar `src/modules/agenda/server/mark-session-done.ts` — Server Action que: verifica ownership, muda status para "done", cria history entry "status_changed" com { status: { old: "scheduled", new: "done" } }
- [x] 8.6 Criar `src/modules/agenda/server/get-session-history.ts` — Server Action que busca history entries por session_id, ordenadas por created_at DESC. Verifica ownership via session_id JOIN sessions
- [x] 8.7 **Testes de integracao:** Criar `src/__tests__/integration/agenda/session-crud.int.test.ts` — testar contra Postgres real: criar sessao (sucesso), criar com conflito (retorna warning), criar com conflito + force (sucesso), criar bloqueio (is_blocking=true), criar no passado (erro), editar sessao (campos atualizados, history criado), deletar sessao (removida + history "deleted"), marcar como done (status muda), listar por janela de tempo (filtra corretamente), RLS cross-user (psicologo A nao ve sessions de B), history entries criadas corretamente em cada mutacao

## 9. Module Barrel

- [ ] 9.1 Criar `src/modules/agenda/index.ts` — barrel reexportando: Server Actions (listLocations, createLocation, updateLocation, deleteLocation, getAgendaSettings, saveAgendaSettings, listSessions, createSession, updateSession, deleteSession, markSessionDone, getSessionHistory), validators (locationInputSchema, agendaSettingsInputSchema, sessionInputSchema), lib (detectConflicts, date helpers), tipos inferidos dos schemas

## 10. Frontend — Sidebar Update

> **Design System Salvia**: sidebar nav item com Calendar icon, seguindo pattern ativo (brand-700 text, brand-50 bg, border-left 3px brand-500).

- [ ] 10.1 Atualizar sidebar/nav component para adicionar item "Agenda" com icone `Calendar` (Lucide 20px), link para `/app/agenda`, posicionado apos "Pacientes". Seguir pattern existente dos outros items. Active state: text `brand-700`, bg `brand-50`, border-left 3px `brand-500`

## 11. Frontend — Configuracoes > Locais de Atendimento

> **Design System Salvia**: Card interactive para cada location, Dialog para create/edit, AlertDialog para delete, Badge para tipo/default, empty state completo.

- [ ] 11.1 Criar Server Component `src/app/(app)/configuracoes/locais/page.tsx` — titulo h1 "Locais de Atendimento" (28px/600). Renderiza lista de locations via Server Action. Botao "+ Adicionar local" `Button primary` com icone `Plus` no topo
- [ ] 11.2 Criar componente `src/modules/agenda/components/location-card.tsx` (Client Component) — **Design system:** `Card interactive` (border `border`, radius `xl`, padding `space-6`, hover border `border-strong`). Nome em h4 (16px/500). Tipo como `Badge`: in_person `Badge neutral` "Presencial", online `Badge info` "Online", other `Badge neutral` "Outro". Color dot (8px circle com cor do location). Endereco em body-sm `text-secondary`. `Badge brand` "Padrao" se is_default. Menu de acoes: `MoreHorizontal` (20px) abrindo shadcn `DropdownMenu` com "Editar" (`Pencil`), "Marcar como padrao" (`CheckCircle2`), "Excluir" (`Trash2` `danger-500`). Mobile: padding `space-4`
- [ ] 11.3 Criar componente `src/modules/agenda/components/location-form-modal.tsx` (Client Component) — **Design system:** shadcn `Dialog` (max-width 480px, radius `2xl`, padding `space-8`). Titulo h3 "Adicionar local" ou "Editar local". React Hook Form + Zod (locationInputSchema). Campos: Nome `Input` (obrigatorio), Endereco `Input`, Tipo `Select` (Presencial/Online/Outro), Cor (6 swatches de cores preset), Instrucoes de chegada `Textarea` (3 rows), Marcar como padrao `Checkbox`. Gap label->input `space-2`, gap entre campos `space-4`. Footer: "Salvar" `Button primary` (loading state), "Cancelar" `Button secondary`. Validacao inline em blur com `AlertCircle` em `danger-700`
- [ ] 11.4 Criar componente `src/modules/agenda/components/location-delete-dialog.tsx` (Client Component) — **Design system:** shadcn `AlertDialog` (max-width 480px). Titulo "Excluir [nome]?". Descricao "Esta acao nao pode ser desfeita." Botao "Excluir" `Button danger`, "Cancelar" `Button secondary`
- [ ] 11.5 Criar componente `src/modules/agenda/components/locations-empty-state.tsx` — **Design system:** icone `Building2` 24px `text-tertiary` centralizado, h4 "Nenhum local cadastrado" (16px/500), descricao "Cadastre seu primeiro local de atendimento para vincular as sessoes" em `text-secondary`, CTA "Adicionar local" `Button primary`
- [ ] 11.6 Criar route actions `src/app/(app)/configuracoes/locais/actions.ts` com `'use server'` — delega createLocation, updateLocation, deleteLocation, listLocations

## 12. Frontend — Configuracoes > Agenda

> **Design System Salvia**: Card default para form, Select para duracoes, Checkbox + Select para business hours, Textarea para politica, swatches para cor.

- [ ] 12.1 Criar Server Component `src/app/(app)/configuracoes/agenda/page.tsx` — titulo h1 "Configuracoes da Agenda" (28px/600). Carrega settings via Server Action. Renderiza form component
- [ ] 12.2 Criar componente `src/modules/agenda/components/agenda-settings-form.tsx` (Client Component) — **Design system:** `Card default` (border, radius `xl`, padding `space-6`, shadow `xs`). React Hook Form + Zod (agendaSettingsInputSchema). Secoes separadas por shadcn `Separator`:
  - "Duracao padrao da sessao" — shadcn `Select` com opcoes 30/40/45/50/60/90/120 min, label em body (15px)
  - "Intervalo entre sessoes" — shadcn `Select` com opcoes 0/5/10/15/20/30 min
  - "Horario de funcionamento" — 7 rows (Dom-Sab), cada com: shadcn `Checkbox` (habilitado/desabilitado), label do dia em body (15px/400), dois shadcn `Select` para hora inicio/fim (06:00 a 22:00, step 30min). Rows desabilitadas em opacity 50%. Validacao: pelo menos 1 dia ativo
  - "Politica de cancelamento" — shadcn `Textarea` (5 rows), helper text "Este texto sera incluido no termo de consentimento" em caption `text-tertiary`
  - "Cor padrao das sessoes" — 6 color swatches (circles 32px, border `border`, selected: ring `shadow-focus`), nenhuma selecionada = sem cor padrao
  Footer: "Salvar" `Button primary` (loading state). Toast success "Configuracoes salvas" (Sonner, border-left `success-500`). Mobile: padding `space-4`
- [ ] 12.3 Criar route actions `src/app/(app)/configuracoes/agenda/actions.ts` com `'use server'` — delega getAgendaSettings, saveAgendaSettings

## 13. Frontend — Agenda Views (Calendar)

> **Design System Salvia**: FullCalendar wrapped em Client Component, custom event rendering com tokens DS, Card flat container, Tabs underline para view toggle, Button ghost para navegacao.

- [ ] 13.1 Criar Server Component `src/app/(app)/agenda/page.tsx` — titulo h1 "Agenda" (28px/600). Carrega sessions iniciais (semana atual) e agenda_settings via Server Actions em Promise.all. Renderiza AgendaCalendar (Client Component) com data inicial. Botao "+ Agendar" `Button primary` com icone `Plus` no topo direito. Botao "Bloquear horario" `Button secondary` com icone `Lock` ao lado
- [ ] 13.2 Criar componente `src/modules/agenda/components/agenda-calendar.tsx` (Client Component) — **Design system:** Container `Card flat` (border `border`, radius `xl`). FullCalendar com plugins [dayGridPlugin, timeGridPlugin, interactionPlugin]. Locale pt-BR. Custom headerToolbar desabilitado (usamos navegacao propria). Views: timeGridDay, timeGridWeek, dayGridMonth. initialView baseado em viewport (day < 768px, week >= 1024px). slotMinTime/slotMaxTime derivados de business_hours. slotDuration "00:30:00". businessHours configurado do agenda_settings. nowIndicator=true (linha current-time em `brand-500`). CSS overrides: header bg `surface-muted`, today bg `brand-50`, slot hover bg `brand-50`. editable=true, eventDrop handler, dateClick handler. Dynamic import via next/dynamic para nao impactar bundle de paginas que nao usam agenda
- [ ] 13.3 Criar componente `src/modules/agenda/components/agenda-nav-bar.tsx` (Client Component) — **Design system:** flex row, gap `space-4`. Botao prev `Button ghost` icone `ChevronLeft` (20px), botao next `Button ghost` icone `ChevronRight`. Botao "Hoje" `Button secondary`. Titulo do periodo em h2 (22px/600) — ex.: "Semana de 11 - 17 mai. 2026" ou "Quinta, 15 mai. 2026" ou "Maio 2026". Date-picker: shadcn `Popover` + shadcn `Calendar`. View toggle: shadcn `Tabs` underline — "Dia" / "Semana" / "Mes" (active: border-bottom 2px `brand-500`, text `primary`)
- [ ] 13.4 Criar componente `src/modules/agenda/components/session-event-chip.tsx` — **Design system:** Renderizado via FullCalendar eventContent prop. Sessao regular: bg do color da sessao ou `brand-100`, text `brand-700`, radius `sm`, padding `space-1 space-2`. Linha 1: nome paciente (body-sm 13px/500, truncate). Linha 2: hora inicio-fim (caption 12px/400 `text-secondary`). Icone location inline: `Building2` (in_person) ou `Video` (online), 12px `text-tertiary`. Bloqueio: bg `surface-muted`, border dashed `border-strong`. `Lock` icone 14px + titulo (body-sm 13px/400 `text-secondary`). Month view: pills compactos radius `full`, 22px height
- [ ] 13.5 Criar componente `src/modules/agenda/components/session-event-chip.css` — CSS module com overrides para FullCalendar: fc-event bg/border/radius, fc-timegrid-slot hover, fc-day-today bg, fc-col-header-cell bg/font, fc-timegrid-axis font/color. Todos usando CSS custom properties do DS (var(--color-*))

## 14. Frontend — Session Create/Edit Modal

> **Design System Salvia**: Dialog (640px md), React Hook Form + Zod, Combobox para paciente, Alert warning para conflito, loading state obrigatorio.

- [ ] 14.1 Criar componente `src/modules/agenda/components/session-form-modal.tsx` (Client Component) — **Design system:** shadcn `Dialog` (max-width 640px, radius `2xl`, padding `space-8`). Titulo h3 "Agendar sessao" (create) ou "Editar sessao" (edit), 18px/600. React Hook Form + Zod (sessionInputSchema). Campos:
  - "Paciente" — shadcn `Combobox` (Command + Popover) com busca, obrigatorio. Oculto quando is_blocking. Icone `User` 16px
  - "Data" — shadcn `Popover` + shadcn `Calendar`, icone `Calendar` 16px
  - "Hora inicio" — shadcn `Select` com slots de 30min a partir do business hours
  - "Duracao" — shadcn `Select` (30/40/45/50/60/90/120 min, default do agenda_settings)
  - "Hora fim" — auto-calculada, caption `text-tertiary` abaixo do campo duracao
  - "Local" — shadcn `Select` populado de locations, default = is_default
  - "Modalidade" — shadcn `RadioGroup` (Presencial / Online), icones `Building2` / `Video`
  - "Valor" — shadcn `Input` type text com mascara "R$ ", prefixo
  - "Observacao" — shadcn `Textarea` (3 rows, opcional)
  - "Cor" — 6 swatches preset
  Validacao inline em blur. Gap label->input `space-2`, gap entre campos `space-4`. Conflito: shadcn `Alert` variante warning (bg `warning-50`, text `warning-700`, icone `AlertTriangle`) com mensagem "Voce ja tem [Nome] das [hora] as [hora] nesse horario" e botao "Agendar mesmo assim" `Button secondary`. Footer: "Salvar" `Button primary` (loading state), "Cancelar" `Button secondary`. Mobile: full-screen Sheet slide-up
- [ ] 14.2 Criar componente `src/modules/agenda/components/block-form-modal.tsx` (Client Component) — **Design system:** shadcn `Dialog` (max-width 480px, radius `2xl`, padding `space-8`). Titulo h3 "Bloquear horario", 18px/600. Campos: Titulo `Input` (obrigatorio, placeholder "Ex.: Almoco, Supervisao"), Data (Popover + Calendar), Hora inicio (Select), Duracao (Select), Hora fim (auto-calc caption). Footer: "Bloquear" `Button primary` com icone `Lock`, "Cancelar" `Button secondary`

## 15. Frontend — Session Detail Drawer

> **Design System Salvia**: Sheet (right 480px desktop, bottom-up mobile), Separator entre secoes, Badge para status, Button secondary/primary para acoes.

- [ ] 15.1 Criar componente `src/modules/agenda/components/session-detail-drawer.tsx` (Client Component) — **Design system:** shadcn `Sheet` (side="right" desktop, side="bottom" mobile). Header: nome do paciente h3 (18px/600), `Badge neutral` "Agendada" com icone `Clock` (12px) ou `Badge success` "Realizada" com icone `CheckCircle2`. Body secoes separadas por shadcn `Separator`:
  - Data/hora: icone `Calendar` 16px + data formatada (formatSessionDateFull) + horario (14:00 - 14:50)
  - Local: icone `Building2`/`Video` 16px + nome do local + endereco em body-sm `text-secondary`
  - Modalidade: label em body
  - Valor: "R$ 200,00" se presente
  - Observacoes: texto se presente
  - Historico: lista de audit entries — cada entry em caption (12px) `text-tertiary`, formato "[data hora] — [acao]: [descricao]". Ordenado por created_at DESC. Icone `Clock` 12px antes de cada entry
  Para bloqueio: titulo em h3, data/hora, sem paciente/valor/modalidade. Acoes footer: sessao regular → "Editar" `Button secondary` icone `Pencil` + "Marcar como realizada" `Button primary` icone `CheckCircle2`. Bloqueio → "Editar" `Button secondary` icone `Pencil` + "Excluir" `Button danger` icone `Trash2`. Botao close (X) no canto superior direito. Escape fecha. Focus trap ativo

## 16. Frontend — Drag-and-Drop Reschedule

> **Design System Salvia**: AlertDialog para confirmacao, Alert warning para conflito no drop, toast Sonner para sucesso.

- [ ] 16.1 Criar componente `src/modules/agenda/components/reschedule-confirm-dialog.tsx` (Client Component) — **Design system:** shadcn `AlertDialog` (max-width 480px). Titulo "Remarcar sessao?". Descricao "Remarcar sessao de [paciente] para [nova data] as [nova hora]?". Se conflito no destino: shadcn `Alert` warning inline "Voce ja tem [Nome] nesse horario. Remarcar mesmo assim?". Botao "Confirmar" `Button primary`, "Cancelar" `Button ghost`. Toast success apos confirmar: Sonner "Sessao remarcada para [data] as [hora]" com `CheckCircle2`, border-left `success-500`

## 17. Frontend — Route Actions

- [ ] 17.1 Criar `src/app/(app)/agenda/actions.ts` com `'use server'` — delega listSessions, createSession, updateSession, deleteSession, markSessionDone, getSessionHistory, getAgendaSettings, listLocations

## 18. Frontend — E2E Tests

- [ ] 18.1 **Teste E2E:** Criar `src/__tests__/e2e/seeded/agenda/session-create.spec.ts` — fluxo: navegar para /app/agenda, clicar "+ Agendar", preencher paciente (buscar por nome), data, hora, local, clicar "Salvar", verificar que sessao aparece na grade da semana com nome do paciente e horario correto, clicar na sessao para abrir detail drawer, verificar campos
- [ ] 18.2 **Teste E2E:** Criar `src/__tests__/e2e/seeded/agenda/block-create.spec.ts` — fluxo: navegar para /app/agenda, clicar "Bloquear horario", preencher titulo "Almoco", data, hora inicio 12:00, duracao 60min, clicar "Bloquear", verificar que bloqueio aparece na grade com icone Lock e titulo "Almoco", estilo diferenciado (dashed border)
- [ ] 18.3 **Teste E2E:** Criar `src/__tests__/e2e/seeded/agenda/session-drag-drop.spec.ts` — fluxo: criar sessao via modal, drag sessao de 14:00 para 16:00, verificar dialog de confirmacao com nome do paciente e novo horario, confirmar, verificar toast de sucesso, verificar que sessao agora esta em 16:00
- [ ] 18.4 **Teste E2E:** Criar `src/__tests__/e2e/seeded/agenda/location-crud.spec.ts` — fluxo: navegar para /app/configuracoes/locais, verificar empty state, clicar "Adicionar local", preencher nome "Consultorio Centro" tipo Presencial, salvar, verificar card aparece na lista, editar nome para "Consultorio Sul", verificar atualizacao, marcar como padrao, verificar badge "Padrao", criar sessao e verificar que local padrao esta pre-selecionado
