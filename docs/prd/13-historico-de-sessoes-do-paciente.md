# PRD 13 — Histórico de Sessões do Paciente

> **Pré-requisitos:** PRD 00 (visão geral), PRD 02 (gestão de pacientes), PRD 03 (agenda e agendamentos), PRD 05 (prontuário eletrônico).
>
> **Escopo de versão:** este PRD cobre exclusivamente o MVP. Gráficos de frequência, filtro de período (date range), export CSV do histórico e edição inline de valor financeiro ficam fora.

---

## 1. Contexto e problema

A tela de detalhes do paciente (`/pacientes/:id`) já possui as abas Visão geral, Prontuário e Anamnese funcionais. A aba **"Histórico de sessões"** existe no componente `PatientTabs` mas exibe apenas um placeholder "Em breve".

Hoje o psicólogo que precisa ver o histórico de sessões de um paciente específico tem que:
1. Ir à agenda
2. Navegar semana a semana
3. Reconhecer visualmente quais blocos pertencem àquele paciente
4. Clicar em cada sessão individualmente para ver detalhes

Esse caminho é lento, propenso a erro, e impossível para sessões de meses atrás. Não existe nenhuma visão consolidada que responda perguntas frequentes do psicólogo sobre um paciente:

- "Quantas sessões já tivemos?"
- "Ele tem faltado muito?"
- "Em quais sessões eu ainda não registrei evolução?"
- "Quando foi a última sessão?"

O Prontuário (PRD 05) é o espaço de **escrita** clínica — profundo e documental. A Agenda (PRD 03) é centrada no **tempo** e cobre **todos** os pacientes. O Histórico de Sessões é o espaço de **leitura clínico-operacional** centrado num **único** paciente: a ponte entre o que foi agendado e o que foi clinicamente registrado.

## 2. Objetivo da feature

Oferecer uma visão cronológica consolidada de todas as sessões de um paciente específico, com indicação visual de status, resumo estatístico e acesso direto ao registro de evolução — permitindo que o psicólogo feche a lacuna entre "sessão realizada" e "evolução registrada" sem sair da ficha do paciente.

## 3. Escopo

### Dentro do escopo (MVP)

- Lista cronológica de sessões agrupada por mês, na aba "Histórico de sessões" da ficha do paciente
- Strip de resumo estatístico no topo (total realizado, taxa de presença, pendências de evolução)
- Card por sessão com status visual, modalidade, local, duração, valor e link para evolução
- Badge "Sem evolução" com CTA para registrar evolução (sessões `done`)
- Filtro por status (client-side)
- Paginação (12 sessões iniciais + "Carregar mais")
- Empty state com CTA de agendar primeira sessão
- Indicadores de sessão remarcada, sessão de casal e registro retroativo

### Fora do escopo (versões futuras)

- Filtro de período (date range picker) — raramente usado no dia a dia; complexidade desproporcional para o MVP
- Heatmap / gráfico de frequência de sessões — nice-to-have de visualização
- Export CSV do histórico desta aba — já coberto pela exportação geral do paciente (RF-02.25)
- Edição inline de valor da sessão — pertence ao módulo financeiro (PRD 06)
- "Agendar sessão extra" a partir do histórico — depende de integração mais profunda com a agenda

## 4. User stories

- **Como psicóloga**, quero ver de relance quantas sessões já tive com um paciente e quantas ele faltou, para ter contexto clínico antes de atendê-lo.
- **Como psicóloga**, quero ver quais sessões realizadas ainda não têm evolução registrada, para não acumular pendências clínicas.
- **Como psicóloga**, quero clicar direto do histórico para registrar a evolução de uma sessão, sem precisar navegar pela agenda ou pelo prontuário.
- **Como psicóloga**, quero ver a evolução de uma sessão passada sem sair da ficha do paciente, para revisar anotações antes da sessão de hoje.
- **Como psicóloga**, quero filtrar rapidamente por sessões canceladas ou no-shows para avaliar a aderência do paciente ao tratamento.

## 5. Requisitos funcionais

### 5.1. Strip de resumo

**RF-13.01.** No topo da aba, exibir strip horizontal com:
- Total de sessões realizadas (`done`)
- Taxa de presença: `realizadas / (realizadas + canceladas_pelo_paciente + no_show) × 100`
- Sessões sem evolução — badge `warning` (bg `warning-50`, text `warning-700`) com contagem; oculto quando zero
- Data da última sessão realizada

**RF-13.02.** Os dados da strip são calculados no servidor via query agregada — sem round-trips adicionais.

### 5.2. Lista de sessões

**RF-13.03.** Lista cronológica em ordem decrescente (mais recente primeiro), agrupada visualmente por mês/ano como divisor.

**RF-13.04.** Exibir no máximo **1 sessão futura** — a próxima sessão agendada ou confirmada (`start_at` mais próximo do agora). Ela aparece no topo, separada das históricas por um divisor "Próxima sessão" / "Sessões anteriores". Sessões futuras além da próxima não são carregadas nesta aba (o psicólogo pode ter dezenas agendadas via recorrência; a agenda é o lugar certo para vê-las).

**RF-13.05.** Cada sessão é renderizada como card variante `interactive` (bg `surface`, border `border`, radius `xl`, shadow `xs`, padding `space-6` desktop / `space-4` mobile; hover: border `border-strong`). Campos do card:

| Campo | Origem | Obrigatório |
|---|---|---|
| Status (ícone Lucide + badge + label) | `sessions.status` | Sim |
| Data por extenso + dia da semana | `sessions.start_at` | Sim |
| Horário início — fim | `sessions.start_at` / `sessions.end_at` | Sim |
| Duração | `sessions.duration_minutes` | Sim |
| Modalidade (ícone Lucide) | `sessions.modality` | Se preenchido |
| Local (nome) | `locations.name` via `sessions.location_id` | Se preenchido |
| Valor | `sessions.amount` | Se preenchido |
| Indicador de evolução | `LEFT JOIN evolutions ON session_id` | Sim (para `done`) |
| Tag "Sessão de casal" | `sessions.patient_ids IS NOT NULL` | Se aplicável |
| Tag "Remarcada de [data]" | `sessions.rescheduled_from_session_id` | Se aplicável |
| Tag "Registro retroativo" | `sessions.is_late_record = true` | Se aplicável |

**RF-13.06.** Código de cores e ícones por status (todos ícones Lucide, 16px inline, `currentColor`):

| Status | Badge | Ícone Lucide | Label |
|---|---|---|---|
| `scheduled` | `info` (bg `info-50`, text `info-700`) | `Calendar` | Agendada |
| `confirmed` | `info` (bg `info-50`, text `info-700`) | `CheckCircle2` | Confirmada |
| `done` | `success` (bg `success-50`, text `success-700`) | `CheckCircle2` | Realizada |
| `cancelled` | `neutral` (bg `surface-muted`, text `text-secondary`) | `X` | Cancelada |
| `no_show` | `warning` (bg `warning-50`, text `warning-700`) | `AlertTriangle` | Não compareceu |

Ícones de modalidade (Lucide, 16px, `text-tertiary`):

| Modalidade | Ícone Lucide |
|---|---|
| `in_person` | `MapPin` |
| `online` | `Video` |

### 5.3. Indicador de evolução e CTAs

**RF-13.07.** Para sessões com status `done`:
- **Com evolução vinculada:** badge `success` (bg `success-50`, text `success-700`) "Evolução registrada" + botão `link` "Ver" que leva a `/pacientes/:id/prontuario/evolucoes/:evolutionId`
- **Sem evolução vinculada:** badge `warning` (bg `warning-50`, text `warning-700`) "Sem evolução" + botão `primary` "Registrar" que leva a `/pacientes/:id/prontuario/evolucoes/nova?sessionId=:sessionId`

**RF-13.08.** Para sessões com status `cancelled`, exibir no corpo expandido:
- Quem cancelou (`sessions.cancelled_by`)
- Motivo (`sessions.cancellation_reason`)
- Antecedência (`sessions.cancellation_notice`)
- Se foi cobrada (`sessions.charge_cancellation`)

**RF-13.09.** Para a próxima sessão futura (`scheduled` / `confirmed`), exibir botão `ghost` "Abrir na agenda" (ícone `ArrowRight` Lucide, 16px) que redireciona para `/agenda` com a sessão em foco.

### 5.4. Filtros

**RF-13.10.** Barra de filtros abaixo da strip, com chips alternáveis (seleção única). Filtros se aplicam apenas às sessões históricas (a próxima sessão futura, quando presente, permanece visível no topo independentemente do filtro):
- Todas (default)
- Realizadas
- Canceladas
- Não compareceu

**RF-13.11.** Filtro é aplicado client-side quando o total de sessões carregadas for ≤ 50. Acima disso, o filtro dispara nova query parametrizada.

### 5.5. Paginação

**RF-13.12.** Carregar as 12 sessões mais recentes na abertura da aba (cobre ~3 meses de atendimento semanal).

**RF-13.13.** Botão `secondary` "Carregar mais (N sessões anteriores)" ao final da lista; carrega mais 12 por clique. Loading state obrigatório (spinner substitui ícone esquerdo) durante a requisição.

**RF-13.14.** A contagem de sessões restantes é exibida no botão. Quando não houver mais, o botão desaparece.

### 5.6. Casal

**RF-13.15.** Se a sessão tem `patient_ids` preenchido (sessão de casal), exibir badge `neutral` (bg `surface-muted`, text `text-secondary`) "Sessão de casal". Não exibir nome ou dados do parceiro nesta aba — respeitar sigilo individual (RN-02.07 do PRD 02). As tags "Remarcada de [data]" e "Registro retroativo" também usam badge `neutral`.

### 5.7. Empty state

**RF-13.16.** Quando o paciente não tem nenhuma sessão, exibir empty state conforme padrão Sálvia (3 partes):
- **Ícone:** `Calendar` (Lucide, 32px, `text-tertiary`)
- **Headline (h4):** "Nenhuma sessão registrada"
- **Descrição (`text-secondary`, body-sm):** "Agende a primeira sessão com [Nome] para começar a acompanhar o histórico."
- **CTA (botão `primary`):** "Agendar primeira sessão" — redireciona para `/agenda` abrindo modal de nova sessão pré-preenchido com o `patient_id`

### 5.8. Estados de sistema

**RF-13.17.** Loading state: skeleton de 3 cards (bg `surface-muted`, radius `xl`, animação pulse ≤ 200ms com `prefers-reduced-motion` respeitado).

**RF-13.18.** Error state: ícone `AlertCircle` (Lucide, 32px, `text-tertiary`), headline (h4) "Não foi possível carregar o histórico", descrição (`text-secondary`, body-sm) e botão `secondary` "Tentar novamente".

**RF-13.19.** Divisores de agrupamento por mês/ano: label em `caption-upper` (12px, weight 500, tracking 0.06em, uppercase, `text-tertiary`), separador `border-subtle`.

## 6. Requisitos não-funcionais

**RNF-13.01.** Carregamento da aba (12 sessões + strip): < 600ms (p95) para paciente com até 300 sessões.

**RNF-13.02.** "Carregar mais" retorna próxima página em < 400ms.

**RNF-13.03.** Query principal deve usar o índice existente `sessions_patient_id_start_at_idx` — sem necessidade de nova migration.

## 7. Regras de negócio

**RN-13.01.** Sessões soft-deleted (`deleted_at IS NOT NULL`) não aparecem no histórico.

**RN-13.02.** Bloqueios de horário (`is_blocking = true`) não aparecem no histórico — são eventos do psicólogo, não do paciente.

**RN-13.03.** A taxa de presença exclui cancelamentos feitos pelo psicólogo do denominador (não é justo penalizar o paciente por cancelamentos do profissional).

**RN-13.04.** O badge "Sem evolução" só é exibido para sessões com status `done`. Sessões agendadas, confirmadas, canceladas ou no-show não geram esta indicação.

**RN-13.05.** Se a evolução vinculada a uma sessão tem mais de 30 dias (`finalized_at` preenchido), o link "Ver" deve indicar que a evolução está em modo somente leitura (texto sutil "Finalizada" ao lado do link).

**RN-13.06.** Sessões de casal: nunca exibir dados do parceiro (nome, telefone, qualquer identificador) na aba de histórico. A tag "Sessão de casal" é a única indicação permitida — em conformidade com RN-02.07 (sigilo individual).

## 8. Edge cases

| Caso | Tratamento |
|---|---|
| Paciente com 200+ sessões | Paginação de 12 em 12 + agrupamento por mês mantém performance e legibilidade |
| Paciente com recorrência semanal (26+ sessões futuras) | Exibir apenas a próxima sessão futura; as demais ficam acessíveis na agenda |
| Sessão remarcada múltiplas vezes | Exibir apenas a tag da remarcação mais recente ("Remarcada de [data original]") |
| Sessão realizada hoje sem evolução | Badge "Sem evolução" aparece imediatamente; psicólogo pode registrar na hora |
| Sessão `done` com mais de 7 dias sem evolução | Badge permanece visível; dashboard (PRD 11) já gera notificação separada |
| Paciente tipo casal com sessões individuais E de casal | Ambas aparecem no histórico; sessões de casal têm tag, individuais não |
| Sessão sem valor financeiro preenchido | Campo "valor" simplesmente não é exibido no card |
| Sessão sem local preenchido | Campo "local" simplesmente não é exibido no card |
| Sessão lançada retroativamente (`is_late_record = true`) | Tag discreta "Registro retroativo" para diferenciar de sessões agendadas normalmente |
| Todas as sessões estão canceladas (taxa de presença = 0%) | Exibir "0% de presença" sem esconder o dado; alerta clínico relevante |
| Filtro ativo + carregar mais | Manter o filtro ao paginar; contagem de "sessões restantes" reflete o filtro ativo |

## 9. Critérios de aceitação

- [ ] Aba "Histórico de sessões" substitui o placeholder "Em breve" no `PatientTabs`
- [ ] Strip de resumo exibe total de realizadas, taxa de presença e pendências de evolução corretamente
- [ ] Badge "Sem evolução" aparece apenas para sessões `done` sem `evolutions.session_id` vinculado
- [ ] Clicar "Registrar" em sessão sem evolução leva a `/pacientes/:id/prontuario/evolucoes/nova?sessionId=:sessionId`
- [ ] Clicar "Ver" em sessão com evolução leva a `/pacientes/:id/prontuario/evolucoes/:evolutionId`
- [ ] No máximo 1 sessão futura (a próxima) aparece no topo com label "Próxima sessão"
- [ ] Paciente com 20 sessões recorrentes futuras exibe apenas a mais próxima
- [ ] Agrupamento por mês/ano funciona corretamente na transição dez→jan (virada de ano)
- [ ] Filtro por status funciona e persiste ao paginar
- [ ] "Carregar mais" carrega 12 sessões adicionais sem resetar o scroll
- [ ] Empty state exibe CTA "Agendar primeira sessão" para paciente sem sessões
- [ ] Sessões com `is_blocking = true` ou `deleted_at IS NOT NULL` não aparecem
- [ ] Sessão de casal exibe tag "Sessão de casal" sem revelar dados do parceiro
- [ ] Sessão remarcada exibe tag com data original
- [ ] Sessão retroativa exibe tag "Registro retroativo"
- [ ] Informações de cancelamento (motivo, quem, antecedência, cobrança) visíveis para sessões canceladas
- [ ] Carregamento da aba < 600ms (p95) para paciente com 100 sessões
- [ ] Psicólogo A não vê sessões do psicólogo B (RLS via `user_id = auth.uid()`)

## 10. Dependências

- Tabela `sessions` (PRD 03) — já implementada
- Tabela `evolutions` (PRD 05) — já implementada (FK `session_id`)
- Tabela `locations` (PRD 03) — já implementada
- Índice `sessions_patient_id_start_at_idx` — já existe
- Componente `PatientTabs` (`src/modules/patients/components/patient-tabs.tsx`) — já existe; alterar para receber o conteúdo da aba

## 11. Implicações LGPD / regulatórias

**LGPD-13.01.** O histórico de sessões contém dados sensíveis de saúde (art. 11 da LGPD). A abertura da aba deve gerar entrada em `audit_log` com `patient_id` e `user_id`, seguindo o mesmo padrão de auditoria de leitura do prontuário (PRD 05, RNF-05.05).

**LGPD-13.02.** Se o paciente exercer direito de acesso (art. 18), os dados exibidos nesta aba fazem parte do escopo de exportação (RF-02.25 do PRD 02) — datas de sessões, status, valores e evoluções.

**LGPD-13.03.** A aba nunca exibe dados de outro paciente, mesmo em sessões de casal (sigilo individual, Resolução CFP 001/2009). A tag "Sessão de casal" é informativa para o psicólogo; não revela identidade do parceiro.
