# PRD 11 — Onboarding e Dashboard

> **Pré-requisitos:** PRD 00 (visão geral), PRD 01 (cadastro), PRD 02 (pacientes), PRD 03 (agenda), PRD 05 (prontuário), PRD 09 (telepsicologia) e PRD 10 (transcrição IA).
>
> **Escopo de versão:** este PRD cobre exclusivamente o MVP. As funcionalidades de cobrança/PIX (PRD 06), Receita Saúde (PRD 07), recibos de reembolso (PRD 08) e lembretes automáticos via WhatsApp (PRD 04) ainda não existem no MVP e **não devem ser referenciadas como dependências do fluxo central de onboarding**. Onde relevante, podem ser mencionadas como "em breve" sem bloquear nenhum passo.

---

## 1. Contexto e problema

O psicólogo completa o cadastro, confirma o email, passa pela validação do CRP — e então abre o sistema pela primeira vez. **O que ele vê?**

Sem onboarding bem desenhado, o primeiro acesso é desorientador:

- Não sabe por onde começar
- Não configura o local de atendimento nem a agenda
- Não cadastra nenhum paciente no primeiro dia
- Usa o sistema uma vez e some — churn em menos de 7 dias

**A dor é real:** psicólogos são profissionais ocupados, com baixa tolerância a fricção tecnológica. Se não enxergarem valor concreto na primeira semana — uma sessão agendada, um paciente cadastrado, uma evolução registrada — o produto perde para a inércia do caderno + Google Agenda.

**Métrica crítica:** Time to First Value (TTFV). Para o MVP, o objetivo é que o psicólogo conclua um ciclo completo de valor — **cadastrar um paciente → agendar uma sessão → registrar uma evolução** — dentro de 24 a 48h após o primeiro acesso.

**Dashboard inicial** é a tela que o psicólogo abre todo dia. Não pode ser um painel de boas-vindas vazio. Precisa ser operacional desde o primeiro dia.

## 2. Objetivo da feature

Levar o psicólogo do primeiro acesso ao **primeiro ciclo completo de valor do MVP** (paciente cadastrado + sessão agendada + evolução registrada) em menos de 24 horas, e oferecer um dashboard que entregue utilidade real a cada abertura do sistema.

## 3. Escopo

### Dentro do escopo (MVP)

- Tela de boas-vindas pós-cadastro
- Wizard de configuração inicial (4 passos essenciais do MVP)
- Checklist de primeiros passos vinculado às features do MVP
- Dashboard diário operacional (agenda, pacientes, pendências de prontuário)
- Tour guiado pela interface
- Notificações in-app
- Importação básica de pacientes (CSV)
- Pesquisa NPS aos 7 dias

### Fora do escopo (versões futuras)

- Passos de configuração de WhatsApp, Receita Saúde, cobrança PIX e recibos de reembolso no wizard — esses módulos não existem no MVP
- Onboarding com CSM humano (enterprise)
- Migração automática de Psicomanager / iClinic / Doctoralia
- Gamificação (níveis, badges)
- Resumo financeiro no dashboard (depende de PRD 06)
- Métricas de Receita Saúde no dashboard (depende de PRD 07)
- Módulo de notificações de pagamento (depende de PRD 06)

## 4. User stories

- **Como psicóloga recém-cadastrada**, quero entender em 2 minutos o que esse sistema faz por mim.
- **Como psicóloga**, quero configurar meu local de atendimento e agenda no primeiro dia.
- **Como psicóloga**, quero importar minha lista de 30 pacientes do Excel sem digitar um por um.
- **Como psicóloga**, quero abrir o sistema de manhã e ver imediatamente o que acontece hoje.
- **Como psicóloga**, quero saber se tenho sessões sem evolução registrada para cumprir minha obrigação com o CFP.
- **Como psicóloga**, quero gravar e transcrever uma sessão com IA já no primeiro uso para ver o diferencial.

## 5. Requisitos funcionais

### 5.1. Pós-cadastro: tela de boas-vindas

**RF-11.01.** Após validação de email e CRP (PRD 01), psicólogo cai em `/onboarding/welcome`:

- Saudação personalizada: "Olá, [Primeiro nome]! Tudo pronto para começar."
- Parágrafo curto: "Em 5 minutos você terá tudo configurado para sua primeira sessão no sistema."
- Botão primário: "Começar configuração (5 min)"
- Link secundário: "Pular e explorar por conta própria"

**RF-11.02.** Se psicólogo acessou o sistema antes de terminar o onboarding (ex: saiu no meio), ao logar é redirecionado de volta para o passo onde parou. Banner no topo: "Você ainda não terminou a configuração inicial — [continuar]".

### 5.2. Wizard de configuração (4 passos)

**RF-11.03.** Indicador de progresso visível (ex: "Passo 2 de 4") no topo de cada tela do wizard.

**RF-11.04.** Cada passo é skipável individualmente. Skip não bloqueia progressão.

**RF-11.05.** O wizard salva cada passo ao avançar. Se psicólogo sair, retoma do passo seguinte ao último salvo.

---

**Passo 1 — Sobre você**

Campos obrigatórios:
- Foto de perfil (upload opcional — aparece na tela do paciente em sessões online via PRD 09)
- Nome que aparecerá para pacientes (pode ser diferente do nome legal)
- Pronome (campo de texto livre)
- Especialização principal (autocomplete: TCC, psicanálise, sistêmica, ABA, fenomenológica, junguiana, gestáltica, humanista, etc.)
- Tipo de atuação: clínica / corporativa / mista

Microcopy de contexto: "Essas informações aparecem no seu perfil e nos termos de consentimento enviados aos pacientes."

---

**Passo 2 — Local e agenda**

Este passo configura os pré-requisitos diretos para agendar sessões (PRD 03).

- Adicionar pelo menos 1 local de atendimento:
  - Nome do local (ex: "Consultório Vila Madalena", "Online")
  - Tipo: Presencial / Online / Híbrido
  - Endereço (se presencial — autocomplete)
  - Instrução de chegada para o paciente (texto livre opcional)
- Duração padrão da sessão (default: 50 min)
- Intervalo entre sessões (default: 10 min)
- Horário de funcionamento (dias da semana + faixas de horário)

Microcopy: "Esses dados são usados na agenda e nos links de confirmação de sessão enviados aos pacientes."

---

**Passo 3 — Importe seus pacientes (opcional, mas recomendado)**

- Opção A: Upload CSV com colunas mapeáveis (nome, telefone, email, data_nascimento, observacao)
- Opção B: "Adicionar primeiro paciente agora" — abre formulário de cadastro rápido (PRD 02) com os campos mínimos
- Opção C: "Farei isso depois" — botão skip

Microcopy de incentivo: "Psicólogos com pacientes cadastrados usam o sistema todo dia. Importar leva menos de 2 minutos."

Para upload CSV:
- Preview das primeiras 5 linhas com mapeamento de colunas
- Validação antes de importar (destaca linhas com erro)
- Importação em background para listas grandes (>50 pacientes); notificação in-app ao concluir

---

**Passo 4 — Pronto para começar**

- Resumo do que foi configurado (ícones com check: perfil, local, pacientes)
- Para cada item não configurado: link direto com texto "Configurar agora" (não é bloqueante)
- Texto motivador: "Você está pronto para a primeira sessão. Que tal agendar agora?"
- Botão primário: "Ver minha agenda"
- Botão secundário: "Ir para o dashboard"

Seção informativa "O que vem em breve" (sem bloquear o fluxo):
> "Estamos desenvolvendo: lembretes automáticos por WhatsApp, cobrança via PIX integrada e emissão de Receita Saúde com um clique. Você será avisado quando estiverem disponíveis."

---

### 5.3. Dashboard (`/app`)

O dashboard é a tela de abertura diária do psicólogo. Com o MVP, as informações disponíveis são: agenda, pacientes, prontuário e transcrição IA. O layout reflete exatamente isso — sem seções vazias ou placeholders de features que não existem.

**RF-11.06.** Layout padrão desktop (4 seções, reorganizáveis pelo usuário em v2):

---

**Seção 1 — Hoje**

Prioridade máxima. Primeira coisa que o psicólogo vê ao abrir.

- Próxima sessão do dia: nome do paciente, horário, modalidade (presencial/online), botão primário "Abrir sessão" (se online, abre sala de vídeo via PRD 09; se presencial, abre ficha do paciente)
- Lista compacta das demais sessões do dia: horário, nome, status (agendada / confirmada / realizada / cancelada / no-show)
- Se não houver sessões hoje: "Nenhuma sessão hoje. Que tal [agendar uma]?" com link para a agenda

---

**Seção 2 — Pendências**

Somente pendências que existem no MVP:

- **Evoluções em atraso:** sessões com status `done` sem evolução registrada há mais de 7 dias → "N sessão(ões) sem evolução. [Ver]" → leva para lista filtrada de sessões na agenda
- **Pacientes sem termo de consentimento:** N pacientes sem `consent_signed_at` → "[Ver pacientes]" → leva para lista filtrada em `/app/pacientes`
- **Notas de transcrição IA prontas para revisão** (se PRD 10 ativo): "N nota(s) gerada(s) aguardando sua revisão. [Revisar]"

Se não houver nenhuma pendência: mensagem positiva discreta — "Tudo em dia." — sem ocupar espaço desnecessário.

**O que NÃO aparece** (features pós-MVP):
- Receitas Saúde pendentes (PRD 07 — não existe no MVP)
- Cobranças vencidas (PRD 06 — não existe no MVP)
- Mensagens WhatsApp (PRD 04 — não existe no MVP)

---

**Seção 3 — Resumo da semana**

Métricas calculadas a partir dos dados existentes no MVP:

- Sessões realizadas esta semana: X
- Sessões agendadas esta semana: Y (incluindo as de hoje)
- Taxa de no-show (se houver dados suficientes): Z%
- Novos pacientes adicionados no mês: N
- Evoluções registradas nesta semana: M

Todas as métricas têm estado vazio gracioso: "Ainda sem dados suficientes — agende sua primeira sessão para começar."

---

**Seção 4 — Ações rápidas**

Atalhos para as ações mais frequentes do MVP:

- "+ Novo paciente" → abre modal de criação rápida (PRD 02)
- "+ Nova sessão" → abre modal de agendamento (PRD 03)
- "Ver agenda completa" → `/app/agenda`
- "Ver pacientes" → `/app/pacientes`

---

**RF-11.07.** Dashboard responsivo. Mobile mostra Seção 1 (hoje) e Seção 2 (pendências) em destaque; Seções 3 e 4 colapsadas com chevron para expandir.

**RF-11.08.** Estado vazio do dashboard (zero pacientes, zero sessões): exibe o checklist de primeiros passos (seção 5.4) em destaque no lugar das seções normais. Ao completar o checklist, as seções normais passam a aparecer.

---

### 5.4. Checklist de primeiros passos

**RF-11.09.** Componente persistente no dashboard até atingir 100%. Aparece como card expandível no topo da página quando há itens pendentes.

Itens do checklist (alinhados ao MVP):

| Item | Ação ao clicar | Condição de conclusão |
|---|---|---|
| Cadastro completo | — | Email verificado + CRP validado |
| Configurar perfil e local de atendimento | Abre Configurações > Perfil | `locations` com pelo menos 1 registro |
| Cadastrar primeiro paciente | Abre modal de criação | Pelo menos 1 paciente com status `active` |
| Agendar primeira sessão | Abre modal de agendamento | Pelo menos 1 sessão com status != `cancelled` |
| Registrar primeira evolução | Abre prontuário da última sessão `done` | Pelo menos 1 evolução salva no prontuário |
| Enviar primeiro termo de consentimento | Abre ficha do paciente sem termo | Pelo menos 1 paciente com `consent_signed_at` |
| Experimentar transcrição com IA (opcional) | Abre tutorial de transcrição | `ai_transcription_settings.enabled = true` E pelo menos 1 transcrição iniciada |

**RF-11.10.** Itens marcados como "opcional" (transcrição IA) têm badge diferente ("Bônus") e não bloqueiam o 100%.

**RF-11.11.** Ao completar todos os obrigatórios: animação de celebração discreta + mensagem "Você completou a configuração inicial. Seu consultório está no sistema!" O checklist colapsa e fica disponível em Configurações > Ajuda > Primeiros passos.

---

### 5.5. Tour guiado

**RF-11.12.** Após concluir o wizard, na primeira abertura do dashboard, um tour overlay apresenta a interface em 5 tooltips:

- Tooltip 1 (navegação lateral): "Esta é a navegação principal. Agenda, pacientes e prontuário são os módulos centrais."
- Tooltip 2 (seção Hoje): "Aqui você vê suas sessões do dia. Clique em uma para abrir a ficha do paciente ou iniciar o vídeo."
- Tooltip 3 (seção Pendências): "Aqui aparecem as coisas que precisam da sua atenção — como sessões sem evolução."
- Tooltip 4 (atalho Novo Paciente): "Cadastre pacientes aqui. Você pode importar uma lista inteira via CSV em Configurações."
- Tooltip 5 (atalho Nova Sessão): "Agende sessões únicas ou recorrentes. Drag-and-drop na agenda também funciona."
- Botão "Pular tour" sempre visível em todos os tooltips.

**RF-11.13.** Tour pode ser reativado em Configurações > Ajuda > Refazer tour.

**RF-11.14.** Tour NÃO menciona WhatsApp, Receita Saúde, cobrança ou recibos (features pós-MVP).

---

### 5.6. Notificações in-app

**RF-11.15.** Sino de notificações no header com contador de não-lidas.

Tipos de notificação no MVP:

| Tipo | Gatilho | Ação ao clicar |
|---|---|---|
| `session_confirmed` | Paciente confirmou sessão via link | Abre detalhe da sessão na agenda |
| `session_cancelled` | Paciente cancelou sessão via link | Abre detalhe da sessão na agenda |
| `evolution_pending` | Sessão `done` há 7 dias sem evolução | Abre ficha do paciente, aba prontuário |
| `consent_signed` | Paciente assinou termo de consentimento | Abre ficha do paciente |
| `ai_note_ready` | Transcrição IA processada e pronta | Abre tela de revisão da nota (PRD 10) |
| `ai_risk_alert` | IA identificou conteúdo de risco na sessão | Abre nota com destaque vermelho |
| `system_notice` | Manutenção, novidades, avisos do produto | Modal informativo |

**O que NÃO aparece** como notificação no MVP:
- Pagamento recebido (PRD 06 — não existe)
- Receita Saúde emitida/com erro (PRD 07 — não existe)
- Mensagem WhatsApp recebida (PRD 04 — não existe)

**RF-11.16.** Painel de notificações (dropdown ao clicar no sino): lista cronológica com ícone por tipo, título e timestamp relativo ("há 5 min", "ontem"). Botão "Marcar todas como lidas".

**RF-11.17.** Notificações mais antigas que 30 dias são marcadas como lidas automaticamente e ficam no histórico.

---

### 5.7. NPS e pesquisa de satisfação

**RF-11.24.** No dia 7 após o primeiro acesso, modal aparece uma única vez:
- "Em uma escala de 0 a 10, qual a chance de você recomendar o sistema a uma colega?"
- Campo aberto opcional: "O que faria você dar nota mais alta?"
- Botão "Não responder agora" (não reaparece; pode ser respondido depois em Configurações > Feedback)

**RF-11.25.** Resposta salva em banco interno. Detratores (nota 0–6) recebem follow-up automático por email: "Sentimos muito. Posso conversar 15 min com você sobre o que poderia ser melhor?"

---

## 6. Requisitos não-funcionais

**RNF-11.01.** Dashboard carrega em <1,5s (dados do dia são priorizados; resumo semanal pode ser carregado em segundo plano).

**RNF-11.02.** Cada passo do wizard carrega em <500ms.

**RNF-11.04.** Notificações in-app em tempo real via Supabase Realtime (WebSocket).

**RNF-11.05.** Tour guiado não bloqueia interação com a interface — usuário pode clicar fora do tooltip a qualquer momento para pular aquele passo.

---

## 7. Regras de negócio

**RN-11.01.** Onboarding skip parcial é permitido. Com configuração mínima (CRP validado + 1 local de atendimento), o psicólogo já pode criar pacientes e sessões. O checklist persiste como lembrete das pendências.

**RN-11.02.** O wizard não inclui passos de WhatsApp, Receita Saúde nem cobrança. Essas configurações existirão em Configurações quando os módulos forem lançados — a onboarding não deve criar expectativa de que estão disponíveis agora.

**RN-11.03.** Importação CSV de pacientes só é habilitada após o psicólogo assinar o termo de tratamento de dados sensíveis (parte do fluxo de cadastro no PRD 01). Se por algum motivo o termo não foi assinado, o passo 3 do wizard bloqueia o upload com mensagem orientando a aceitar o termo em Configurações > Privacidade.

**RN-11.04.** Métricas do dashboard (sessões realizadas, taxa de no-show) são calculadas somente sobre dados do psicólogo logado. Nenhum dado agregado é exibido que possa ser confundido com benchmark de mercado (ilusão de norma).

**RN-11.05.** Tour guiado é exibido apenas uma vez automaticamente, para usuários com `onboarding_completed_at IS NULL`. Não roda automaticamente de novo; psicólogo pode iniciar manualmente.

**RN-11.06.** Notificações de tipo `evolution_pending` são disparadas apenas uma vez por sessão (não repete a cada 7 dias — evita spam).

---

## 8. Fluxo end-to-end: primeiro acesso até primeiro ciclo de valor

```
Cadastro + verificação email
         |
         v
Validação CRP (ativa ou em background)
         |
         v
/onboarding/welcome
  [Começar] ──────────────────────────────────────────────────────────────────────────
         |                                                                             |
         v                                                                            v
  Wizard Passo 1: Perfil                                                    [Pular tudo]
         |                                                                             |
         v                                                                             |
  Wizard Passo 2: Local e agenda                                                      |
         |                                                                             |
         v                                                                             |
  Wizard Passo 3: Importar ou cadastrar paciente                                      |
    [Skip] ─────────────────────────────────────────────────────────────────>         |
         |                                                                             |
         v                                                                             |
  Wizard Passo 4: Pronto!                                                             |
    [Ver agenda] ou [Dashboard] <────────────────────────────────────────────────────-+
         |
         v
  /app — Dashboard com Tour guiado (1ª vez)
         |
         v
  Checklist: "Agendar primeira sessão" → /app/agenda
         |
         v
  Sessão criada → lembrete aparece em dashboard
         |
         v
  Sessão marcada como `done` → botão "Registrar evolução" em destaque
         |
         v
  Evolução registrada → item do checklist marcado
         |
         v
  PRIMEIRO CICLO DE VALOR COMPLETO
  (paciente cadastrado + sessão realizada + evolução no prontuário)
```

---

## 9. Edge cases

| Caso | Tratamento |
|---|---|
| Psicólogo pula todo o onboarding | Dashboard abre mostrando checklist com 0% e estado vazio com orientações. Nenhuma feature é bloqueada. |
| CRP ainda não validado ao chegar no dashboard | Banner informativo no topo: "Sua validação de CRP está em andamento. Você já pode usar o sistema; a confirmação pode levar até 24h." |
| Psicólogo cancelou e voltou (conta reativada) | Onboarding adaptado: "Bem-vindo de volta, [Nome]!" sem repetir o wizard do início. Checklist mostra itens já feitos como concluídos. |
| Dashboard sem nenhum dado (sem pacientes, sem sessões) | Seções 3 e 4 exibem estado vazio com texto orientativo e CTA. Seção 1 exibe CTA "Agendar sua primeira sessão". |
| Notificações em excesso | Default conservador; granularidade em Configurações > Notificações. Notificações do mesmo tipo são agrupadas (ex: "3 sessões sem evolução" não são 3 notificações separadas). |
| Psicólogo usa sistema apenas para agenda, sem prontuário | Permitido. Banner gentil (não agressivo) sobre obrigação CFP de manter registro clínico: "Lembre-se: pelo CFP, todo atendimento deve ter evolução registrada. [Saiba mais]" |
| Tour ativado em tela diferente do dashboard | Tour só é iniciado a partir do dashboard. Se psicólogo navegar para outra tela antes de concluir, tour é pausado e retoma quando ele voltar ao dashboard. |

---

## 10. Critérios de aceitação

- [ ] Wizard completo (todos os 4 passos, sem pular) em menos de 8 minutos
- [ ] Cada passo do wizard pode ser pulado sem quebrar o fluxo seguinte
- [ ] Progresso do wizard é salvo; retomada funciona após fechar o navegador
- [ ] Dashboard mostra "próxima sessão do dia" em até 1,5s
- [ ] Seção Pendências não exibe pendências de features pós-MVP (WhatsApp, Receita Saúde, cobranças)
- [ ] Tour completo em menos de 2 minutos; botão "Pular" funciona em qualquer tooltip
- [ ] Tour não menciona features pós-MVP
- [ ] Importação CSV de 30 pacientes conclui em menos de 30s com preview correto
- [ ] Checklist mostra estado correto para cada item (concluído/pendente)
- [ ] Ao concluir todos os itens obrigatórios do checklist, animação de celebração aparece
- [ ] Notificação `evolution_pending` é enviada uma vez para cada sessão `done` sem evolução após 7 dias (não duplica)
- [ ] Notificação `ai_note_ready` aparece quando transcrição IA conclui (PRD 10)
- [ ] NPS modal aparece no dia 7 e exatamente uma vez
- [ ] Psicólogo que pula tudo consegue criar um paciente e agendar uma sessão sem passar pelo wizard

---

## 11. Dependências

- Lib de tour guiado: Driver.js
- Supabase Realtime (notificações in-app via WebSocket)
- Inngest (job de background para notificação de pendências)
- PRD 01 (usuário autenticado com CRP validado)
- PRD 02 (pacientes — importação, checklist)
- PRD 03 (agenda — próxima sessão, pendências)
- PRD 05 (prontuário — pendências de evolução)
- PRD 09 (telepsicologia — botão "Iniciar vídeo" no dashboard)
- PRD 10 (transcrição IA — notificação de nota pronta, item do checklist)

---

## 12. Referências regulatórias

- **LGPD** — importação de dados de pacientes exige base legal (execução de contrato — relação terapêutica)
- **Resolução CFP nº 001/2009** — obrigação de registrar evolução de cada sessão; comunicada ao psicólogo via pendências no dashboard
- **Resolução CFP nº 09/2024** — psicólogo deve manter inscrição ativa no CRP para atender; comunicada na onboarding se CRP ainda não validado

---

## Apêndice A — Modelo de dados

```sql
-- Colunas adicionadas à tabela users (PRD 01)
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_step VARCHAR(50) DEFAULT 'welcome';
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tour_completed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nps_score INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nps_feedback TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nps_responded_at TIMESTAMPTZ;

CREATE TABLE onboarding_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE NOT NULL,
  -- itens do MVP
  profile_configured BOOLEAN DEFAULT FALSE,
  location_configured BOOLEAN DEFAULT FALSE,
  first_patient_added BOOLEAN DEFAULT FALSE,
  first_session_scheduled BOOLEAN DEFAULT FALSE,
  first_evolution_recorded BOOLEAN DEFAULT FALSE,
  first_consent_sent BOOLEAN DEFAULT FALSE,
  -- item opcional (bônus)
  ai_transcription_tried BOOLEAN DEFAULT FALSE,
  -- controle
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  type VARCHAR(50) NOT NULL,
  -- tipos MVP: 'session_confirmed', 'session_cancelled', 'evolution_pending',
  --           'consent_signed', 'ai_note_ready', 'ai_risk_alert', 'system_notice'
  title VARCHAR(255) NOT NULL,
  body TEXT,
  link TEXT,
  metadata JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE NOT NULL,
  email_daily BOOLEAN DEFAULT TRUE,
  email_weekly BOOLEAN DEFAULT TRUE,
  email_critical BOOLEAN DEFAULT TRUE, -- não desativável
  in_app_sound BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_unread
  ON notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;
```
