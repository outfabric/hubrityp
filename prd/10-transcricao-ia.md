# PRD 10 — Transcrição Automática de Sessão com IA

> **Pré-requisitos:** PRD 00, PRD 01, PRD 02, PRD 03, PRD 05, PRD 09.
>
> **Importante:** este é um dos diferenciais centrais do produto. **Também é o módulo de maior risco ético/regulatório.** Exige cuidado especial.

---

## 1. Contexto e problema

Após cada sessão de 50 min, o psicólogo precisa registrar a evolução no prontuário (PRD 05). Isso toma **5–15 minutos por paciente**. Em 30 sessões/semana, são **2,5 a 7,5 horas semanais** só de registro — tempo que poderia ser outra sessão (R$ 600+ semanais).

**A solução com IA:**
1. Sessão é gravada (com consentimento) — áudio
2. Áudio é transcrito automaticamente (Google Gemini)
3. Transcrição é resumida e estruturada por IA (Google Gemini) em formato de evolução clínica
4. Psicólogo revisa, ajusta, salva — em 1-2 minutos

**Concorrente já fazendo isso:** PsiNota AI (sb. lançada 2024-2025). Mercado já educado.

**Riscos críticos:**
- LGPD — áudio de sessão é dado pessoal sensível; pode haver dados de terceiros (paciente fala de mãe, do irmão)
- CFP 13/2022 — gravação só com consentimento livre, prévio, informado, justificado
- Sigilo profissional — vazamento seria devastador
- Alucinação da IA — "fabricar" conteúdo da sessão é grave
- Psicólogo confiar cegamente — IA é ferramenta, decisão clínica é dele

## 2. Objetivo da feature

Reduzir o tempo de registro de evolução clínica de 10 min para 1-2 min por sessão, oferecendo transcrição e nota estruturada gerada por IA, com supervisão humana obrigatória do psicólogo, em conformidade com LGPD e CFP.

## 3. Escopo

### Dentro do escopo
- Captura de áudio durante sessão online (PRD 09) ou upload manual (sessão presencial)
- Transcrição automática (Gemini API)
- Geração de nota estruturada via LLM (Gemini)
- Suporte a templates de nota (TCC/psicanálise/sistêmica/livre — alinhados com PRD 05)
- Edição da nota gerada antes de salvar no prontuário
- Identificação de palavras-chave de risco (suicídio, autolesão) — alerta automático
- Diarização (separar fala do psicólogo vs paciente) — opcional v1, recomendado v2
- Descarte automático do áudio após processamento (default: 24h)
- Possibilidade de manter áudio para auditoria (com consentimento extra)
- Métricas de uso: tempo economizado, custo por sessão

### Fora do escopo (versões futuras)
- Análise emocional (sentiment analysis) das falas — risco ético alto
- Detecção automática de hipóteses diagnósticas — psicólogo decide
- Tradução em tempo real
- Transcrição de sessão em grupo (várias vozes simultâneas) — v2
- "Coach" para o psicólogo (sugerir intervenções) — fora do escopo regulatório
- Resumo enviado ao paciente — PROIBIDO no MVP (responsabilidade técnica do psicólogo)

## 4. User stories

- **Como psicóloga**, quero gravar a sessão online e ter a evolução pronta em 2 min.
- **Como psicóloga**, quero gravar uma sessão presencial pelo celular e fazer upload depois.
- **Como psicóloga**, quero a IA escrever no formato TCC porque é minha abordagem.
- **Como psicóloga**, quero ser avisada se o paciente mencionou ideação suicida.
- **Como psicóloga**, quero revisar e editar a nota antes de salvar — IA é assistente, não substituta.
- **Como paciente**, quero ter certeza de que minha gravação é descartada após uso.

## 5. Requisitos funcionais

### 5.1. Pré-requisitos: consentimento

**RF-10.01.** Para usar a feature com qualquer paciente, é necessário:
- Termo de consentimento de gravação assinado pelo paciente (PRD 02 termo geral pode ter cláusula opcional, OU termo separado específico)
- Consentimento explícito sobre processamento por IA (LGPD art. 7º + 11)

**RF-10.02.** Termo de IA inclui:
- Finalidade: gerar evolução clínica para prontuário
- Tipo de processamento: transcrição via Google Gemini; nota gerada por IA
- Dados compartilhados: áudio é enviado ao provedor por chamada API (efêmero, não retém)
- Retenção: áudio descartado em 24h
- Direito de revogação: paciente pode revogar a qualquer momento; gravações futuras param

**RF-10.03.** Sem termo assinado: feature fica desabilitada na sessão, com mensagem "Paciente não assinou termo de gravação. Enviar termo agora?".

### 5.2. Captura de áudio

**RF-10.04.** **Modo A — Sessão online (PRD 09):**
- Botão "Gravar sessão" antes de iniciar
- Banner durante a sessão: "🔴 Gravando" visível para ambos
- Áudio é capturado e armazenado temporariamente em servidor (sa-east-1)

**RF-10.05.** **Modo B — Sessão presencial (upload):**
- Após sessão, psicólogo grava em celular ou gravador
- Upload do arquivo (MP3, M4A, WAV) na ficha da sessão
- Tamanho máximo: 200MB por arquivo
- Sistema processa e descarta áudio após (RF-10.13)

**RF-10.06.** Em ambos os modos, sistema valida que termo de gravação está vigente para o paciente.

### 5.3. Transcrição

**RF-10.07.** Sistema envia áudio para Gemini API (Google):
- Modelo: `3 flash`
- Idioma: pt-BR (forçado)
- Timestamps: ativos (para diarização posterior)

**RF-10.09.** Transcrição bruta retorna JSON com segments. Sistema armazena temporariamente para gerar a nota.

**RF-10.10.** Diarização (separar quem fala): v1 opcional, v2 recomendado. Tecnologias: pyannote.audio, AssemblyAI Universal-2, Deepgram.

### 5.4. Geração da nota estruturada

**RF-10.11.** Após transcrição, sistema chama LLM com prompt fine-tunado por template:

**Exemplo prompt template TCC:**
```
Você é um assistente que ajuda psicólogos brasileiros a registrar evoluções clínicas.

Recebeu a transcrição literal de uma sessão de psicoterapia (paciente identificado por consentimento). Sua tarefa:

1. Resumir o conteúdo da sessão em formato estruturado de evolução TCC
2. Identificar humor inicial e final relatados (escala 0-10 se mencionada)
3. Listar pauta da sessão
4. Listar conteúdo trabalhado (técnicas TCC se identificadas)
5. Listar tarefa de casa atribuída (se houver)
6. Sinalizar palavras-chave de risco (ideação suicida, autolesão, violência)

NÃO invente conteúdo. Se algo não foi explicitamente dito, escreva "[não mencionado]".

NÃO faça interpretações clínicas profundas — quem faz é o psicólogo.

Use linguagem clínica em português brasileiro.

Transcrição:
{transcription}

Saída em JSON com chaves: humor_inicial, humor_final, pauta, conteudo_trabalhado, tarefa_casa, palavras_risco, observacoes_extras.
```

**RF-10.12.** Modelo recomendado: **Gemini 3 Flash** (Google).

### 5.5. Descarte do áudio

**RF-10.13.** Após nota gerada e exibida ao psicólogo:
- Áudio bruto é removido em até 24h (job programado)
- Transcrição textual também é descartada (mantém apenas nota estruturada gerada)
- Logs de processamento são mantidos sem o conteúdo (timestamp, duração, status)

**RF-10.14.** Configuração opcional: "Manter áudio por 30 dias para minha referência". Requer consentimento extra do paciente.

### 5.6. Tela de revisão da nota

**RF-10.15.** Após processamento, psicólogo abre modal/tela com:
- Cabeçalho: "Nota gerada por IA — REVISE antes de salvar"
- Cada campo da nota editável
- Banner amarelo: "Esta nota é um rascunho. Você é responsável pelo conteúdo final."
- Se houver alerta de risco: banner vermelho destacando palavras-chave
- Botões: [Salvar no prontuário] [Editar mais] [Descartar e escrever manualmente]

**RF-10.16.** Salvar no prontuário cria evolução vinculada à sessão (PRD 05). Sistema marca evolução com flag `ai_assisted = true` (auditoria).

### 5.7. Alertas de risco

**RF-10.17.** LLM identifica menções a:
- Ideação suicida ("não quero mais viver", "pensei em me matar")
- Autolesão
- Violência doméstica
- Risco a terceiros
- Uso abusivo de substâncias com risco

**RF-10.18.** Se identificado, banner VERMELHO no topo da tela de revisão: "⚠ Conteúdo de risco identificado. Revise as falas: [trecho]. Considere: contato pós-sessão, plano de segurança, encaminhamento."

**RF-10.19.** Sistema NÃO toma decisão clínica. Apenas sinaliza para o psicólogo.

### 5.8. Performance e fila

**RF-10.20.** Processamento é assíncrono (worker no Inngest):
- Fila prioritária para sessões recentes (<24h)
- Notificação push/email quando nota está pronta
- Tempo médio esperado: 2-5 min para sessão de 50 min

**RF-10.21.** Indicador de progresso na agenda: ícone 🤖 próximo à sessão indica nota IA disponível.

### 5.9. Configurações

**RF-10.22.** Em Configurações > Transcrição IA:
- Ativar/desativar feature (default: ativada — psicólogo escolhe ativamente)
- Template default (mesmo do PRD 05)
- Idioma (pt-BR fixo no MVP)
- Manter áudio? (default: NÃO)
- Manter transcrição textual? (default: NÃO)
- Sensibilidade de detecção de risco (Alta / Média / Baixa)

**RF-10.23.** Estatísticas:
- Sessões processadas no mês
- Tempo médio economizado (estimativa: 8 min/sessão)
- Taxa de aceitação da nota (% que psicólogo salva sem editar muito)

### 5.10. Suporte multi-idioma

**RF-10.24.** MVP: pt-BR fixo.

**RF-10.25.** Caso paciente fale espanhol/inglês: feature pode falhar. Avisar.

## 6. Requisitos não-funcionais

**RNF-10.01.** Latência de processamento: <5 min para sessão de 50 min.

**RNF-10.03.** Áudio em trânsito: TLS 1.3.

**RNF-10.04.** Áudio em repouso (até 24h): AES-256 em Storage privado, com URL assinada de curta duração.

**RNF-10.05.** Logs de processamento NÃO contêm conteúdo da sessão (apenas IDs, timestamps, métricas).

**RNF-10.06.** Garantia de descarte: job de exclusão roda diariamente; auditoria mostra que áudios >24h foram removidos.

**RNF-10.07.** Conformidade dos provedores:
- Google Gemini: dados não usados para treino (configurável via API). Verificar termos atuais. Para LGPD, configurar opção de "no training" e ter contrato de operador.

## 7. Regras de negócio

**RN-10.01.** **OBRIGATÓRIO consentimento** documentado por escrito para gravação E para processamento por IA (CFP 13/2022 + LGPD art. 11).

**RN-10.02.** Psicólogo é o **controlador** dos dados; provedor de IA é **operador** (LGPD art. 5º). Sistema documenta isso na onboarding e expõe contratos.

**RN-10.03.** Áudio descartado em 24h por padrão. Manter mais tempo exige consentimento adicional.

**RN-10.04.** Nota gerada por IA é RASCUNHO. Salvar no prontuário é ato deliberado do psicólogo. Audit log registra.

**RN-10.05.** Sistema nunca compartilha conteúdo da sessão fora do fluxo controlado (psicólogo, IA via API, prontuário). Nunca para terceiros, nunca para análise interna.

**RN-10.06.** Em caso de revogação do consentimento pelo paciente: gravações futuras param imediatamente; gravações passadas processadas continuam (ato consumado).

**RN-10.07.** Sistema NÃO permite gravar sem termo. UI bloqueia.

**RN-10.08.** LLM NÃO recebe nome real do paciente (substituir por "Paciente" antes do prompt). Pseudonimização ajuda em caso de incidente.

**RN-10.09.** Em caso de uso indevido (psicólogo gravando paciente sem termo válido), responsabilidade civil/ética é do psicólogo. Sistema preserva logs como prova.

**RN-10.10.** Teor da sessão NUNCA aparece em logs de erro, métricas ou debug.

## 8. Edge cases

| Caso | Tratamento |
|---|---|
| Áudio de sessão em ambiente com muito ruído | Gemini degrada qualidade; nota será imprecisa; alertar psicólogo |
| Sessão muito longa (2h, avaliação) | Processar em chunks; concatenar |
| Paciente com voz baixíssima | Resultado pobre; sugerir psicólogo gravar com mic externo |
| Paciente fala em outro idioma | Gemini detecta; nota fica em pt-BR mas pode pular trechos não-pt |
| Múltiplas vozes (sessão de casal, família) | Diarização recomendada; sem ela, nota pode confundir falas |
| Falha do Gemini (timeout, indisponível) | Retentar 3x; persistir áudio até 7 dias para reprocessar |
| Falha do LLM | Retentar; em última instância, oferecer "transcrição bruta" (sem nota estruturada) |
| Conteúdo de risco identificado erroneamente (falso positivo) | Psicólogo edita; sistema aprende com feedback (v2) |
| Paciente revoga consentimento durante sessão | Parar gravação imediatamente; descartar áudio em 24h; notificar psicólogo |
| Sessão sem fala (paciente em silêncio prolongado) | Nota gerada será curta; psicólogo complementa |
| Áudio corrompido no upload | Validar antes de processar; pedir reupload |

## 9. Critérios de aceitação

- [ ] Sem termo de gravação → feature bloqueada com mensagem clara
- [ ] Gravação durante sessão online (PRD 09) com banner visível para paciente
- [ ] Upload de áudio até 200MB funciona (MP3, M4A, WAV)
- [ ] Transcrição Gemini em pt-BR
- [ ] Nota estruturada gerada conforme template TCC com todos os campos
- [ ] Nota estruturada gerada conforme template psicanálise
- [ ] Áudio descartado em até 24h (testar com cron job real)
- [ ] Tempo total de processamento <5 min para sessão de 50 min
- [ ] Banner VERMELHO aparece se conteúdo de risco identificado
- [ ] Psicólogo edita nota antes de salvar; sistema persiste edição
- [ ] Evolução salva no prontuário marcada como `ai_assisted = true`
- [ ] Revogação de consentimento bloqueia futuras gravações imediatamente
- [ ] Logs não contêm conteúdo da sessão
- [ ] Pseudonimização: nome do paciente NÃO vai para o prompt do LLM
- [ ] Estatísticas de uso aparecem em Configurações
- [ ] Falha de Gemini retentada 3x com backoff

## 10. Dependências

- Google Gemini 3 Flash API
- Google Gemini 3 Flash para nota estruturada
- Inngest (filas)
- Supabase Storage (áudio temporário)
- PRD 05 (prontuário) — destino da nota
- PRD 09 (vídeo) — fonte de áudio em sessões online
- PRD 11 (LGPD) — termo, audit log, descarte garantido

## 11. Referências regulatórias

- **Resolução CFP nº 13/2022** — gravação de sessão exige consentimento livre, prévio, informado, escrito, justificado pelo método
- **Resolução CFP nº 09/2024** — telepsicologia
- **LGPD** art. 7º (bases legais), art. 11 (dados sensíveis), art. 6º (princípios — finalidade, necessidade)
- **LGPD** art. 5º (controlador / operador) — relação com provedor de IA
- **Código de Ética do Psicólogo** — sigilo profissional

## Apêndice A — Modelo de dados

```sql
CREATE TABLE ai_transcription_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE,
  enabled BOOLEAN DEFAULT FALSE,
  default_template VARCHAR(30), -- 'tcc', 'psicanalise', 'sistemica', 'aba', 'livre'
  keep_audio_days INT DEFAULT 0, -- 0 = descarte em 24h
  keep_transcription BOOLEAN DEFAULT FALSE,
  risk_detection_sensitivity VARCHAR(10) DEFAULT 'medium',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_transcriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  patient_id UUID REFERENCES patients(id) NOT NULL,
  session_id UUID REFERENCES sessions(id),
  evolution_id UUID REFERENCES evolutions(id),
  source VARCHAR(30), -- 'video_session' (PRD 09), 'manual_upload'
  audio_temp_url TEXT, -- expira em 24h
  audio_size_bytes BIGINT,
  audio_duration_seconds INT,
  audio_discarded_at TIMESTAMPTZ,
  transcription_provider VARCHAR(30), -- 'whisper_openai', 'faster_whisper'
  llm_provider VARCHAR(30), -- 'claude_haiku', 'gpt_4o_mini'
  template_used VARCHAR(30),
  generated_note JSONB,
  risk_alerts JSONB, -- ex: [{trecho: "...", tipo: "suicidal"}]
  reviewed_by_user_at TIMESTAMPTZ,
  saved_to_prontuario BOOLEAN DEFAULT FALSE,
  user_edits_count INT DEFAULT 0,
  whisper_cost_usd DECIMAL(8,4),
  llm_cost_usd DECIMAL(8,4),
  status VARCHAR(20), -- 'pending', 'transcribing', 'generating', 'ready', 'reviewed', 'failed'
  error_message TEXT,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_ai_transcriptions_user_status ON ai_transcriptions(user_id, status);
CREATE INDEX idx_ai_transcriptions_audio_to_discard ON ai_transcriptions(created_at) 
  WHERE audio_temp_url IS NOT NULL AND audio_discarded_at IS NULL;
```