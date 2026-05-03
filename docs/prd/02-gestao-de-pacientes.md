# PRD 02 — Gestão de Pacientes

> **Pré-requisitos:** PRD 00 (visão geral) e PRD 01 (autenticação).

---

## 1. Contexto e problema

O psicólogo atende entre 15 e 40 pacientes recorrentes. Hoje, ele guarda dados desses pacientes em locais fragmentados: contato no WhatsApp, anotações em caderno, dados financeiros em planilha, dados clínicos em Word. **Nada conversa entre si.**

Ele precisa, no sistema, de um **cadastro único de paciente** que sirva como ponte para todas as outras funcionalidades (agenda, prontuário, cobrança, recibo, telepsicologia).

## 2. Objetivo da feature

Permitir que o psicólogo cadastre, consulte, edite e arquive pacientes, mantendo todos os dados clínicos e administrativos em um lugar seguro, com proteção LGPD adequada para dados sensíveis de saúde.

## 3. Escopo

### Dentro do escopo
- CRUD de pacientes (criar, listar, ver detalhes, editar, arquivar)
- Distinção entre paciente "ativo" e "arquivado" (não deletado — guarda obrigatória)
- Suporte a paciente menor de idade (com responsáveis)
- Suporte a paciente em atendimento de casal (vincular dois pacientes)
- Anamnese (questionário inicial)
- Termo de consentimento digital assinado pelo paciente
- Importação CSV simples para migração
- Busca e filtros
- Marcação de tags (TCC, infantil, neuroatípico, etc.)
- Foto opcional do paciente

### Fora do escopo (versões futuras)
- Família/grupo terapêutico complexo (mais de 2 pacientes vinculados) — deixar para versão 2
- Importação direta de outros softwares (Psicomanager, iClinic) — depende de eles oferecerem export
- Histórico médico complexo com integração com prontuário multiprofissional
- Compartilhamento de prontuário com outros profissionais (deixar para módulo "encaminhamento")

## 4. User stories

- **Como psicóloga**, quero cadastrar um novo paciente em menos de 1 minuto.
- **Como psicóloga**, quero buscar um paciente por nome ou telefone para abrir rapidamente.
- **Como psicóloga**, quero ver na lista os pacientes com sessões agendadas hoje.
- **Como psicóloga**, quero arquivar paciente que não atendo mais sem perder o histórico (obrigação CFP).
- **Como psicóloga**, quero registrar que estou atendendo o casal Marina e João, mantendo prontuários separados mas vinculados.
- **Como psicóloga**, quero registrar quem é responsável legal pelo meu paciente menor de idade.
- **Como paciente**, quero assinar digitalmente o termo de consentimento antes da primeira sessão.

## 5. Requisitos funcionais

### 5.1. Tela de listagem de pacientes (`/app/pacientes`)

**RF-02.01.** Tabela/cards com colunas/campos:
- Foto ou iniciais
- Nome completo
- Status (Ativo / Arquivado)
- Última sessão (data ou "Nunca")
- Próxima sessão (data ou "Não agendada")
- Saldo financeiro (soma de pagamentos pendentes — ver PRD 06)
- Ações (Ver, Editar, Arquivar)

**RF-02.02.** Filtros disponíveis no topo:
- Status: Todos / Ativos / Arquivados (default: Ativos)
- Tags: multi-select
- Tem sessão agendada esta semana: Sim/Não
- Saldo devedor: Sim/Não
- Busca por nome, telefone ou email

**RF-02.03.** Ordenação clicando em coluna: nome (default), última sessão, próxima sessão, saldo.

**RF-02.04.** Paginação a cada 25 pacientes.

**RF-02.05.** Botão destacado "+ Novo Paciente" abre modal/tela de criação.

### 5.2. Cadastro de novo paciente

**RF-02.06.** Formulário em duas etapas:

**Etapa 1 — Dados básicos (obrigatórios):**
- Nome completo
- Tipo: Adulto / Adolescente (12-17) / Criança (<12) / Casal
- Data de nascimento (ou idade aproximada se não souber)
- Gênero (texto livre — não obrigatório)
- Telefone celular com WhatsApp (validar formato BR `+55 DDD NNNNN-NNNN`)
- Email (opcional)

**Etapa 2 — Dados complementares (opcionais, mas com prompts):**
- CPF (OBRIGATÓRIO se psicólogo emite Receita Saúde para esse paciente — ver PRD 07)
- Endereço (obrigatório para emissão de recibo de reembolso)
- Profissão
- Estado civil
- Como conheceu o psicólogo (indicação, Doctoralia, Instagram, etc.)
- Tags (multi-select, criáveis: TCC, psicanálise, infantil, casal, neuroatípico, etc.)
- Foto (upload, opcional, máx 2MB)
- Observação livre (campo de texto)

**Para paciente menor de idade — campos adicionais:**
- Nome do responsável legal 1
- Parentesco (mãe, pai, avó, tutor, etc.)
- CPF do responsável (obrigatório se houver Receita Saúde)
- Telefone do responsável
- Email do responsável
- Possibilidade de adicionar 2º responsável

**Para paciente "Casal" — campos adicionais:**
- Adicionar segundo paciente (cria-se um paciente vinculado com mesmo `couple_id`)
- Nome, data de nascimento, telefone, email do parceiro/parceira

**RF-02.07.** Após salvar, redirecionar para tela de detalhes do paciente.

**RF-02.08.** Após criação, oferecer botões rápidos de próxima ação:
- "Agendar primeira sessão"
- "Enviar termo de consentimento"
- "Adicionar à anamnese"

### 5.3. Tela de detalhes do paciente (`/app/pacientes/:id`)

**RF-02.09.** Cabeçalho com:
- Foto/iniciais
- Nome
- Idade calculada
- Telefone (com botão "Abrir no WhatsApp")
- Email (com botão "Copiar")
- Tags
- Status

**RF-02.10.** Abas (tabs):
1. **Visão geral** — próxima sessão, última sessão, saldo, observação livre
2. **Histórico de sessões** — lista cronológica (link para PRD 03 e PRD 05)
3. **Prontuário** — link para PRD 05
4. **Anamnese** — formulário inicial (ver 5.4)
5. **Documentos** — termo de consentimento, laudos, atestados (ver PRD 11)
6. **Financeiro** — pagamentos, saldo, recibos (ver PRD 06 e 08)

**RF-02.11.** Ações no menu (...): Editar, Arquivar, Exportar dados (PDF), Excluir (caso especial — ver RN-02.05).

### 5.4. Anamnese

**RF-02.12.** Formulário de anamnese editável pelo psicólogo, com seções padrão (que ele pode customizar):
- Queixa principal
- História da queixa atual
- História familiar
- História escolar/profissional
- Saúde física (uso de medicamentos, condições)
- Histórico psicoterapêutico
- Hipóteses diagnósticas iniciais
- Plano terapêutico

**RF-02.13.** Cada seção é um campo de texto rico (markdown ou WYSIWYG). Auto-save a cada 10 segundos (ver PRD 05 para padrões de prontuário).

**RF-02.14.** Permitir importar template de anamnese por abordagem (TCC, psicanálise, sistêmica) — biblioteca de templates pode ser adicionada na v2.

**RF-02.15.** Anamnese é parte do prontuário (LGPD dado sensível). Mesmas regras de retenção e auditoria do PRD 05.

### 5.5. Termo de consentimento digital

**RF-02.16.** Sistema gera link único (token) que o psicólogo envia ao paciente via botão "Enviar termo por WhatsApp" ou copiar link.

**RF-02.17.** Paciente abre o link em qualquer dispositivo, sem necessidade de cadastro:
- Lê o termo (texto editável pelo psicólogo no perfil dele — template padrão fornecido)
- Aceita ou recusa
- Se aceitar: registra IP, timestamp, user-agent, e cria assinatura "I agree" eletrônica (não ICP-Brasil, mas legalmente válido conforme MP 2.200-2/2001 art. 10, §2º — assinatura eletrônica simples por aceite)
- Se for menor de idade, o link é enviado ao responsável

**RF-02.18.** Após aceite, o sistema gera PDF do termo assinado, armazena em storage criptografado e marca paciente com `consent_signed_at`.

**RF-02.19.** O paciente recebe cópia por email automaticamente (se cadastrado).

**RF-02.20.** Termo padrão deve incluir: identificação do psicólogo (nome, CRP), descrição do serviço, tratamento de dados conforme LGPD, finalidade do tratamento, base legal (execução de contrato + tutela da saúde), direitos do titular, prazo de retenção, possibilidade de gravação de sessão (opcional, com consentimento em separado se for o caso), valor da sessão e política de cancelamento.

### 5.6. Edição de paciente

**RF-02.21.** Edição mantém todos os campos da criação. Histórico de alterações registrado em audit log (PRD 11) — campos sensíveis (nome, CPF, status) registram quem mudou e quando.

### 5.7. Arquivar paciente (não excluir)

**RF-02.22.** "Arquivar" muda status para `archived`. Paciente sai da lista padrão, mas continua existindo.

**RF-02.23.** Confirmar com modal: "Arquivar este paciente? O histórico continuará armazenado por obrigação legal (CFP — 5 anos / Lei 13.787/2018 — 20 anos para prontuário digital). O paciente não aparecerá mais na lista padrão."

**RF-02.24.** Paciente arquivado pode ser desarquivado a qualquer momento.

### 5.8. Exportar dados do paciente

**RF-02.25.** Botão "Exportar PDF" gera PDF com:
- Dados cadastrais
- Anamnese
- Histórico de sessões (data, duração, valor, status)
- Prontuário (todas as evoluções) — apenas se psicólogo confirmar (alerta de sigilo)
- Documentos anexados

Útil quando paciente exerce direito LGPD de portabilidade ou quando psicólogo precisa fazer encaminhamento.

### 5.9. Importação CSV

**RF-02.26.** Tela de importação aceita CSV com colunas mapeáveis: nome, telefone, email, data_nascimento, tags, observacao.

**RF-02.27.** Validar cada linha; mostrar preview antes de importar; rejeitar duplicatas (mesmo telefone OU mesmo email para o mesmo psicólogo).

## 6. Requisitos não-funcionais

**RNF-02.01.** Listagem de pacientes carrega em <1s para até 200 pacientes.

**RNF-02.02.** Busca retorna em <500ms (índice em `lower(nome)`, `telefone`, `email`).

**RNF-02.03.** Dados de paciente são criptografados em repouso (AES-256). Campos especialmente sensíveis (CPF, endereço completo) podem usar criptografia em coluna além da criptografia em disco.

**RNF-02.04.** Foto do paciente armazenada em Supabase Storage com bucket privado, acesso via URL assinada com expiração de 5 min.

**RNF-02.05.** Audit log obrigatório para qualquer leitura de prontuário ou anamnese (ver PRD 11).

## 7. Regras de negócio

**RN-02.01.** Um paciente pertence a um e somente um psicólogo (`user_id`). Não há compartilhamento entre psicólogos no MVP.

**RN-02.02.** Não é possível ter dois pacientes com o mesmo telefone ou mesmo email para o mesmo psicólogo (proteção contra duplicata acidental). Sistema avisa e oferece "Você quis dizer este paciente?".

**RN-02.03.** CPF é obrigatório se houver pelo menos uma sessão paga registrada para Receita Saúde (ver PRD 07).

**RN-02.04.** Paciente menor de 12 anos: comunicação é direcionada aos responsáveis. WhatsApp do paciente não é usado para lembretes.

**RN-02.05.** **Exclusão definitiva (hard delete)** só é permitida em casos excepcionais documentados (ex: paciente cadastrado por erro, sem nenhuma sessão registrada). NÃO é permitida exclusão de paciente com sessões ou prontuário existente — a lei obriga retenção de prontuário por 20 anos. Exclusão hard exige confirmação dupla (senha + texto "EXCLUIR DEFINITIVAMENTE").

**RN-02.06.** Se paciente exerce direito LGPD de eliminação (art. 18, VI), o sistema **NÃO** apaga; emite aviso fundamentado: "Por força da Lei 13.787/2018 e Resolução CFP 001/2009, prontuário deve ser mantido por 20 anos. Após esse prazo, dados serão anonimizados automaticamente. Você pode solicitar acesso e cópia dos dados a qualquer momento."

**RN-02.07.** Casal com 2 pacientes vinculados: prontuários SEPARADOS (sigilo individual), mas vinculados via `couple_id`. Sessões podem ser conjuntas (apontadas para ambos) ou individuais.

## 8. Edge cases

| Caso | Tratamento |
|---|---|
| Paciente troca de número de telefone | Editar; histórico de números antigos pode ficar em audit log |
| Paciente menor faz 18 anos | Sistema avisa em 30 dias antes; ao fazer aniversário, perguntar se contato deve passar a ser do paciente direto |
| Casal se separa, mas continua atendimento individual | Desvincular `couple_id`; cada paciente fica independente |
| Paciente reaparece após 5 anos arquivado | Desarquivar mantém histórico antigo intacto |
| Psicóloga cadastra paciente que é colega de profissão (potencial conflito ético) | Sistema não bloqueia; cabe ao psicólogo respeitar o Código de Ética |
| Foto inadequada enviada | Permitir bloqueio/denúncia; admin remove |
| Paciente sem CPF (estrangeiro, criança sem CPF emitido) | Permitir cadastro mas avisar que Receita Saúde pode não aceitar (psicólogo decide) |
| Mesmo CPF para dois pacientes (gêmeos? erro?) | Bloquear; pedir verificação |
| Paciente migra para outro psicólogo no mesmo sistema | Não há transferência automática; psicólogo destino faz novo cadastro; psicólogo origem arquiva. Ambos mantêm histórico (sigilo cruzado) |
| Termo de consentimento expirado/revogado pelo paciente | Marcar como `revoked_at`; psicólogo deve cessar atendimento; sistema avisa |

## 9. Critérios de aceitação

- [ ] Cadastro completo de paciente adulto em <1 minuto
- [ ] Cadastro de paciente menor com 2 responsáveis funciona
- [ ] Cadastro de casal cria 2 pacientes vinculados
- [ ] Não é possível duplicar telefone para o mesmo psicólogo
- [ ] Foto upload <2MB funciona; >2MB é rejeitada com mensagem clara
- [ ] Busca por nome parcial retorna em <500ms com 100 pacientes
- [ ] Filtro "tem sessão esta semana" funciona corretamente
- [ ] Arquivar paciente esconde da lista padrão mas mantém em "Arquivados"
- [ ] Tentativa de excluir paciente com sessão registrada é bloqueada
- [ ] Termo de consentimento gera link, paciente assina, PDF é gerado e armazenado
- [ ] Anamnese auto-saves a cada 10 segundos
- [ ] Exportação PDF inclui todos os dados solicitados
- [ ] Audit log registra leitura de prontuário (testar manualmente)
- [ ] Importação CSV funciona com 100 linhas; rejeita duplicatas
- [ ] Paciente desarquivado mantém todo o histórico

## 10. Dependências

- Supabase Storage para fotos e documentos
- Lib de PDF: `pdfkit` (gerar PDF de exportação e termo)
- Lib de markdown rico: `Tiptap` ou `Lexical` para anamnese
- Lib de validação de CPF: `cpf-cnpj-validator`
- PRD 11 (LGPD/auditoria) — implementar audit log junto

## 11. Referências regulatórias

- Resolução CFP 001/2009 — prontuário psicológico
- Lei 13.787/2018 — guarda de prontuário digital por 20 anos
- LGPD art. 11 (dados sensíveis), art. 18 (direitos do titular)
- MP 2.200-2/2001 art. 10, §2º — validade de assinatura eletrônica simples
- Código de Ética do Psicólogo (Resolução CFP 010/2005)

## Apêndice A — Modelo de dados sugerido

```sql
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL, -- psicólogo dono
  full_name VARCHAR(120) NOT NULL,
  patient_type VARCHAR(20) NOT NULL, -- 'adult', 'adolescent', 'child', 'couple'
  birth_date DATE,
  approximate_age INT, -- alternativa se não souber data exata
  gender VARCHAR(50),
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(255),
  cpf VARCHAR(14), -- criptografado em coluna
  address JSONB, -- {street, number, city, state, zip}
  profession VARCHAR(120),
  marital_status VARCHAR(50),
  source VARCHAR(120), -- como conheceu
  tags TEXT[],
  photo_url TEXT,
  notes TEXT, -- observação livre
  status VARCHAR(20) DEFAULT 'active', -- 'active', 'archived'
  consent_signed_at TIMESTAMPTZ,
  consent_revoked_at TIMESTAMPTZ,
  couple_id UUID, -- vincula 2 pacientes que são casal
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  UNIQUE (user_id, phone),
  UNIQUE (user_id, email)
);

CREATE TABLE patient_guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  full_name VARCHAR(120) NOT NULL,
  relationship VARCHAR(50) NOT NULL, -- 'mãe', 'pai', 'tutor'
  cpf VARCHAR(14),
  phone VARCHAR(20),
  email VARCHAR(255),
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE anamnesis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE UNIQUE,
  chief_complaint TEXT,
  history_present_illness TEXT,
  family_history TEXT,
  educational_professional TEXT,
  physical_health TEXT,
  prior_therapy TEXT,
  initial_hypothesis TEXT,
  treatment_plan TEXT,
  custom_sections JSONB, -- seções customizadas
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE consent_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  term_text TEXT NOT NULL,
  signature_token VARCHAR(64) UNIQUE NOT NULL,
  signed_at TIMESTAMPTZ,
  signed_ip INET,
  signed_user_agent TEXT,
  signed_pdf_url TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patients_user_status ON patients(user_id, status);
CREATE INDEX idx_patients_search ON patients USING gin (to_tsvector('portuguese', full_name));
```