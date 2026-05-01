# PRD 03 — Agenda e Agendamentos

> **Pré-requisitos:** PRD 00, PRD 01, PRD 02.

---

## 1. Contexto e problema

A agenda é o coração operacional do consultório. O psicólogo hoje usa Google Agenda + caderno + cabeça para coordenar:
- Pacientes recorrentes (mesmo dia/horário toda semana)
- Pacientes esporádicos (agendamento avulso)
- Bloqueios pessoais (almoço, supervisão, terapia própria)
- Mudanças de horário ("podemos antecipar 30 min essa semana?")
- Cancelamentos e remarcações
- Diferentes locais de atendimento (consultório próprio, online, sala alugada)

Confusões aqui geram **prejuízo direto**: no-show de paciente, conflito de horário, paciente confuso sobre se a sessão é online ou presencial.

## 2. Objetivo da feature

Oferecer uma agenda visual e prática para o psicólogo gerenciar todas as sessões, com suporte a recorrência, múltiplos locais (presencial/online) e fluxo de cancelamento/remarcação rastreável.

## 3. Escopo

### Dentro do escopo
- Visualizações: dia, semana, mês
- Criação de sessão única
- Criação de sessão recorrente (semanal, quinzenal, mensal)
- Cancelamento e remarcação
- Bloqueio de horário (não-paciente: almoço, etc.)
- Múltiplos endereços de atendimento (presencial 1, presencial 2, online)
- Confirmação de presença pelo paciente (via link enviado por WhatsApp)
- Status de sessão: agendada, confirmada, realizada, cancelada, no-show
- Definição de duração padrão por psicólogo (50 min é padrão clínico)
- Cor/categoria por tipo de sessão

### Fora do escopo (versões futuras)
- Integração bidirecional com Google Calendar
- Booking público (paciente agendar sozinho via link, tipo Calendly) — versão 2
- Integração com Outlook/Apple Calendar — versão 2
- Lista de espera automatizada — versão 2
- Marcação automática de sala em coworking — versão 2

## 4. User stories

- **Como psicóloga**, quero ver minha agenda da semana de uma vez para planejar.
- **Como psicóloga**, quero agendar Marina toda terça às 14h por 6 meses sem ter que repetir o cadastro.
- **Como psicóloga**, quero remarcar uma sessão isolada da Marina sem afetar as outras recorrentes.
- **Como psicóloga**, quero bloquear minha quarta de manhã para supervisão sem que apareça como sessão de paciente.
- **Como psicóloga**, quero saber se o paciente confirmou a sessão de hoje antes de me preparar.
- **Como paciente**, quero confirmar minha presença via WhatsApp em um clique.

## 5. Requisitos funcionais

### 5.1. Visualizações de agenda (`/app/agenda`)

**RF-03.01.** Três visualizações alternadas por toggle:
- **Dia** (default mobile): coluna vertical com horários de 7h às 22h, slots de 30 min
- **Semana** (default desktop): grade 7 colunas (dom-sab) × horários
- **Mês**: calendário tradicional com pontinhos indicando sessões

**RF-03.02.** Navegação:
- Setas << e >> para anterior/próximo
- Botão "Hoje" para voltar ao período atual
- Date-picker para pular para data específica

**RF-03.03.** Cada sessão na grade mostra:
- Nome do paciente (ou "🔒 Bloqueio" se não for paciente)
- Hora início — hora fim
- Local (ícone: 🏢 presencial, 💻 online, 🏠 outro)
- Cor da tag/categoria
- Status (✓ confirmado, 🟡 agendado, ❌ cancelado, ⚠ no-show)

**RF-03.04.** Click na sessão abre modal com detalhes (ver 5.4).

**RF-03.05.** Drag-and-drop: arrastar sessão para outro horário a remarca (com confirmação).

**RF-03.06.** Click em horário vazio abre modal de criação rápida.

### 5.2. Criação de sessão única

**RF-03.07.** Modal com campos:
- Paciente (busca/select obrigatório)
- Data
- Hora início
- Duração (default vem da configuração do psicólogo, ex: 50 min)
- Hora fim (auto-calculada, editável)
- Local de atendimento (select dos locais cadastrados)
- Modalidade: Presencial / Online / Híbrido
- Valor (default vem do paciente; editável)
- Observação (opcional)
- Cor/categoria (opcional)

**RF-03.08.** Validação: impedir conflito de horário com outra sessão não-cancelada. Mostrar aviso "Você já tem [Nome] das 14h às 14:50 nesse horário" e oferecer escolher outro horário.

**RF-03.09.** Após salvar, status default é `scheduled`. Disparar evento que aciona PRD 04 (lembrete WhatsApp).

### 5.3. Criação de sessão recorrente

**RF-03.10.** Mesmo formulário de 5.2, com checkbox "Sessão recorrente" que abre opções:
- Frequência: Semanal / Quinzenal / Mensal / Personalizada
- Repetir até: Data específica / Número de ocorrências (ex: 24 sessões) / Indefinido
- Dias da semana (se semanal): permitir múltiplos (ex: terça e quinta)

**RF-03.11.** Sistema cria N sessões individuais ligadas a um `recurrence_id` comum.

**RF-03.12.** Editar uma sessão recorrente oferece três opções:
- "Apenas esta sessão"
- "Esta e todas as próximas"
- "Toda a série"

(Padrão Google Calendar — usuário já está acostumado.)

### 5.4. Detalhes e ações da sessão

**RF-03.13.** Modal de detalhes mostra:
- Todos os campos
- Histórico de alterações (criada em X, remarcada em Y)
- Status atual com ações:
  - Se `scheduled`: [Confirmar] [Remarcar] [Cancelar] [Marcar como realizada] [Marcar como no-show]
  - Se `confirmed`: [Remarcar] [Cancelar] [Marcar como realizada] [Marcar como no-show]
  - Se `done`: [Ver prontuário desta sessão] [Adicionar pagamento]
  - Se `cancelled`: [Reativar] [Excluir definitivamente]
  - Se `no_show`: [Cobrar falta] (se política do psi prevê)

**RF-03.14.** Botões de atalho:
- "Abrir vídeo" (se modalidade Online — link do Daily.co/Whereby/etc., ver PRD 09)
- "Abrir WhatsApp do paciente"
- "Abrir prontuário deste paciente"

### 5.5. Cancelamento e remarcação

**RF-03.15.** Cancelar pede:
- Motivo (select: Paciente cancelou / Psicólogo cancelou / Imprevisto / Outro)
- Quem cancelou (Paciente / Psicólogo)
- Antecedência (auto-calculada): 24h+, <24h, <1h, no horário
- Aplicar cobrança? (Sim/Não — depende da política do psicólogo)

**RF-03.16.** Cancelamento dispara aviso por WhatsApp ao paciente (template configurável — ver PRD 04).

**RF-03.17.** Remarcação é cancelamento + nova sessão; sistema oferece criar a nova sessão imediatamente, mantendo vínculo de "remarcação" no histórico.

### 5.6. Bloqueio de horário (não-paciente)

**RF-03.18.** Botão "Bloquear horário" cria evento com:
- Título livre (ex: "Almoço", "Supervisão", "Pessoal")
- Data, hora início, hora fim
- Recorrência opcional
- NÃO requer paciente

**RF-03.19.** Bloqueios aparecem com cor diferente e ícone 🔒.

### 5.7. Múltiplos locais de atendimento

**RF-03.20.** Em Configurações > Locais de Atendimento, psicólogo cadastra:
- Nome (ex: "Consultório Vila Mariana")
- Endereço completo
- Tipo: Presencial / Online / Outro
- Cor associada (opcional)
- Observação (instrução de chegada para o paciente)

**RF-03.21.** Cada sessão é vinculada a um local. Lembretes WhatsApp incluem endereço/instruções.

### 5.8. Confirmação de presença pelo paciente

**RF-03.26.** Sistema gera link único por sessão. Lembrete WhatsApp (PRD 04) inclui esse link com texto tipo "Confirme sua presença: [link]".

**RF-03.27.** Paciente clica → tela simples: "Você confirma a sessão de [data] às [hora] com [psicóloga]?" → [Confirmar] [Não posso comparecer].

**RF-03.28.** Confirmar muda status da sessão para `confirmed` e notifica psicólogo.

**RF-03.29.** "Não posso comparecer" abre formulário simples (motivo opcional), marca como `cancelled` e notifica psicólogo imediatamente. Aplica regra de antecedência (RF-03.15) para cobrança.

### 5.9. Configurações de agenda

**RF-03.30.** Configurações > Agenda permite:
- Duração padrão de sessão (default 50 min)
- Intervalo entre sessões (default 10 min)
- Horário de funcionamento (ex: seg-sex 8h-20h, sab 8h-12h)
- Política de cancelamento: tempo mínimo, valor cobrado, etc. (texto livre que vai no termo de consentimento)
- Cor padrão das sessões

## 6. Requisitos não-funcionais

**RNF-03.01.** Carregamento da agenda da semana: <800ms para até 50 sessões.

**RNF-03.02.** Drag-and-drop responsivo (<100ms feedback visual).

**RNF-03.03.** Suporte a fuso horário Brasília (UTC-3); preparado para outros fusos (psicólogo em Manaus = UTC-4).

## 7. Regras de negócio

**RN-03.01.** Não permitir conflito de horário (overlap) entre sessões não-canceladas. Aviso, não bloqueio absoluto (psicólogo pode forçar se quiser — caso de sessão dupla, supervisor presente, etc.).

**RN-03.02.** Não permitir agendar sessão no passado, exceto para "lançar sessão já realizada" (ver RF abaixo).

**RN-03.03.** "Lançar sessão já realizada": útil quando psicólogo registra sessão depois do fato. Marcação especial; não dispara lembretes; só aparece em histórico.

**RN-03.04.** Sessão `done` (realizada) não pode ser editada após 7 dias (preserva integridade do registro). Após 7 dias, apenas adicionar evolução ao prontuário (PRD 05).

**RN-03.05.** Cancelamento mantém o registro; nunca delete.

**RN-03.06.** Sessão sem evolução clínica registrada após 7 dias gera notificação ao psicólogo (lembrete de obrigação CFP).

**RN-03.07.** Status `no_show` é distinto de `cancelled`: paciente não avisou e não veio. Sistema permite cobrar falta conforme política. Estatísticas separadas.

## 8. Edge cases

| Caso | Tratamento |
|---|---|
| Paciente confirma e depois desiste sem avisar | Psicólogo marca como `no_show` manualmente |
| Sessão recorrente: paciente vai entrar em férias 4 semanas | Cancelar 4 sessões individuais ou pausar série temporariamente |
| Mudança de horário fixo (Marina passa de terça para quinta) | "Esta e todas as próximas" remarca para novo horário |
| Sessão online, paciente entra na sala antes do horário | Sala fica disponível 10 min antes (ver PRD 09) |
| Fuso horário viagem: psicóloga vai para os EUA por 1 mês | Sessões devem manter horário local Brasília (paciente está aqui); sistema mostra "duplo horário" se psicólogo está em fuso diferente |
| Sessão de avaliação neuropsicológica (3h em vez de 50 min) | Editar duração no formulário; sistema aceita |
| Atendimento de casal: 2 pacientes na mesma sessão | Vincular ambos pacientes à sessão (campo array `patient_ids`); apenas uma evolução de prontuário (mas com referência a cada um) |
| Bloqueio recorrente "almoço todo dia" | Suportar via recorrência |

## 9. Critérios de aceitação

- [ ] Visualização semana mostra 7 dias × horas, sessões nos slots corretos
- [ ] Criar sessão única funciona em <30 segundos
- [ ] Conflito de horário gera aviso com nome da outra sessão
- [ ] Sessão recorrente semanal por 6 meses cria 26 sessões ligadas
- [ ] Editar uma sessão recorrente oferece as 3 opções (esta / esta e próximas / toda série)
- [ ] Drag-and-drop remarca a sessão e dispara aviso ao paciente
- [ ] Bloqueio de horário aparece na agenda mas não no relatório de sessões
- [ ] Cancelar sessão registra motivo e quem cancelou
- [ ] Link de confirmação clicado pelo paciente atualiza status
- [ ] Sessão `done` não pode ser editada após 7 dias
- [ ] No-show é estatística separada de cancellation
- [ ] Endereço/instrução do local aparece no lembrete WhatsApp
- [ ] Casal: 2 pacientes vinculados à mesma sessão funciona

## 10. Dependências

- Lib de calendário visual: FullCalendar.js (recomendado) ou React Big Calendar
- PRD 02 (pacientes) já implementado
- PRD 04 (lembretes WhatsApp) — disparo de eventos
- PRD 09 (vídeo) — link de sala online

## 11. Referências regulatórias

- Resolução CFP 09/2024 — sessão online deve ter contrato e modalidade explícita
- Código de Ética do Psicólogo — sigilo da identidade do paciente

## Apêndice A — Modelo de dados

```sql
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  name VARCHAR(120) NOT NULL,
  address JSONB,
  type VARCHAR(20) NOT NULL, -- 'in_person', 'online', 'other'
  color VARCHAR(7), -- hex
  arrival_instructions TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  patient_id UUID REFERENCES patients(id), -- NULL se for bloqueio
  patient_ids UUID[], -- usado em sessão de casal
  recurrence_id UUID, -- agrupa sessões recorrentes
  is_blocking BOOLEAN DEFAULT FALSE, -- TRUE = bloqueio de horário
  blocking_title VARCHAR(120), -- 'Almoço', 'Supervisão'
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL,
  location_id UUID REFERENCES locations(id),
  modality VARCHAR(20), -- 'in_person', 'online', 'hybrid'
  amount DECIMAL(10,2),
  notes TEXT,
  color VARCHAR(7),
  status VARCHAR(20) DEFAULT 'scheduled', -- 'scheduled', 'confirmed', 'done', 'cancelled', 'no_show'
  cancellation_reason VARCHAR(50),
  cancelled_by VARCHAR(20), -- 'patient', 'therapist'
  cancelled_at TIMESTAMPTZ,
  cancellation_notice VARCHAR(20), -- '24h+', 'less_24h', 'less_1h', 'on_time'
  charge_cancellation BOOLEAN DEFAULT FALSE,
  confirmation_token VARCHAR(64) UNIQUE,
  confirmed_at TIMESTAMPTZ,
  google_event_id VARCHAR(255),
  is_late_record BOOLEAN DEFAULT FALSE, -- TRUE se foi lançada após acontecer
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE session_recurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  patient_id UUID REFERENCES patients(id),
  frequency VARCHAR(20) NOT NULL, -- 'weekly', 'biweekly', 'monthly', 'custom'
  days_of_week INT[], -- 0=domingo, 1=segunda...
  start_date DATE NOT NULL,
  end_date DATE,
  occurrence_count INT,
  is_indefinite BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_start ON sessions(user_id, start_at);
CREATE INDEX idx_sessions_patient ON sessions(patient_id, start_at DESC);
CREATE INDEX idx_sessions_status ON sessions(status, start_at);
```