# PRD 04 — Lembretes Automáticos via WhatsApp

> **Pré-requisitos:** PRD 00, PRD 01, PRD 02, PRD 03.

---

## 1. Contexto e problema

Lembrar o paciente da sessão de amanhã ou de hoje é a tarefa administrativa que o psicólogo mais detesta. Em uma agenda de 30 pacientes/semana, ele gasta facilmente **30–45 minutos por dia** mandando mensagens manuais no WhatsApp do tipo "Oi, lembrando da sessão amanhã às 14h, posso confirmar?".

**Sem lembrete adequado:**
- Taxa de no-show fica alta (~15-20%)
- Cada no-show é R$ 150–300 perdidos
- Estresse e desgaste do psicólogo

**Por que WhatsApp e não SMS/email:**
- WhatsApp é o canal de comunicação massivo do brasileiro (>99% dos pacientes têm)
- Taxa de leitura ~98% vs ~20% de email
- Permite resposta rápida (confirmação)

**Atenção crítica:** WhatsApp tem regras estritas sobre comunicação automatizada. Usar API NÃO oficial pode resultar em banimento. **Sempre usar API oficial via Business Solution Provider (BSP)**.

## 2. Objetivo da feature

Automatizar o envio de lembretes de sessão por WhatsApp ao paciente, com templates configuráveis, respeitando regras do WhatsApp Business API e da LGPD, permitindo confirmação em um clique.

## 3. Escopo

### Dentro do escopo
- Envio automático de lembretes em momentos configuráveis (ex: 24h antes, 2h antes)
- Templates de mensagem editáveis pelo psicólogo
- Variáveis dinâmicas no template ({nome_paciente}, {hora}, {endereco}, {link_confirmacao})
- Botões interativos no WhatsApp (Confirmar / Não posso comparecer)
- Log de envio (entregue / lido / respondido)
- Resposta livre do paciente vai para inbox unificado dentro do sistema
- Notificação ao psicólogo quando paciente responde
- Avisos automáticos: cancelamento, remarcação, link de vídeo (se online)
- Pausar lembretes para paciente específico (se ele preferir não receber)
- Aviso de termo de consentimento WhatsApp

### Fora do escopo (versões futuras)
- Marketing/campanhas via WhatsApp (regras MUITO mais estritas)
- Chatbot com IA respondendo paciente — risco ético e regulatório, NÃO fazer
- Integração com SMS como fallback (a menos que demanda real apareça)
- WhatsApp para grupo terapêutico

## 4. User stories

- **Como psicóloga**, quero que o sistema mande lembrete 24h antes da sessão sem eu ter que fazer nada.
- **Como psicóloga**, quero personalizar o tom da mensagem para ficar com a minha voz.
- **Como psicóloga**, quero saber se o paciente leu e confirmou a sessão.
- **Como psicóloga**, quero pausar lembretes para a Marina porque ela me pediu (não gosta).
- **Como paciente**, quero confirmar a sessão em um clique sem precisar abrir um link estranho.
- **Como paciente**, quero o endereço do consultório no lembrete para usar no Maps.

## 5. Requisitos funcionais

### 5.1. Configuração de provedor WhatsApp

**RF-04.01.** Em Configurações > Integrações > WhatsApp, exibir status:
- Não conectado (default)
- Conectado (mostrar número, plano)
- Erro (com instrução de re-autenticar)

**RF-04.02.** Conexão via OAuth/QR Code do BSP `Twilio`.

**RF-04.03.** Após conectar, sistema valida número e exibe sucesso. Salva `whatsapp_account_id` no banco.

**RF-04.04.** Custo do envio é repassado pela cobrança do provedor (geralmente R$ 0,05–0,15 por mensagem template). Sistema deve mostrar consumo do mês ao psicólogo (transparência).

### 5.2. Templates de mensagem

**RF-04.05.** Sistema vem com templates pré-aprovados (exigência do WhatsApp). Templates são submetidos para aprovação da Meta uma vez; uso posterior é livre dentro do conteúdo.

**RF-04.06.** Templates iniciais a criar (exemplos — texto exato a ser aprovado pela Meta):

**Template "lembrete_24h":**
```
Olá, {{1}}! 👋

Lembrando da nossa sessão amanhã, {{2}}, às {{3}}.

📍 Local: {{4}}

Posso confirmar sua presença?
```
Botões: [✅ Confirmar] [❌ Não posso comparecer]

**Template "lembrete_2h":**
```
{{1}}, lembrando que nossa sessão é hoje às {{2}}.

{{3}}

Até já!
```

**Template "confirmacao_recebida":**
```
Obrigada por confirmar, {{1}}! Nos vemos {{2}} às {{3}}. 💜
```

**Template "cancelamento_aviso":**
```
{{1}}, infelizmente preciso cancelar nossa sessão de {{2}} às {{3}}.

{{4}}

Em breve te chamo para reagendar.
```

**Template "link_video":**
```
Olá, {{1}}!

Sua sessão online de hoje começa às {{2}}.

🎥 Link da sala: {{3}}

A sala fica disponível 10 minutos antes.
```

**Template "termo_consentimento":**
```
Olá, {{1}}!

Antes da nossa primeira sessão, preciso que você leia e assine o termo de consentimento:

📄 {{2}}

É rápido, leva uns 3 minutos. Qualquer dúvida, me avise!
```

**RF-04.07.** Psicólogo pode personalizar texto SUBSTITUINDO o template (não criando do zero). Cada texto editado precisa ser re-aprovado pela Meta antes de poder ser usado — sistema mostra status (Aprovado / Em análise / Rejeitado).

**RF-04.08.** Variáveis disponíveis:
- `{nome_paciente}` (primeiro nome)
- `{nome_completo}`
- `{nome_psicologo}`
- `{data}` ("amanhã", "hoje", ou "DD/MM")
- `{dia_semana}`
- `{hora}` (HH:MM)
- `{duracao_min}`
- `{endereco}` (do local de atendimento)
- `{instrucao_chegada}` (campo do local)
- `{link_confirmacao}` (gerado para a sessão)
- `{link_video}` (se modalidade online)
- `{valor}` (se psicólogo quiser lembrar)

### 5.3. Configuração de quando enviar

**RF-04.09.** Em Configurações > Lembretes WhatsApp, psicólogo escolhe:
- Lembrete antecipado: Não / 24h antes / 12h antes / 48h antes
- Lembrete final: Não / 2h antes / 1h antes / 30 min antes
- Aviso de link de vídeo (online): 30 min antes
- Confirmação de termo: imediato ao criar paciente, configurável

**RF-04.10.** Override por paciente: na ficha do paciente, opção "Não enviar lembretes WhatsApp" (com reason field).

**RF-04.11.** Override por sessão: ao criar/editar sessão, checkbox "Não enviar lembretes para esta sessão" (útil para paciente que avisou que não pode receber).

### 5.4. Mecanismo de envio

**RF-04.12.** Job worker no Inngest que roda a cada 5 minutos:
- Busca sessões com `status = 'scheduled'` cujo lembrete ainda não foi enviado e cuja janela de envio está dentro do alvo
- Renderiza template com variáveis preenchidas
- Envia via API do BSP
- Registra resultado em `whatsapp_messages`

**RF-04.13.** Em caso de falha do BSP:
- Retentar 3x com backoff exponencial (1 min, 5 min, 15 min)
- Após 3 falhas, marcar como `failed` e notificar psicólogo via in-app

**RF-04.14.** Em caso de paciente sem WhatsApp ou número inválido, marcar como `unable_to_send` e avisar psicólogo (não tente novamente).

### 5.5. Confirmação de presença

**RF-04.15.** Quando paciente clica botão "Confirmar":
- Webhook recebe evento do BSP
- Sistema atualiza `sessions.status = 'confirmed'` e `confirmed_at`
- Envia template `confirmacao_recebida` automaticamente
- Notifica psicólogo (in-app)

**RF-04.16.** Quando paciente clica "Não posso comparecer":
- Sistema cancela sessão (status `cancelled`, `cancelled_by = 'patient'`)
- Aplica regra de antecedência (PRD 03 RF-03.15) para cobrança
- Notifica psicólogo imediatamente (in-app)
- Pergunta a ele se quer remarcar (link de ação rápida)

### 5.6. Inbox de respostas livres

**RF-04.17.** Se paciente responde com texto livre (não os botões), mensagem aparece em `/app/inbox`:
- Lista cronológica
- Foto/iniciais do paciente
- Trecho da mensagem
- Status (não lida / lida / respondida)
- Click abre conversa

**RF-04.18.** Tela de conversa permite:
- Ler histórico das últimas 30 mensagens
- Responder (envio manual, fora de template — só funciona dentro da janela de 24h da última mensagem do paciente, pelo WhatsApp Business API)
- Marcar como resolvida

**RF-04.19.** **IMPORTANTE:** O sistema NÃO usa IA para responder paciente automaticamente. Psicólogo lê e responde pessoalmente. Mensagens com palavras-chave de risco (suicídio, autolesão) destacam alerta vermelho e instruem psicólogo a contatar paciente imediatamente.

### 5.7. Termo de consentimento WhatsApp

**RF-04.20.** Paciente, ao receber primeiro lembrete via WhatsApp, recebe nota de rodapé na primeira mensagem: "Você está recebendo essa mensagem de [Psicólogo CRP X] via WhatsApp. Esses dados são tratados conforme nossa Política de Privacidade [link]. Para parar de receber, responda PARAR."

**RF-04.21.** Se paciente responde "PARAR" (case-insensitive), sistema:
- Marca paciente como `whatsapp_opt_out = true`
- Cessa imediatamente todos os lembretes
- Notifica psicólogo
- Envia confirmação: "Não enviaremos mais lembretes. Para retomar, fale com seu psicólogo."

### 5.8. Logs e analytics

**RF-04.22.** Em Configurações > Lembretes > Histórico:
- Total de mensagens enviadas no mês
- Taxa de entrega
- Taxa de leitura
- Taxa de confirmação
- Custo estimado

**RF-04.23.** Permitir busca por paciente para ver histórico de mensagens enviadas/recebidas.

## 6. Requisitos não-funcionais

**RNF-04.01.** Latência do envio: lembrete deve sair dentro da janela de 5 min do horário-alvo.

**RNF-04.02.** Reliability: idempotência — não enviar lembrete duplicado mesmo em caso de retry do worker.

**RNF-04.03.** Webhook de retorno do BSP deve responder em <2s para evitar retry do BSP. Processamento pesado em fila assíncrona (Inngest).

**RNF-04.04.** Escalabilidade: suportar 50.000 mensagens/dia sem degradação (futuro).

**RNF-04.05.** Conformidade WhatsApp Business Policy: nunca enviar mensagem promocional ou marketing automatizado. Apenas lembretes operacionais com consentimento implícito da relação terapêutica.

## 7. Regras de negócio

**RN-04.01.** Lembretes só são enviados para sessões `scheduled`. Sessões `cancelled`, `done` ou `confirmed` não recebem lembrete adicional.

**RN-04.02.** Lembrete de "X horas antes" considera horário do psicólogo (fuso da conta).

**RN-04.03.** Se sessão for criada com menos de [janela do lembrete] de antecedência, sistema NÃO envia o lembrete antecipado (mas envia o lembrete final se aplicável).

**RN-04.04.** Paciente sem WhatsApp marcado, ou com número inválido, ou opt-out: nenhum lembrete é enviado. Psicólogo é avisado.

**RN-04.05.** Mensagens enviadas fora da janela de 24h após última mensagem do paciente devem usar template aprovado obrigatoriamente (regra Meta).

**RN-04.06.** Custo por mensagem é repassado da BSP. Plano gratuito do SaaS pode incluir N mensagens; acima disso, cobrar add-on (definir na fase comercial).

**RN-04.07.** **Conteúdo proibido:** o sistema NÃO permite enviar conteúdo clínico via WhatsApp (resultado de teste, evolução, conteúdo de sessão). Apenas dados administrativos. Psicólogo deve ser educado sobre isso na onboarding.

## 8. Edge cases

| Caso | Tratamento |
|---|---|
| Paciente trocou de número | Editar telefone na ficha do paciente; lembretes futuros vão para o novo |
| Paciente bloqueou número do psicólogo | Sistema detecta erro do BSP "blocked" e marca paciente com flag; avisar psicólogo |
| Sessão criada para amanhã às 8h, lembrete de 24h cairia agora (madrugada) | Enviar imediatamente OU aguardar próximo horário comercial (configurável; default: imediato durante 7-22h, aguardar caso contrário) |
| Webhook do BSP falha temporariamente | Sistema reconcilia status via polling de 30 min |
| Paciente responde a botão depois de 24h | Sistema tenta atualizar sessão; se já foi marcada manualmente como `done` ou `no_show`, ignora |
| Paciente confirmou mas não veio | Marcar como `no_show` manualmente; sistema deve permitir distinção |
| Mensagem com erro de digitação no template | Editar template; nova versão precisa re-aprovação Meta antes de usar |
| Paciente menor de idade — lembrete vai para responsável | Configuração na ficha: para qual número enviar (paciente ou responsável) |
| Sessão de casal — lembrete vai para qual? | Por padrão, ambos. Configurável por sessão |
| Cliente fora da janela de 24h e psicólogo quer enviar mensagem livre | Sistema bloqueia e instrui usar template, ou esperar paciente iniciar contato |
| Apagão geral do WhatsApp (já aconteceu) | Sistema mostra banner de erro; permite envio manual via SMS futuramente (pós-MVP) |

## 9. Critérios de aceitação

- [ ] Conectar WhatsApp via BSP funciona em <5 min de setup
- [ ] Template "lembrete_24h" é enviado automaticamente 24h antes da sessão
- [ ] Variáveis no template são substituídas corretamente (nome, hora, endereço)
- [ ] Botão "Confirmar" no WhatsApp atualiza status da sessão para `confirmed`
- [ ] Botão "Não posso comparecer" cancela sessão e notifica psicólogo
- [ ] Paciente que respondeu "PARAR" não recebe mais lembretes
- [ ] Resposta livre do paciente aparece no inbox unificado
- [ ] Mensagens com palavras-chave de risco mostram alerta vermelho
- [ ] Pausar lembretes para 1 paciente respeita; outros pacientes seguem normais
- [ ] Falha do BSP é re-tentada 3x com backoff
- [ ] Lembrete duplicado nunca é enviado (testar com retry forçado)
- [ ] Histórico de mensagens é pesquisável
- [ ] Custo do mês é exibido com transparência
- [ ] Configurações persistem após relogar
- [ ] Lembrete de sessão online inclui link do vídeo (PRD 09)
- [ ] Sistema NÃO permite envio de conteúdo clínico (evolução, etc.) — bloqueio de UI

## 10. Dependências

- Twilio
- Inngest (filas de mensagens, cronjobs)
- Webhooks configurados em URL pública (use Vercel)
- PRD 03 (agenda) — origem dos eventos de lembrete
- PRD 11 (LGPD) — consentimento, opt-out, retenção de logs

## 11. Referências regulatórias

- **WhatsApp Business Policy** (https://www.whatsapp.com/legal/business-policy/)
- **WhatsApp Commerce Policy** — proíbe certos tipos de conteúdo
- LGPD art. 7º (base legal: execução de contrato + interesse legítimo)
- LGPD art. 18 (direito de oposição — implementado via "PARAR")
- Marco Civil da Internet — preservação de logs

## Apêndice A — Modelo de dados

```sql
CREATE TABLE whatsapp_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE NOT NULL,
  provider VARCHAR(50) NOT NULL, -- 'z_api', 'cloud_api', 'twilio'
  account_id VARCHAR(255) NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  display_name VARCHAR(120),
  status VARCHAR(20) DEFAULT 'active',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_health_check_at TIMESTAMPTZ
);

CREATE TABLE message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  template_key VARCHAR(50) NOT NULL, -- 'lembrete_24h', 'cancelamento_aviso'
  body TEXT NOT NULL,
  variables JSONB,
  meta_template_id VARCHAR(255),
  meta_status VARCHAR(20), -- 'approved', 'pending', 'rejected'
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, template_key)
);

CREATE TABLE whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  patient_id UUID REFERENCES patients(id),
  session_id UUID REFERENCES sessions(id),
  direction VARCHAR(10) NOT NULL, -- 'outbound', 'inbound'
  to_phone VARCHAR(20),
  from_phone VARCHAR(20),
  body TEXT,
  template_key VARCHAR(50),
  bsp_message_id VARCHAR(255),
  status VARCHAR(20), -- 'queued', 'sent', 'delivered', 'read', 'failed', 'unable_to_send'
  error_reason TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reminder_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE,
  early_reminder_hours INT, -- NULL = não enviar
  final_reminder_hours INT,
  video_link_minutes INT DEFAULT 30,
  send_during_night BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE patients ADD COLUMN whatsapp_opt_out BOOLEAN DEFAULT FALSE;
ALTER TABLE patients ADD COLUMN whatsapp_opt_out_at TIMESTAMPTZ;
ALTER TABLE patients ADD COLUMN reminder_phone VARCHAR(20); -- override do telefone padrão (útil para menor)

CREATE INDEX idx_wa_messages_user_created ON whatsapp_messages(user_id, created_at DESC);
CREATE INDEX idx_wa_messages_session ON whatsapp_messages(session_id);
CREATE INDEX idx_wa_messages_patient ON whatsapp_messages(patient_id, created_at DESC);
```