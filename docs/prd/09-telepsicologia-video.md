# PRD 09 — Telepsicologia (Videochamada)

> **Pré-requisitos:** PRD 00, PRD 01, PRD 02, PRD 03, PRD 04.

---

## 1. Contexto e problema

A pandemia (2020) forçou a profissão de psicologia a abraçar atendimento online. Hoje, **40-60% das sessões de psicólogos autônomos são online ou híbridas**. A Resolução CFP nº 09/2024 consolidou o atendimento por meios digitais como prática regular (extinguiu o cadastro e-Psi obrigatório).

Hoje, o psicólogo usa Google Meet, Zoom, WhatsApp Vídeo ou ligação simples. **Problemas:**
- Link expirado, paciente não entra
- Aplicativo desconfigurado (mic mudo, câmera invertida)
- Risco de privacidade (Zoom-bombing já aconteceu)
- Sem integração com a agenda
- Paciente entra antes do horário e o psicólogo está atendendo outro

**Atenção regulatória:**
- Atendimento somente em território nacional (Res. CFP 09/2024)
- Gravação só com consentimento explícito (Res. CFP 13/2022)
- Dados sensíveis de saúde (LGPD)

## 2. Objetivo da feature

Oferecer videochamada integrada ao sistema, com sala única por sessão, criada automaticamente, com criptografia, controle de acesso, sem necessidade de instalar app.

## 3. Escopo

### Dentro do escopo
- Geração automática de sala de vídeo por sessão online
- Sala disponível 10 min antes do horário, encerra 30 min depois
- Acesso do paciente via link único (sem login)
- Acesso do psicólogo via sistema autenticado
- Áudio/vídeo de qualidade (HD se conexão permitir)
- Compartilhamento de tela (psicólogo)
- Chat textual durante a sessão
- Sala virtual de espera (paciente entra antes, fica em espera até psicólogo admitir)
- Detecção de fim de sessão (auto-encerramento após 5 min sem ninguém)
- Áudio gravado para transcrição (PRD 10) — efêmero, não persistido por padrão
- Termo de consentimento específico para vídeo (incluído no termo geral — PRD 02)

### Fora do escopo (versões futuras)
- Vídeo grupo (>2 pessoas) — para casal pode entrar 2; para grupo terapêutico v2
- Whiteboard / quadro branco
- Aplicação de testes psicológicos durante o vídeo
- Integração com áudio Bluetooth de fone
- Versão mobile dedicada com app nativo (depende de roadmap)
- Sessão internacional (psicólogo brasileiro, paciente fora do Brasil) — bloqueado por res. CFP

## 4. User stories

- **Como psicóloga**, quero abrir a sala de vídeo direto da agenda em 1 clique.
- **Como psicóloga**, quero saber se o paciente já está aguardando.
- **Como psicóloga**, quero compartilhar tela para mostrar um material visual.
- **Como paciente**, quero entrar na videochamada sem instalar nada.
- **Como paciente**, quero saber se vou esperar (sala de espera) ou já posso entrar.

## 5. Requisitos funcionais

### 5.1. Provedor de vídeo

**RF-09.01.** Sistema integra com provedor de videochamada via API. Opção recomendada: Stream.io (`https://getstream.io/`) — bom plano free, fácil integração

**RF-09.02.** Configuração no backend com API key segura (vault). Não expor ao frontend.

### 5.2. Sala de vídeo por sessão

**RF-09.03.** Quando sessão é criada/atualizada com modalidade `online` (PRD 03), sistema gera sala virtual via API do provedor:
- Identificador único (UUID)
- Nome da sala: hash não previsível (`ses_a8f7b2c1...`)
- Configurações: max 2 participantes (3 se for casal), gravação OFF por padrão, sala expira 1h após horário previsto

**RF-09.04.** Cada sessão tem 2 URLs:
- URL do psicólogo (autenticada) — `app/sessao/:id/video`
- URL do paciente (token único, sem login) — `https://link.[dominio].com.br/v/:token`

**RF-09.05.** Quando lembrete WhatsApp é enviado (PRD 04, template `link_video`), URL do paciente é incluída.

### 5.3. Sala de espera virtual

**RF-09.06.** Paciente clica no link → entra em sala de espera com:
- Nome do psicólogo
- Mensagem: "Aguarde, [Psicólogo] vai admitir você em breve"

**RF-09.07.** Sala fica disponível **10 minutos antes** do horário. Antes disso, paciente vê: "Sua sessão é às [hora]. Volte 10 minutos antes."

**RF-09.08.** Psicólogo, ao entrar na sessão, vê notificação "Paciente aguardando" e botão "Admitir".

### 5.4. Tela do psicólogo

**RF-09.09.** Acesso via aba "Sessão de hoje" no dashboard, ou clicando "Iniciar vídeo" na agenda.

**RF-09.10.** Layout durante sessão:
- Vídeo do paciente (grande)
- Vídeo do psicólogo (pequeno, canto)
- Controles: mic on/off, câmera on/off, compartilhar tela, chat, encerrar
- Indicador de tempo decorrido
- Acesso lateral (drawer): prontuário do paciente para anotações em tempo real

**RF-09.11.** Botão "Encerrar sessão" pede confirmação; ao confirmar:
- Sala vira read-only (paciente é desconectado com aviso)
- Sessão é marcada como `done`
- Modal "Registrar evolução agora?" com link rápido para PRD 05

### 5.5. Tela do paciente

**RF-09.12.** Interface limpa, sem branding excessivo:
- Foto/iniciais do psicólogo
- Nome do psicólogo
- Vídeo grande do psicólogo
- Vídeo pequeno próprio (canto)
- Controles básicos: mic, câmera, sair

**RF-09.13.** Mensagem clara se conexão estiver ruim: "Sua conexão está instável. Verifique sua internet."

**RF-09.14.** Não permitir paciente compartilhar tela (apenas psicólogo).

### 5.6. Recursos durante a sessão

**RF-09.15.** **Compartilhamento de tela**: psicólogo pode compartilhar uma janela ou tela inteira com paciente.

**RF-09.16.** **Chat textual**: mensagens curtas durante a sessão (útil se um dos dois perde áudio temporariamente). Chat NÃO é persistido após sessão.

**RF-09.17.** **Indicador de qualidade**: barra superior mostra qualidade da conexão (verde/amarelo/vermelho). Em vermelho, sugere reduzir qualidade do vídeo.

**RF-09.18.** **Modo só-áudio**: paciente ou psicólogo podem desligar a câmera e continuar só com áudio (paciente em transporte público, por exemplo).

**RF-09.19.** **Pedir ajuda**: botão "Problema técnico?" abre tutorial de troubleshooting (verificar mic, sair e voltar, mudar de navegador).

### 5.7. Gravação (opcional, com consentimento)

**RF-09.20.** Gravação NÃO é o default. Para ativar:
- Paciente deve ter assinado termo de consentimento de gravação (separado do termo geral — Res. CFP 13/2022)
- Psicólogo aciona "Gravar sessão" antes de iniciar
- Paciente recebe banner visível "Esta sessão está sendo gravada"

**RF-09.21.** Gravação produz arquivo de áudio efêmero (não persistido em storage permanente), passa por PRD 10 (transcrição), gera nota, e o áudio original é descartado em até 24h após processamento.

**RF-09.22.** Se PRD 10 ainda não estiver implementado: gravação fica desabilitada com mensagem "Em breve".

### 5.8. Encerramento e segurança

**RF-09.23.** Sessão encerra automaticamente após:
- Psicólogo clica "Encerrar"
- 1h após horário previsto (sala expira)
- 5 min sem nenhum participante conectado

**RF-09.24.** Após encerramento, link do paciente fica inválido. Tentativa de acessar mostra "Esta sessão já foi encerrada. Fale com [Psicólogo] se precisar reagendar."

**RF-09.25.** Tokens são únicos por sessão; expirar imediatamente após sessão `done`.

### 5.10. Histórico

**RF-09.28.** Sessões `done` em modalidade online registram:
- Hora real de início
- Hora real de fim
- Duração efetiva
- Houve gravação? (boolean)
- Houve compartilhamento de tela? (boolean)

**RF-09.29.** Estatísticas em Dashboard: % sessões online no mês.

## 6. Requisitos não-funcionais

**RNF-09.01.** Latência de áudio: <200ms (provedor responsável).

**RNF-09.02.** Qualidade vídeo padrão: 720p; degrada graciosamente conforme conexão.

**RNF-09.03.** Disponibilidade: 99,9% (depende do provedor — escolher provedor com SLA documentado).

**RNF-09.04.** Criptografia: ponta-a-ponta (E2E) sempre que provedor suportar.

**RNF-09.06.** Compatibilidade de navegadores: Chrome 90+, Edge 90+, Firefox 88+, Safari 14+. Sem app.

**RNF-09.07.** Mobile: funcional em Chrome Android e Safari iOS. Permitir acesso à câmera/mic com permissão.

**RNF-09.08.** Não persistir áudio/vídeo da sessão por padrão; gravações descartadas em 24h após uso.

**RNF-09.09.** Logs de sessão (metadata: quem entrou, quando, duração) preservados; conteúdo NÃO.

## 7. Regras de negócio

**RN-09.01.** Sala só funciona para sessão `scheduled` ou `confirmed`. Sessão `cancelled` ou `done` não tem sala ativa.

**RN-09.02.** Sala disponível 10 min antes; expira 1h após horário ou 5 min após esvaziar.

**RN-09.03.** Apenas o paciente da sessão pode entrar via link. Token é único e não compartilhável (URL inclui hash da sessão).

**RN-09.04.** Casal: 2 pacientes do casal podem entrar na mesma sessão usando 2 tokens diferentes (gerados por paciente).

**RN-09.05.** Gravação só com termo assinado. Sem termo, opção fica desabilitada com tooltip.

**RN-09.06.** Sessão fora do território nacional é VEDADA pela Res. CFP 09/2024. Sistema NÃO bloqueia geolocalização (impossível em todos os casos), mas avisa o psicólogo durante onboarding sobre essa regra.

**RN-09.07.** Em caso de queda, sistema permite reentrar na mesma sala (token continua válido até fim da sessão).

**RN-09.08.** Conteúdo da sessão (áudio, vídeo, chat) é dado pessoal sensível — proteger conforme LGPD.

## 8. Edge cases

| Caso | Tratamento |
|---|---|
| Paciente entra antes dos 10 min | Mensagem "Sua sessão começa em X minutos. Volte mais tarde." Mostra tela de teste técnico |
| Psicólogo não entra (esqueceu) | Sala fica disponível 1h; paciente espera com aviso "Tente contatar [psicólogo]" |
| Paciente entra com mic e câmera sem permissão | Tela bloqueia até paciente conceder permissão; tutorial de como liberar |
| Conexão cai durante sessão | Cada parte recebe aviso e tenta reconectar automaticamente; se persistir, oferece reentrar pelo mesmo link |
| Browser não suportado | Página mostra "Use Chrome, Edge, Firefox ou Safari recente" com links para download |
| Casal: ambos no mesmo computador (uma webcam só) | Permitido — sistema vê 1 stream de vídeo, identidade é declarada |
| Sessão dura mais que 50 min | Sala continua até 1h após início; psicólogo pode estender manualmente em "Adicionar 15 min" |
| Paciente quer mostrar documento (laudo, exame) | Compartilhamento de tela do paciente NÃO permitido por padrão; psicólogo pode permitir caso a caso |
| Tentativa de Zoom-bombing (link vazado) | Token único por paciente; ainda assim, sala de espera é primeira barreira (psicólogo decide admitir) |
| Gravação interrompida (queda no meio) | Salvar parcial; processar trecho gravado |

## 9. Critérios de aceitação

- [ ] Sala criada automaticamente para sessão online
- [ ] Link do paciente disponível no lembrete WhatsApp 30 min antes
- [ ] Paciente acessa sala sem login, sem instalar app
- [ ] Sala de espera funciona; psicólogo admite paciente
- [ ] Vídeo HD em conexão >5Mbps
- [ ] Compartilhamento de tela funciona
- [ ] Chat textual aparece para ambos
- [ ] Indicador de conexão ruim aparece quando latência >300ms
- [ ] Encerrar sessão pelo psicólogo desconecta paciente com aviso
- [ ] Sala expira 1h após horário previsto (testar)
- [ ] Token expirado mostra mensagem clara
- [ ] Casal: 2 pacientes entram na mesma sala
- [ ] Modo só-áudio funciona (câmera off)
- [ ] Após sessão `done`, tentar entrar pelo link mostra "encerrada"
- [ ] Gravação só ativável com termo assinado
- [ ] Logs de sessão (metadata) registrados; conteúdo NÃO persiste

## 10. Dependências

- Provedor de vídeo (getstream.io recomendado para MVP)
- WebRTC (suporte nativo dos browsers modernos)
- PRD 03 (sessão online) e PRD 04 (lembrete com link)
- PRD 11 (LGPD) — termo de consentimento de gravação
- PRD 10 (transcrição) — fluxo de áudio para IA

## 11. Referências regulatórias

- **Resolução CFP nº 09/2024** — telepsicologia (extinguiu e-Psi; mantém exigências)
- **Resolução CFP nº 13/2022** — gravação de sessão
- **Resolução CFP nº 11/2018** (revogada pela 09/2024) — referência histórica
- **LGPD** — dados sensíveis em trânsito e em repouso
- **Marco Civil da Internet** — guarda de logs de conexão por 1 ano

## Apêndice A — Modelo de dados

```sql
CREATE TABLE video_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) UNIQUE,
  provider VARCHAR(30) NOT NULL, -- 'daily', 'whereby', 'twilio'
  external_room_id VARCHAR(255) NOT NULL,
  therapist_url TEXT NOT NULL,
  patient_token VARCHAR(64) NOT NULL,
  patient_url TEXT NOT NULL,
  partner_token VARCHAR(64), -- usado em sessão de casal
  partner_url TEXT,
  available_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  recording_enabled BOOLEAN DEFAULT FALSE,
  recording_consent_signed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE video_session_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  event_type VARCHAR(30), -- 'patient_joined', 'therapist_joined', 'screen_share_started', 'connection_drop', 'ended', etc.
  participant_role VARCHAR(20), -- 'patient', 'therapist', 'partner'
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE video_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  external_recording_id VARCHAR(255),
  duration_seconds INT,
  status VARCHAR(20), -- 'recording', 'processing', 'transcribed', 'discarded'
  audio_temp_url TEXT, -- expira em 24h
  transcription_id UUID, -- FK para PRD 10
  recorded_at TIMESTAMPTZ,
  discarded_at TIMESTAMPTZ
);

ALTER TABLE patients ADD COLUMN recording_consent_signed_at TIMESTAMPTZ;
ALTER TABLE patients ADD COLUMN recording_consent_revoked_at TIMESTAMPTZ;

CREATE INDEX idx_video_rooms_session ON video_rooms(session_id);
CREATE INDEX idx_video_logs_session_time ON video_session_logs(session_id, created_at);
```