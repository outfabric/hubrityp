# PRD 12 — Onboarding e Dashboard

> **Pré-requisitos:** PRD 00 a PRD 11 (idealmente todos concluídos antes deste).

---

## 1. Contexto e problema

O psicólogo se cadastra (PRD 01), confirma email, valida CRP — e **agora?**

Sem um onboarding bem desenhado:
- Usuário não sabe por onde começar
- Não configura WhatsApp / Receita Saúde / financeiro
- Tem expectativa errada do que o sistema faz
- **Cancela em 7 dias por não ter visto valor**

**Métrica crítica:** **Time to First Value (TTFV)**. Para SaaS B2B saúde, o ideal é o usuário ver valor real **na primeira sessão semana 1**. Se demorar mais, churn alto.

**Dashboard inicial** é a tela que o psicólogo abre todo dia — precisa ser útil, não bonita-mas-vazia.

## 2. Objetivo da feature

Levar o psicólogo do cadastro à **emissão da primeira Receita Saúde + primeiro lembrete WhatsApp + primeira sessão registrada em 24-48h**, com dashboard que mostra valor recorrente todo dia.

## 3. Escopo

### Dentro do escopo
- Wizard de configuração inicial (5-7 passos)
- Tour guiado pela interface (tooltip overlay)
- Importação básica de pacientes (CSV)
- Dashboard com métricas e ações pendentes
- Notificações in-app
- Centro de ajuda contextual
- Checklist de primeiros passos
- Pesquisa NPS após 30 dias

### Fora do escopo (versões futuras)
- Onboarding com humano (CSM) — só para tickets enterprise
- Migração automática de Psicomanager / iClinic / Doctoralia — depende de eles oferecerem export
- Templates de prontuário customizáveis pelo usuário direto na onboarding (já mencionado em PRDs 02 e 05)
- Gamificação (níveis, badges) — pós-MVP

## 4. User stories

- **Como psicóloga recém-cadastrada**, quero entender em 2 min o que esse sistema faz por mim.
- **Como psicóloga**, quero configurar Receita Saúde no primeiro dia, antes de esquecer.
- **Como psicóloga**, quero importar minha lista de 30 pacientes do Excel sem digitar um por um.
- **Como psicóloga**, quero abrir o sistema e ver o que preciso fazer hoje.
- **Como psicóloga**, quero saber se algum paciente está em débito ou sem prontuário registrado.

## 5. Requisitos funcionais

### 5.1. Pós-cadastro: tela de boas-vindas

**RF-12.01.** Após validação de email e CRP (PRD 01), psicólogo cai em `/app/welcome`:
- Saudação personalizada ("Olá, [Primeiro nome]!")
- Botão grande "Começar configuração (5 min)"
- Botão pequeno "Pular onboarding (não recomendado)"

### 5.2. Wizard de configuração

**RF-12.03.** Sequência de 5 passos com indicador de progresso:

**Passo 1 — Sobre você:**
- Foto (upload opcional)
- Nome social (opcional)
- Pronome
- Especialização (autocomplete: TCC, psicanálise, sistêmica, ABA, fenomenológica, junguiana, gestáltica, etc.)
- Cidade de atendimento principal
- Tipo de atuação: clínica / corporativa / mista

**Passo 2 — Modelo financeiro:**
- Sou Pessoa Física (PF) / Pessoa Jurídica (PJ)
- Valor padrão da sessão (R$)
- Chave PIX (CPF/email/telefone/aleatória)
- Política de cancelamento (escolher template ou customizar)

**Passo 3 — Locais de atendimento:**
- Adicionar pelo menos 1 local (consultório, online, etc.)
- Endereço (autocomplete via Google Maps API se possível)
- Modalidades aceitas

**Passo 4 — WhatsApp (opcional, mas incentivado):**
- "Quer ativar lembretes automáticos?"
- Botão "Conectar WhatsApp" → fluxo PRD 04

**Passo 5 — Receita Saúde (PF apenas):**
- "Você é PF e atende particular? Vamos configurar Receita Saúde agora."
- Botão "Conectar e-CAC" → fluxo PRD 07
- Skip: "Configurar depois"

**Passo 6 — Importar pacientes (opcional):**
- Upload CSV
- Mapear colunas
- Confirmar importação
- Skip: "Adicionar pacientes manualmente depois"

**Passo 7 — Pronto!**
- Resumo: o que está configurado, o que falta
- "Vamos começar!" → redireciona para dashboard

**RF-12.04.** Cada passo é skipável (psicólogo retoma depois). Sistema rastreia progresso.

**RF-12.05.** Wizard salva progresso a cada passo. Se psicólogo sair, retoma de onde parou.

### 5.3. Dashboard inicial (`/app`)

**RF-12.06.** Layout em 4 seções:

**Seção 1 — Hoje:**
- Próxima sessão: paciente, hora, modalidade, [Iniciar]
- Sessões do dia inteiro: tabela compacta
- Sessões pendentes de evolução (>7 dias): badge alerta

**Seção 2 — Pendências críticas:**
- Receitas Saúde para emitir (N) → link
- Cobranças vencidas (N, R$ X) → link
- Pacientes sem termo de consentimento (N) → link
- Mensagens WhatsApp não lidas (N) → link inbox

**Seção 3 — Resumo do mês:**
- Sessões realizadas: X de Y planejadas
- Receita prevista vs realizada (gráfico)
- Taxa de no-show
- Novos pacientes no mês

**Seção 4 — Ações rápidas:**
- + Novo paciente
- + Nova sessão
- + Nova cobrança avulsa
- Ver relatório financeiro
- Ver agenda completa

**RF-12.07.** Dashboard responsivo: mobile mostra Seção 1 e 2 em destaque; outras colapsadas.

### 5.4. Tour guiado

**RF-12.08.** Após primeiro login pós-onboarding, tour overlay:
- Tooltip 1: "Esta é sua agenda. Clique em um horário para criar sessão."
- Tooltip 2: "Aqui ficam seus pacientes. Adicione importando ou um por um."
- Tooltip 3: "Esta é a aba de prontuário. Cada paciente tem o seu."
- Tooltip 4: "Esta é a Receita Saúde — emita em 1 clique."
- Tooltip 5: "Configure tudo aqui. Comece pelo WhatsApp."
- Botão "Pular tour" sempre visível

**RF-12.09.** Tour pode ser reativado em Configurações > Ajuda > Refazer tour.

### 5.5. Notificações in-app

**RF-12.10.** Sino de notificações no header com contador. Tipos:
- Paciente confirmou sessão
- Paciente cancelou sessão
- Pagamento recebido
- Mensagem WhatsApp recebida
- Receita Saúde emitida com sucesso / com erro
- Lembrete: registrar evolução de sessão de [data]
- Lembrete: emitir Receita Saúde — prazo se aproxima
- Notificações do sistema (manutenção, novidades)

**RF-12.11.** Notificações por email (configurável):
- Resumo diário (8h da manhã): agenda do dia + pendências
- Resumo semanal (segunda 9h): KPIs da semana anterior
- Avisos críticos (sempre): erros de pagamento, falhas técnicas

### 5.6. Centro de ajuda contextual

**RF-12.13.** Botão "?" flutuante no canto inferior direito:
- Abre painel com:
  - Busca de artigos da base de conhecimento
  - Top artigos do contexto atual (ex: na tela de Receita Saúde, sugerir "Como configurar e-CAC")
  - "Falar com suporte" (chat ou WhatsApp)
  - Link para vídeos tutoriais

**RF-12.14.** FAQ embutido nas telas críticas (ex: "Por que preciso configurar Receita Saúde?").

### 5.8. Checklist de primeiros passos

**RF-12.18.** Componente persistente no dashboard até completar 100%:
- ✅ Cadastro completo
- ⬜ Configurar WhatsApp
- ⬜ Configurar Receita Saúde (se PF)
- ⬜ Cadastrar primeiro paciente
- ⬜ Agendar primeira sessão
- ⬜ Registrar primeira evolução
- ⬜ Emitir primeira cobrança
- ⬜ Convidar 1 colega (referral — opcional, pós-MVP)

**RF-12.19.** Cada item é clicável (leva à ação correspondente). Animação ao completar.

**RF-12.20.** Após 100%, item permanece como "Conquistas" e desbloqueia mensagem "Você é avançado!".

### 5.9. NPS e pesquisa de satisfação

**RF-12.21.** No dia 30, modal aparece uma vez:
- "Em uma escala de 0-10, qual a chance de você recomendar o sistema a um colega?"
- Pergunta aberta opcional: "Por quê?"
- Opção "Não responder agora"

**RF-12.22.** Resposta enviada para sistema de NPS (banco próprio).

**RF-12.23.** Detratores (0-6) recebem follow-up: "Sentimos muito. Posso agendar 15 min com você?"

### 5.10. Configuração de notificações

**RF-12.24.** Em Configurações > Notificações, psicólogo escolhe:
- Email diário (sim/não)
- Email semanal (sim/não)
- Email crítico (sempre, não desativável — segurança)

## 6. Requisitos não-funcionais

**RNF-12.01.** Dashboard carrega em <1,5s.

**RNF-12.02.** Wizard cada passo carrega em <500ms.

**RNF-12.04.** Notificações in-app em tempo real (WebSocket via Supabase Realtime).

## 7. Regras de negócio

**RN-12.01.** Onboarding skip parcial é permitido — psicólogo pode usar com configuração mínima (CRP + 1 paciente). Mas dashboard sempre lembra das pendências.

**RN-12.02.** Banner persistente "Configure Receita Saúde" para psicólogo PF que não configurou (importante!).

**RN-12.03.** Importação CSV de pacientes só após assinar termo geral de tratamento de dados sensíveis.

**RN-12.05.** Tour guiado mostra apenas para usuário sem `onboarding_completed`. Não rerodar automaticamente.

**RN-12.06.** Métricas de engajamento (sessões criadas, prontuários registrados) são dados internos do produto — apareceriam em painel admin, NÃO compartilhar agregação que identifique psicólogo individual.

## 8. Edge cases

| Caso | Tratamento |
|---|---|
| Psicólogo pula tudo no onboarding | Dashboard mostra setup checklist com 0% e badges em todas pendências |
| Psicólogo CRP demorou para validar | Onboarding pode rodar em paralelo (sem habilitar emissão de Receita Saúde até ter CRP) |
| Importação CSV com 1000 pacientes | Processar em background; notificar quando concluir |
| Psicólogo quer usar só agenda, sem prontuário | Permitido; banner gentil sobre obrigação CFP de manter registro |
| Psicólogo cancelou e voltou | Onboarding adaptado: "Bem-vindo de volta!" sem refazer tudo |
| Mobile usuário sem teclado prático | Wizard com inputs grandes, dropdowns ao invés de digitação |
| Notificações em excesso desligam o usuário | Default conservador; granular nos ajustes |
| Psicólogo importa CSV com formato estranho (ponto e vírgula, encoding ANSI) | Detecção automática de delimitador e encoding; preview antes de processar |

## 9. Critérios de aceitação

- [ ] Wizard completo em <8 minutos para psicólogo organizado
- [ ] Cada passo do wizard pode ser pulado sem quebrar o fluxo
- [ ] Dashboard mostra "próxima sessão" em até 1s
- [ ] Pendências críticas (Receita Saúde, cobranças vencidas) aparecem no topo
- [ ] Tour guiado completa em <2 minutos
- [ ] Importação de CSV de 30 pacientes em <30s
- [ ] Email opt-out funciona (LGPD)
- [ ] NPS modal aparece no dia 30 e só uma vez
- [ ] Notificações in-app em tempo real (WebSocket)
- [ ] Resumo de email diário tem agenda + pendências
- [ ] Centro de ajuda contextual mostra artigos relevantes à tela atual
- [ ] Mobile: dashboard prioriza ações urgentes
- [ ] Banner de Receita Saúde para PF não configurado é persistente
- [ ] Sem Receita Saúde configurada não tenta emitir; oferece configurar

## 10. Dependências

- Provedor de email transacional: `Resend`
- Lib de tour: Shepherd.js, Driver.js, Intro.js
- Realtime: Supabase Realtime
- Todos os PRDs anteriores funcionando

## 11. Referências regulatórias

- **LGPD** — opt-in/opt-out de comunicação
- Resoluções CFP — psicólogo deve estar inscrito ativo (educação na onboarding)

## Apêndice A — Modelo de dados

```sql
ALTER TABLE users ADD COLUMN onboarding_step VARCHAR(50) DEFAULT 'welcome';
ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN tour_completed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN nps_score INT;
ALTER TABLE users ADD COLUMN nps_feedback TEXT;
ALTER TABLE users ADD COLUMN nps_responded_at TIMESTAMPTZ;

CREATE TABLE onboarding_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE,
  whatsapp_configured BOOLEAN DEFAULT FALSE,
  receita_saude_configured BOOLEAN DEFAULT FALSE,
  first_patient_added BOOLEAN DEFAULT FALSE,
  first_session_scheduled BOOLEAN DEFAULT FALSE,
  first_evolution_recorded BOOLEAN DEFAULT FALSE,
  first_charge_issued BOOLEAN DEFAULT FALSE,
  colleague_referred BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  type VARCHAR(50), -- 'session_confirmed', 'payment_received', 'evolution_pending', etc.
  title VARCHAR(255),
  body TEXT,
  link TEXT,
  metadata JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE,
  email_daily BOOLEAN DEFAULT TRUE,
  email_weekly BOOLEAN DEFAULT TRUE,
  email_critical BOOLEAN DEFAULT TRUE, -- não desativável
  push_mobile BOOLEAN DEFAULT TRUE,
  in_app_sound BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;
```