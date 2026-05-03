# PRD 08 — Recibo para Reembolso de Plano de Saúde

> **Pré-requisitos:** PRD 00, PRD 01, PRD 02, PRD 03, PRD 06, PRD 07.

---

## 1. Contexto e problema

Pacientes com **plano de saúde (Bradesco, Amil, SulAmérica, Unimed, Porto Seguro, NotreDame Intermédica, Hapvida, etc.)** que fazem psicoterapia particular podem solicitar **reembolso parcial** do valor pago. Para isso, precisam apresentar à operadora um **recibo formal** com dados específicos.

Cada operadora exige um formato ligeiramente diferente:
- Algumas pedem código TUSS (Terminologia Unificada da Saúde Suplementar)
- Outras pedem CID-10 (controverso pelo sigilo)
- Outras exigem encaminhamento médico
- Várias pedem dados complementares: registro CRP, especialidade, abordagem

**Receita Saúde NÃO substitui esse recibo** — Receita Saúde é tributário (Receita Federal), recibo de reembolso é contratual entre paciente e operadora. Psicólogo emite os dois.

**A dor real:**
- Psicólogo passa 5–10 min preenchendo recibo manual no Word para cada paciente que vai pedir reembolso
- Operadora recusa o recibo se faltar algum dado → paciente fica chateado e cobra
- Cada operadora tem layout diferente — confusão

## 2. Objetivo da feature

Gerar recibos formatados para reembolso de plano de saúde, com templates por operadora, em PDF profissional, em segundos, com todos os dados exigidos pela operadora destino.

## 3. Escopo

### Dentro do escopo
- Template universal de recibo (atende maioria das operadoras)
- Templates específicos para top 6 operadoras brasileiras
- Geração de PDF formatado
- Envio direto ao paciente via WhatsAPP ou email
- Histórico de recibos emitidos por paciente
- Códigos TUSS de psicologia (50000462 — atendimento individual, 50000470 — grupo, etc.)
- Possibilidade de anexar encaminhamento médico (PDF) ao recibo
- Numeração sequencial de recibos por psicólogo (controle interno)
- Assinatura digital opcional

### Fora do escopo (versões futuras)
- Envio direto à operadora (TISS — não se aplica a reembolso de livre escolha)
- Acompanhamento de status do reembolso
- Pré-autorização de sessões pelo plano
- Recibo para clínica que faz convênio direto

## 4. User stories

- **Como psicóloga**, quero gerar recibo Bradesco em 30 segundos.
- **Como psicóloga**, quero ter template salvo para cada operadora que mais aparece.
- **Como psicóloga**, quero numerar recibos automaticamente (controle fiscal).
- **Como paciente**, quero receber o recibo no meu WhatsApp para enviar ao plano.
- **Como administradora do meu consultório**, quero o histórico de quantos recibos emiti em outubro.

## 5. Requisitos funcionais

### 5.1. Configuração inicial

**RF-08.01.** Em Configurações > Recibos para Reembolso:
- Razão social ou nome do psicólogo (default = nome cadastrado)
- CPF/CNPJ do psicólogo
- CRP completo
- Endereço profissional
- Telefone de contato
- Email
- Logotipo (upload opcional, máx 1MB)
- Código de serviço (default: psicologia clínica)
- Numeração inicial de recibo (default: 1)
- Texto livre adicional (cláusulas que o psicólogo queira sempre incluir)

**RF-08.02.** Configuração de templates por operadora:
- Lista de operadoras pré-cadastradas: Bradesco Saúde, Amil, SulAmérica, Unimed (Federação Nacional), Porto Seguro, NotreDame Intermédica, Hapvida, Cassi, Petrobras, Petrobras-Saúde, Caixa Saúde, GEAP
- Para cada operadora: campos obrigatórios já configurados (TUSS, CID, etc.)
- Psicólogo pode adicionar operadora customizada com campos próprios

### 5.2. Cadastrar plano de saúde do paciente

**RF-08.03.** Na ficha do paciente (PRD 02), seção "Plano de Saúde" opcional:
- Operadora (select)
- Número da carteirinha
- Tipo de plano
- Encaminhamento médico anexado? (upload)
- Limite de sessões reembolsáveis ao ano (campo informativo; psicólogo preenche se souber)

### 5.3. Geração de recibo

**RF-08.04.** Em uma sessão `paid` (PRD 06) ou em lote, botão "Gerar recibo de reembolso":
- Selecionar operadora (default: a do paciente)
- Validar que campos obrigatórios estão preenchidos
- Mostrar preview do PDF antes de gerar definitivo

**RF-08.05.** Conteúdo padrão do recibo:
- Cabeçalho com logotipo (se houver)
- Título: "RECIBO DE PRESTAÇÃO DE SERVIÇO PSICOLÓGICO — Nº [sequencial]"
- Identificação do psicólogo: nome, CRP, CPF/CNPJ, endereço
- Identificação do paciente: nome, CPF, número da carteirinha do plano
- Dados da sessão:
  - Data
  - Tipo de atendimento (individual / casal / familiar / grupo)
  - Duração
  - Código TUSS (50000462 — atendimento psicológico individual; 50000470 — psicoterapia individual; 50000489 — psicoterapia em grupo; verificar tabela atual TUSS)
  - Valor (R$)
- Forma de pagamento (PIX / dinheiro / outros)
- Local e data de emissão
- Assinatura do psicólogo (digital ou espaço para física)
- Cláusula final: "Declaro que prestei o serviço acima descrito ao(à) paciente identificado(a), conforme valor recebido."

**RF-08.06.** Se operadora exige CID-10, perguntar explicitamente ao psicólogo (não preencher automaticamente). Mostrar aviso sobre sigilo.

**RF-08.07.** Geração em <3 segundos.

### 5.4. Geração em lote

**RF-08.08.** Útil quando paciente pede recibo de várias sessões de uma vez (mensal). Filtrar sessões `paid` do paciente em período, selecionar todas, gerar:
- **Opção A:** PDF único com lista de sessões e valor total (preferido pela maioria das operadoras)
- **Opção B:** PDFs individuais (uma sessão por recibo) compactados em ZIP

**RF-08.09.** Numeração: sequencial mantida (mesmo em lote, cada recibo recebe número único).

### 5.5. Envio ao paciente

**RF-08.10.** Após gerar PDF, opções:
- Baixar
- Enviar via WhatsApp (template `recibo_reembolso` — PRD 04)
- Enviar via email
- Imprimir

**RF-08.11.** Email contém PDF anexado + texto explicativo: "Olá [Nome], segue recibo da sessão de [data] para enviar à sua [operadora]. Lembre-se de anexar o encaminhamento médico, se exigido. Atenciosamente, [Psicólogo]."

### 5.6. Histórico

**RF-08.12.** Em `/app/financeiro/recibos`:
- Tabela: número, data, paciente, operadora, valor, ações
- Filtros: período, operadora, paciente
- Total emitido no período
- Exportação CSV

**RF-08.13.** Botão "Reemitir" para gerar nova cópia (mesmo número).

### 5.7. Numeração

**RF-08.14.** Numeração sequencial por psicólogo (não global). Sistema garante unicidade e não permite "pular" números.

**RF-08.15.** Reset anual (opcional, configurável): psicólogo pode escolher reiniciar contagem a cada ano (formato: 2026/0001).

### 5.8. Assinatura digital

**RF-08.16.** Se psicólogo configurou ICP-Brasil (ver PRD 05), oferecer assinar PDF digitalmente. Caso contrário, gerar PDF com espaço para assinatura física.

**RF-08.17.** Assinatura digital adicionada ao PDF como campo de assinatura padrão (PAdES). Verificável em qualquer leitor de PDF.

### 5.9. Anexo de encaminhamento médico

**RF-08.18.** Algumas operadoras exigem encaminhamento de médico para reembolso. Sistema permite anexar PDF do encaminhamento à ficha do paciente (uma vez) e:
- Mesclar ao recibo (PDF combinado), ou
- Enviar como anexo separado no email

**RF-08.19.** Sistema avisa o psicólogo: "Operadora [X] geralmente exige encaminhamento médico. Paciente tem encaminhamento anexado? Sim/Não/Lembrar paciente"

## 6. Requisitos não-funcionais

**RNF-08.01.** Geração de PDF: <3 segundos para recibo individual; <30 segundos para lote de 50.

**RNF-08.02.** PDF com tamanho otimizado (<300KB típico) para envio via WhatsApp.

**RNF-08.03.** PDF com qualidade A4, pronto para impressão.

**RNF-08.04.** Templates de operadora atualizados conforme especificações ANS — sistema deve permitir admin atualizar templates sem deploy.

**RNF-08.05.** Storage do PDF gerado: Supabase Storage com retenção mínima de 5 anos (mesma do prontuário, conservadoramente).

## 7. Regras de negócio

**RN-08.01.** Recibo de reembolso é DIFERENTE de Receita Saúde. Recibo é entregue ao paciente; Receita Saúde é enviada à RFB. Psicólogo emite ambos.

**RN-08.02.** Para emitir recibo, sessão deve estar `paid`. Sistema bloqueia emissão de recibo de sessão não paga (operadoras exigem prova de pagamento).

**RN-08.03.** Numeração é por psicólogo, sequencial, sem buracos. Se recibo for cancelado, número fica registrado como `cancelled` mas não é reusado.

**RN-08.04.** CID-10 no recibo é decisão CASO A CASO do psicólogo, com consentimento do paciente. Default: NÃO incluir.

**RN-08.05.** TUSS: o sistema deve manter tabela TUSS de psicologia atualizada. Códigos relevantes:
- `50000462` — Atendimento psicológico individual
- `50000470` — Psicoterapia individual por sessão
- `50000489` — Psicoterapia de grupo
- `50000497` — Psicoterapia familiar/casal
- `50000500` — Avaliação psicológica
> **Atenção:** códigos TUSS podem mudar; verificar tabela ANS atual antes de implementar.

**RN-08.06.** Recibo é documento que o paciente entrega à operadora; o psicólogo NÃO se comunica com a operadora (livre escolha).

**RN-08.07.** Se paciente pediu recibo, sistema considera consentimento implícito de tratamento dos dados para essa finalidade (LGPD art. 7º, V — execução de contrato). Não precisa consentimento adicional.

**RN-08.08.** Operadoras NÃO podem exigir conteúdo clínico no recibo (apenas dados administrativos). Se exigirem, é prática abusiva — psicólogo orienta paciente a denunciar à ANS.

## 8. Edge cases

| Caso | Tratamento |
|---|---|
| Paciente trocou de operadora durante o tratamento | Permitir alterar operadora na ficha; recibos antigos mantêm operadora antiga |
| Paciente não tem operadora cadastrada | Recibo padrão (universal) — geralmente aceito |
| Operadora pede formato muito específico | Permitir templates customizados em Configurações |
| Sessão paga parcialmente | Recibo emitido pelo valor pago (com observação) |
| Recibo emitido com erro | Cancelar (status `cancelled`); emitir novo com novo número; histórico mantém ambos |
| Paciente pede recibo retroativo de 6 meses | Geração em lote no período; sistema cria PDFs ou um consolidado |
| Operadora paga reembolso ao psicólogo direto (raro, livre escolha) | Não tratado no MVP; psicólogo registra como "pagamento de operadora" no PRD 06 |
| Paciente é dependente em plano de outra pessoa (cônjuge) | Usar dados do paciente; campo "titular do plano" opcional para algumas operadoras |
| Encaminhamento médico vencido | Sistema alerta data de validade (1 ano típico); não bloqueia emissão |
| Logotipo grande demais | Redimensionar automaticamente para no máx 200x80px |
| Paciente pede recibo em outro idioma (paciente estrangeiro com seguro internacional) | Não suportado no MVP — psicólogo edita PDF manual |

## 9. Critérios de aceitação

- [ ] Configuração inicial em <2 minutos
- [ ] Geração de recibo individual em <3 segundos
- [ ] PDF gerado com todos os campos obrigatórios da operadora selecionada
- [ ] Numeração sequencial sem buracos (testar com 100 emissões)
- [ ] CID-10 default OFF; quando incluído, mostra aviso
- [ ] Envio via WhatsApp com PDF anexado funciona
- [ ] Histórico filtrável por período, operadora e paciente
- [ ] Geração em lote de 30 recibos em <30s
- [ ] Reemissão mantém mesmo número
- [ ] Cancelamento marca como `cancelled` e libera para emitir novo
- [ ] PDF com assinatura digital ICP-Brasil é validado por leitor PDF (Adobe Reader)
- [ ] PDF impresso em A4 fica legível e profissional
- [ ] Operadora customizada pode ser cadastrada e usada
- [ ] Anexo de encaminhamento médico é mesclado ao PDF se selecionado

## 10. Dependências

- Lib de PDF: PDFKit (mais leve)
- Tabela TUSS atualizada (CSV/JSON, fonte ANS)
- Lib de assinatura digital PAdES (node-signpdf ou similar)
- PRD 02 (paciente), PRD 03 (sessão), PRD 06 (pagamento confirmado)
- PRD 07 (Receita Saúde) já implementado — usuário deve entender diferença

## 11. Referências regulatórias

- **Resolução Normativa ANS nº 501/2022** — TISS (livre escolha NÃO se aplica TISS, §3º)
- **Tabela TUSS** — códigos de procedimentos (atualizada periodicamente pela ANS)
- **Lei 9.656/1998** — planos de saúde
- **Código Civil** — contrato livre escolha entre paciente e operadora
- **Resolução CFP 06/2019** — referência para forma do documento

## Apêndice A — Modelo de dados

```sql
CREATE TABLE health_insurance_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id), -- NULL = template global
  name VARCHAR(120) NOT NULL,
  short_code VARCHAR(20),
  required_fields JSONB, -- ['tuss', 'cid10', 'medical_referral']
  custom_template TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE patients ADD COLUMN insurance_provider_id UUID REFERENCES health_insurance_providers(id);
ALTER TABLE patients ADD COLUMN insurance_card_number VARCHAR(50);
ALTER TABLE patients ADD COLUMN insurance_titular VARCHAR(120);
ALTER TABLE patients ADD COLUMN medical_referral_url TEXT;
ALTER TABLE patients ADD COLUMN medical_referral_expires_at DATE;

CREATE TABLE reimbursement_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  patient_id UUID REFERENCES patients(id) NOT NULL,
  receipt_number VARCHAR(50) NOT NULL,
  insurance_provider_id UUID REFERENCES health_insurance_providers(id),
  session_ids UUID[] NOT NULL, -- pode ser uma ou várias sessões
  total_amount DECIMAL(10,2) NOT NULL,
  tuss_code VARCHAR(20),
  cid10_code VARCHAR(10),
  cid10_included BOOLEAN DEFAULT FALSE,
  pdf_url TEXT,
  digitally_signed BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'issued', -- 'issued', 'cancelled', 'reissued'
  cancellation_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, receipt_number)
);

CREATE TABLE receipt_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE,
  legal_name VARCHAR(120),
  tax_id VARCHAR(20), -- CPF ou CNPJ
  professional_address JSONB,
  contact_phone VARCHAR(20),
  contact_email VARCHAR(255),
  logo_url TEXT,
  service_code VARCHAR(20),
  current_number INT DEFAULT 0,
  yearly_reset BOOLEAN DEFAULT FALSE,
  custom_clauses TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_receipts_user_issued ON reimbursement_receipts(user_id, issued_at DESC);
CREATE INDEX idx_receipts_patient ON reimbursement_receipts(patient_id, issued_at DESC);
```