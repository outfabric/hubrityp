# PRD 05 — Prontuário Eletrônico

> **Pré-requisitos:** PRD 00, PRD 01, PRD 02, PRD 03.
>
> **Importante:** este é o módulo mais regulado e mais crítico do produto. Erros aqui geram problemas legais, éticos e de confiança. **Leia integralmente antes de codar.**

---

## 1. Contexto e problema

O prontuário psicológico é **obrigatório** pela Resolução CFP nº 001/2009. Hoje, a maioria dos psicólogos brasileiros mantém em papel, Word, Google Drive ou Notion — todos com problemas:
- Papel: ilegível, perde-se, não tem backup
- Word/Drive: sem auditoria, sem cumprimento real da LGPD
- Notion: servidor estrangeiro sem cláusula de operador de dados

O psicólogo precisa de um lugar **clinicamente nativo**, seguro e fácil de usar para registrar:
- Anamnese inicial (já tratada no PRD 02)
- Evolução de cada sessão
- Hipóteses diagnósticas
- Plano terapêutico
- Documentos formais (declaração, atestado, laudo, parecer)

E precisa que o sistema **respeite a estrutura do trabalho dele por abordagem** (TCC tem agenda da sessão e tarefa de casa; psicanálise tem narrativa associativa; sistêmica tem genograma).

## 2. Objetivo da feature

Oferecer um prontuário eletrônico nativamente clínico, multi-abordagem, em conformidade com Resoluções CFP 001/2009 e 06/2019, Lei 13.787/2018 e LGPD, com auditoria completa, retenção de 20 anos e templates editáveis.

## 3. Escopo

### Dentro do escopo
- Evolução de sessão (registro pós-cada-sessão)
- Templates por abordagem (TCC, psicanálise, sistêmica, ABA, livre)
- Hipóteses diagnósticas (CID-10 ou descritiva)
- Plano terapêutico (objetivos, etapas)
- Documentos formais: declaração, atestado, relatório, laudo, parecer (Res. CFP 06/2019)
- Notas pessoais separadas (não fazem parte do prontuário oficial)
- Aplicação de escalas de domínio público (PHQ-9, GAD-7, SDQ, BDI-II, etc.)
- Anexar arquivos (PDF de exame, foto de desenho de criança, áudio)
- Histórico de versões (toda edição cria versão; original nunca é apagado)
- Auditoria de leitura
- Exportação completa em PDF

### Fora do escopo (versões futuras)
- Aplicação de testes SATEPSI (precisa licença das editoras Pearson/Hogrefe/Vetor) — não vale a pena no MVP
- Genograma interativo (só permitir upload de imagem feita externamente)
- Integração com prontuário multiprofissional externo
- Compartilhamento de prontuário com outros profissionais (módulo "encaminhamento" v2)

## 4. User stories

- **Como psicóloga TCC**, quero um template com humor 0-10, agenda da sessão e tarefa de casa.
- **Como psicanalista**, quero um campo de texto livre amplo para escrever associações livres.
- **Como psicóloga**, quero registrar a evolução em <5 minutos depois da sessão.
- **Como psicóloga**, quero anexar o desenho que a criança fez na sessão.
- **Como psicóloga**, quero aplicar PHQ-9 ao paciente periodicamente e ver gráfico de evolução.
- **Como psicóloga**, quero gerar um laudo formatado conforme Res. CFP 06/2019 sem precisar editar manualmente.
- **Como administrador**, quero saber quem leu o prontuário desse paciente nos últimos 90 dias.

## 5. Requisitos funcionais

### 5.1. Estrutura do prontuário do paciente

**RF-05.01.** Cada paciente tem um único prontuário com seções:
- **Anamnese** (única, criada uma vez — ver PRD 02)
- **Evoluções** (uma por sessão — array cronológico)
- **Hipóteses diagnósticas** (lista evolutiva)
- **Plano terapêutico** (documento vivo)
- **Escalas aplicadas** (histórico de aplicação)
- **Documentos formais** (declaração, atestado, etc.)
- **Anexos** (arquivos)

**RF-05.02.** Aba "Notas pessoais": campo separado, **NÃO faz parte do prontuário oficial** que paciente pode acessar (Resolução CFP 001/2009 art. 5 — registros documentais restritos). Sistema deixa explícito ao psicólogo que essa aba é dele.

### 5.2. Evolução de sessão

**RF-05.03.** Após sessão marcada como `done` (PRD 03), botão "Registrar evolução" abre tela de evolução vinculada à sessão.

**RF-05.04.** Templates de evolução por abordagem (psicólogo escolhe default na configuração):

**Template TCC:**
- Humor inicial (0-10)
- Humor final (0-10)
- Pauta da sessão (texto)
- Conteúdo trabalhado (texto)
- Tarefa de casa atribuída (texto)
- Tarefa anterior — completada? (Sim/Parcial/Não)
- Próximos passos (texto)

**Template Psicanálise:**
- Conteúdo manifesto (texto livre, amplo)
- Associações livres (texto)
- Sonhos relatados (texto)
- Transferência observada (texto)
- Reflexões do analista (texto, opcional — pode ir em "Notas pessoais")

**Template Sistêmica/Familiar:**
- Quem participou (membros)
- Conteúdo trabalhado (texto)
- Padrões observados (texto)
- Intervenção realizada (texto)
- Tarefa para casa (texto)

**Template ABA/Comportamental:**
- Comportamentos-alvo trabalhados
- Linha de base (frequência observada)
- Antecedentes / Comportamento / Consequência (ABC)
- Reforçadores aplicados
- Próxima sessão: foco

**Template Livre (default fallback):**
- Conteúdo da sessão (campo único, texto rico)

**RF-05.05.** Templates são editáveis pelo psicólogo (Configurações > Templates). Psicólogo pode criar templates customizados.

**RF-05.06.** Auto-save a cada 10 segundos. Indicador visual "Salvo às HH:MM".

**RF-05.07.** Editor de texto rico (Tiptap recomendado): negrito, itálico, listas, links, citações.

**RF-05.08.** Após salvar pela primeira vez, evolução fica vinculada à sessão. Sessão `done` sem evolução por mais de 7 dias gera lembrete (notificação in-app).

**RF-05.09.** Edições posteriores criam **nova versão** com histórico (versionamento). Versão original NUNCA é deletada (auditoria CFP/LGPD). Após 30 dias, edições adicionais entram em "addendum" (acréscimo, sem alterar texto original — práxis clínica).

### 5.3. Hipóteses diagnósticas

**RF-05.10.** Lista de hipóteses do paciente, cada uma com:
- Descritiva (texto livre) OU
- CID-10 (autocomplete da tabela completa)
- Status: Em investigação / Confirmada / Descartada
- Data de registro
- Observação

**RF-05.11.** Aviso na UI: "Hipótese diagnóstica em psicologia tem natureza de orientação clínica, não de diagnóstico médico. CID-10 é referencial." (Educa psicólogo sobre limite ético.)

### 5.4. Plano terapêutico

**RF-05.12.** Documento vivo com seções:
- Objetivos (lista de itens; cada um com prazo estimado)
- Etapas / Fases
- Recursos terapêuticos (técnicas, exercícios)
- Critérios de sucesso

**RF-05.13.** Editável a qualquer momento. Histórico de alterações disponível.

### 5.5. Aplicação de escalas

**RF-05.14.** Biblioteca de escalas de domínio público pré-configuradas:
- PHQ-9 (depressão)
- GAD-7 (ansiedade)
- BDI-II (Beck Depression Inventory) — verificar status de copyright; se restrito, remover
- BAI (Beck Anxiety Inventory) — idem
- SDQ (Strengths and Difficulties Questionnaire — infantil)
- SCID-D (dissociativo)
- WHOQOL-Bref (qualidade de vida)
- AUDIT (uso de álcool)

> **Atenção:** PHQ-9, GAD-7, SDQ e AUDIT são de domínio público / uso livre. BDI-II e BAI são proprietários (Pearson) — NÃO incluir sem licença. Confirmar cada escala antes do desenvolvimento.

**RF-05.15.** Aplicar escala: psicólogo pode (a) responder no sistema com paciente presente, ou (b) gerar link para paciente responder remotamente antes da sessão.

**RF-05.16.** Sistema calcula score automaticamente e classifica (ex: PHQ-9 score 5-9 = leve, 10-14 = moderado).

**RF-05.17.** Histórico mostra gráfico de evolução do score ao longo do tempo.

**RF-05.18.** Cada aplicação fica registrada como evento no prontuário com data, contexto e score.

### 5.6. Documentos formais (Resolução CFP 06/2019)

**RF-05.19.** Tela "Gerar documento" oferece tipos:
- Declaração
- Atestado
- Relatório
- Laudo Psicológico
- Parecer

**RF-05.20.** Cada tipo tem template estruturado conforme Res. CFP 06/2019 (artigos específicos). Estrutura mínima obrigatória:
- Identificação do solicitante
- Identificação do psicólogo (nome, CRP)
- Descrição da demanda
- Procedimento(s) utilizado(s)
- Análise (texto desenvolvido)
- Conclusão
- Local e data
- Espaço para assinatura

**RF-05.21.** Editor permite preencher cada seção. IA assistente (PRD 10) pode oferecer rascunho baseado no prontuário (com supervisão obrigatória).

**RF-05.22.** Ao finalizar, gerar PDF com:
- Cabeçalho do psicólogo (nome, CRP, contato)
- Numeração de páginas (Página X de Y)
- Espaço para assinatura ICP-Brasil OU rubrica manual + carimbo
- Marca d'água "DOCUMENTO PSICOLÓGICO" sutil

**RF-05.23.** Documento gerado fica armazenado, vinculado ao paciente, com data e versão.

**RF-05.24.** Suporte a assinatura ICP-Brasil (e-CPF) opcional — psicólogo configura uma vez na onboarding. Se não configurado, gera PDF para impressão e assinatura física.

### 5.7. Anexos

**RF-05.25.** Upload de arquivos (PDF, JPG, PNG, áudio MP3, vídeo MP4) até 50MB cada.

**RF-05.26.** Tipos sugeridos no metadado: Exame externo / Imagem / Desenho / Áudio / Outro.

**RF-05.27.** Visualização inline para PDF e imagens; download para outros.

**RF-05.28.** Storage criptografado (AES-256). URL assinada com expiração de 5 min para acesso.

### 5.8. Histórico e auditoria

**RF-05.29.** Aba "Histórico" mostra todas as alterações feitas no prontuário (quem, quando, o quê).

**RF-05.30.** Auditoria de **leitura**: cada vez que prontuário é aberto, registrar `audit_log`:
- Quem (user_id)
- Quando (timestamp)
- O quê (qual seção foi acessada)
- IP e user-agent

**RF-05.31.** Em Configurações > Auditoria, psicólogo pode ver últimos 90 dias de acessos a cada prontuário.

### 5.9. Exportação

**RF-05.32.** Botão "Exportar prontuário completo (PDF)" gera PDF estruturado:
- Capa com identificação
- Anamnese
- Cronologia de evoluções
- Hipóteses diagnósticas
- Plano terapêutico
- Histórico de escalas com gráficos
- Lista de documentos formais
- Lista de anexos (apenas referência, não embute todos)

**RF-05.33.** Confirmação obrigatória antes de exportar: aviso sobre sigilo profissional. Exportação fica registrada em audit log.

**RF-05.34.** Permitir filtros: período, tipo de conteúdo (excluir notas pessoais por padrão).

### 5.10. Notas pessoais (registro restrito)

**RF-05.35.** Aba separada "Notas pessoais" com campo de texto rico, indicação visual clara de que **NÃO faz parte do prontuário oficial** que paciente pode acessar.

**RF-05.36.** Notas pessoais são protegidas por senha extra opcional (segundo fator) — para casos extremamente sensíveis.

**RF-05.37.** Notas pessoais NÃO entram na exportação padrão. Para incluir, opção explícita com aviso.

## 6. Requisitos não-funcionais

**RNF-05.01.** Salvamento da evolução: <500ms (auto-save em background).

**RNF-05.02.** Carregamento do prontuário completo: <2s para 100+ evoluções.

**RNF-05.03.** Criptografia AES-256 em repouso (banco e storage).

**RNF-05.05.** Tempo de retenção: 20 anos após última atividade do paciente. Após 20 anos, sistema marca para anonimização (não exclusão direta).

**RNF-05.07.** Versionamento: cada save da evolução cria versão imutável (append-only).

## 7. Regras de negócio

**RN-05.01.** Toda sessão `done` deve ter evolução. Sistema não força (psicólogo pode estar em emergência), mas notifica após 7 dias.

**RN-05.02.** Edição de evolução após 30 dias da criação só pode adicionar "addendum" (acréscimo), não alterar texto original (práxis clínica + ética).

**RN-05.03.** Notas pessoais NUNCA aparecem em exportação compartilhada com paciente.

**RN-05.04.** Prontuário de paciente do psicólogo A não pode ser visto pelo psicólogo B (mesmo na mesma instância de sistema). Validação rigorosa de `user_id` em toda query.

**RN-05.05.** Solicitação do paciente para acesso ao próprio prontuário (LGPD art. 18 + CFP 001/2009 art. 5): sistema gera PDF (excluindo notas pessoais) que psicólogo entrega ao paciente em até 15 dias úteis.

**RN-05.06.** Documentos formais com CID-10 só devem ser emitidos com consentimento explícito do paciente (sigilo). Sistema avisa.

**RN-05.07.** Gravação de áudio em anexo só com consentimento livre e prévio do paciente, conforme Res. CFP 13/2022. Sistema deve verificar termo de consentimento de gravação assinado antes de permitir upload de áudio de sessão.

**RN-05.08.** Em caso de cancelamento de conta do psicólogo, prontuários NÃO são deletados imediatamente; ficam em quarentena pelo prazo legal mínimo (5 anos). Psicólogo deve fornecer destinação dos prontuários (transferência para outro profissional ou guarda em conservação) — alerta na onboarding e em política de cancelamento.

## 8. Edge cases

| Caso | Tratamento |
|---|---|
| Psicólogo perde acesso à conta (morte, doença grave) | Política de continuidade: contato de emergência cadastrado pode requisitar acesso aos prontuários para entrega aos pacientes ou outro psicólogo, com prova legal |
| Paciente menor de idade pede prontuário | Solicitação processada com responsável legal; conteúdo pode ser editado pelo psicólogo para preservar bem-estar (CFP orienta) |
| Prontuário de paciente que faleceu | Mantém-se conforme prazo legal; herdeiros podem solicitar com prova de óbito e parentesco; psicólogo decide o que liberar conforme ética |
| Conflito de hipótese: psicólogo registra TEA mas pais discordam | Sistema permite múltiplas hipóteses com status; psicólogo registra divergência observada |
| Evolução com erro grave (informação errada de outro paciente) | Não deletar; criar addendum corrigindo, marcando "ERRATA: registro anterior estava equivocado, conteúdo refere-se a outro contexto. Versão correta abaixo." |
| Sistema cai durante escrita | Auto-save mitiga; rascunho local (localStorage) como fallback |
| Paciente exige deleção total (LGPD) | Recusa fundamentada; ver RN-02.06 do PRD 02 |
| Anexar áudio de 2h da sessão | Aviso de tamanho; sugestão de transcrever via PRD 10 e descartar áudio |
| Mesmo paciente com mais de 100 sessões | UI deve paginar/agrupar evoluções (por mês ou ano) |
| Prontuário muito grande (10MB+) na exportação PDF | Gerar em background; enviar por email com link seguro |

## 9. Critérios de aceitação

- [ ] Após sessão `done`, fluxo "Registrar evolução" leva <30 segundos para abrir
- [ ] Template TCC tem todos os campos especificados
- [ ] Auto-save funciona a cada 10 segundos (testar removendo wifi, retornando)
- [ ] Edição após 30 dias cria addendum, não altera texto original
- [ ] Versionamento mantém todas as versões consultáveis
- [ ] PHQ-9 link enviado ao paciente é respondido e score calculado correto
- [ ] Gráfico de evolução do PHQ-9 exibe 3+ aplicações em série temporal
- [ ] Geração de laudo conforme Res. CFP 06/2019 com todas as seções
- [ ] PDF do laudo tem cabeçalho, numeração de páginas, espaço para assinatura
- [ ] Anexar PDF e imagem funciona até 50MB
- [ ] Acesso a prontuário gera entrada em audit_log
- [ ] Exportação PDF completa do prontuário funciona com 50+ evoluções
- [ ] Notas pessoais NÃO aparecem em exportação default
- [ ] Tentativa de psicólogo B acessar paciente do psicólogo A é bloqueada (testar)
- [ ] CID-10 autocomplete funciona com 12000+ códigos
- [ ] Hipótese diagnóstica suporta múltiplas, com status e histórico

## 10. Dependências

- Editor rico: Tiptap (recomendado) ou Lexical
- Lib de PDF: `pdfkit` (mais leve)
- Tabela CID-10 importada (CSV oficial da OMS, Datasus)
- Bibliotecas de gráficos: Recharts ou Chart.js (para evolução de escalas)
- PRD 02 (paciente) e PRD 03 (sessão) implementados
- PRD 11 (auditoria/LGPD) — audit_log integrado

## 11. Referências regulatórias

- **Resolução CFP nº 001/2009** — prontuário psicológico
- **Resolução CFP nº 006/2019** — documentos psicológicos (estrutura formal)
- **Resolução CFP nº 09/2024** — telepsicologia
- **Resolução CFP nº 13/2022** — gravação de sessão
- **Lei 13.787/2018** — guarda de prontuário digital por 20 anos
- **LGPD** art. 11 (dados sensíveis), art. 18 (direitos do titular), art. 16 (eliminação x obrigação legal)
- **Manual Orientativo CFP de Registro e Elaboração de Documentos Psicológicos (nov/2025)** — assinatura ICP-Brasil aceita

## Apêndice A — Modelo de dados

```sql
CREATE TABLE evolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  patient_id UUID REFERENCES patients(id) NOT NULL,
  session_id UUID REFERENCES sessions(id) UNIQUE,
  template_type VARCHAR(30) NOT NULL, -- 'tcc', 'psicanalise', 'sistemica', 'aba', 'livre', 'custom'
  content JSONB NOT NULL, -- estrutura por template
  current_version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  finalized_at TIMESTAMPTZ -- quando ultrapassa 30 dias e fica imutável
);

CREATE TABLE evolution_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evolution_id UUID REFERENCES evolutions(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  content JSONB NOT NULL,
  is_addendum BOOLEAN DEFAULT FALSE,
  modified_by UUID REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (evolution_id, version_number)
);

CREATE TABLE diagnostic_hypotheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id),
  description TEXT,
  cid10_code VARCHAR(10),
  cid10_description TEXT,
  status VARCHAR(20), -- 'investigating', 'confirmed', 'discarded'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE treatment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) UNIQUE,
  goals JSONB,
  phases JSONB,
  resources TEXT,
  success_criteria TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE scale_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id),
  scale_key VARCHAR(50) NOT NULL, -- 'phq9', 'gad7', 'sdq'
  applied_at TIMESTAMPTZ NOT NULL,
  responses JSONB NOT NULL,
  total_score INT,
  classification VARCHAR(50),
  notes TEXT,
  applied_remotely BOOLEAN DEFAULT FALSE,
  remote_token VARCHAR(64) UNIQUE
);

CREATE TABLE clinical_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  patient_id UUID REFERENCES patients(id),
  document_type VARCHAR(30), -- 'declaracao', 'atestado', 'relatorio', 'laudo', 'parecer'
  title VARCHAR(255),
  content JSONB,
  pdf_url TEXT,
  digitally_signed BOOLEAN DEFAULT FALSE,
  signature_method VARCHAR(30), -- 'icp_brasil', 'physical'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE evolution_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id),
  evolution_id UUID REFERENCES evolutions(id),
  file_name VARCHAR(255),
  file_size BIGINT,
  mime_type VARCHAR(100),
  storage_url TEXT,
  category VARCHAR(50), -- 'exam', 'image', 'drawing', 'audio', 'other'
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE personal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) UNIQUE,
  content TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_evolutions_patient_created ON evolutions(patient_id, created_at DESC);
CREATE INDEX idx_evolution_versions_evolution ON evolution_versions(evolution_id, version_number DESC);
CREATE INDEX idx_scale_apps_patient_scale ON scale_applications(patient_id, scale_key, applied_at);
```