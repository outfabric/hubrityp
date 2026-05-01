# PRD 06 — Cobrança e Gestão Financeira

> **Pré-requisitos:** PRD 00, PRD 01, PRD 02, PRD 03.

---

## 1. Contexto e problema

O psicólogo recebe pagamento dos pacientes (R$ 150–300 por sessão). Hoje, o controle é caótico:
- PIX direto na conta pessoal, sem registro automático
- Planilha Excel desatualizada
- Esquece de cobrar paciente que faltou
- Não sabe quanto cada paciente deve
- No fim do mês, não sabe quanto faturou

**A dor real:** uma psicóloga com 30 pacientes/semana e 10% de inadimplência perde **R$ 1.800–3.600 por mês** por falta de gestão. Recuperar isso paga qualquer SaaS.

**Atenção regulatória:** o sistema NÃO deve receber pagamento em nome do psicólogo (isso vira "instituição de pagamento" no Bacen, com regulação pesada). O dinheiro vai DIRETO para a conta do psicólogo via PIX.

## 2. Objetivo da feature

Gerenciar todos os pagamentos do consultório: registrar valores cobrados, gerar PIX para o paciente pagar diretamente ao psicólogo, controlar saldo (devedores), gerar relatório mensal e dar visibilidade de receita real.

## 3. Escopo

### Dentro do escopo
- Geração de cobrança PIX por sessão
- Link de pagamento para enviar ao paciente via WhatsApp
- Confirmação automática de pagamento (webhook do gateway)
- Confirmação manual (paciente pagou direto na chave PIX, sem usar o link)
- Saldo financeiro por paciente (a receber)
- Política de cobrança (sessão integral, % de falta, isento)
- Pagamento em pacote (pacote de 4 sessões pré-pago)
- Relatório financeiro mensal
- Categorização: receita por modalidade, por paciente, por período
- Inadimplência e cobrança de atraso
- Configuração de chave PIX do psicólogo

### Fora do escopo (versões futuras)
- Cartão de crédito (recorrência, parcelamento) — adicionar em v2 se demanda
- Boleto — pouco útil para B2C psi
- Split de pagamento com clínica que aluga sala (modelo de marketplace) — v2
- Conciliação bancária automática (Open Finance) — v2
- Emissão de NFS-e (separar em PRD próprio se virar core)
- Controle de despesas do consultório (somente entrada no MVP)
- Integração com contador externo

## 4. User stories

- **Como psicóloga**, quero gerar PIX para a Marina pagar a sessão de hoje em um clique.
- **Como psicóloga**, quero saber quem está me devendo agora.
- **Como psicóloga**, quero o paciente pagar direto na minha conta, sem o sistema reter.
- **Como psicóloga**, quero ver quanto faturei em outubro.
- **Como psicóloga**, quero vender pacote de 4 sessões com 5% desconto à vista.
- **Como paciente**, quero receber o PIX por WhatsApp e pagar em 30 segundos.

## 5. Requisitos funcionais

### 5.1. Configuração inicial do psicólogo

**RF-06.01.** Em Configurações > Financeiro, psicólogo informa:
- Chave PIX (CPF, email, telefone, ou aleatória)
- Banco / Instituição (auto-detectado ou manual)
- Nome do beneficiário (default: nome do psicólogo)
- Valor padrão por sessão (R$)
- Aceita pagamento à vista? Pacote? Recorrência?
- Política de cancelamento (texto): dentro de quanto tempo cobra integral, parcial, isento

**RF-06.02.** Sistema integra com gateway que faz **PIX QR Code dinâmico** (Asaas recomendado). Cada cobrança gera um BR Code/QR único.

**RF-06.03.** **Importante:** o gateway repassa diretamente para a conta bancária do psicólogo cadastrada na própria conta do gateway. **O sistema do SaaS não recebe o dinheiro em nenhum momento.**

### 5.2. Política de cobrança

**RF-06.04.** Por psicólogo, default:
- No-show: cobra integral / cobra 50% / não cobra
- Cancelamento >24h: não cobra
- Cancelamento <24h: cobra integral / 50% / não cobra
- Cancelamento <1h: cobra integral

**RF-06.05.** Override por paciente: editar política específica para um paciente (ex: paciente em situação financeira difícil — isento de cancelamento).

### 5.3. Geração de cobrança por sessão

**RF-06.06.** Após sessão criada (PRD 03), valor da sessão é definido (default do paciente ou da configuração).

**RF-06.07.** Quando sessão é marcada como `done` (ou no momento que psicólogo decidir), botão "Gerar cobrança PIX":
- Sistema chama API do gateway, gera QR Code dinâmico com:
  - Valor
  - Descrição: "Sessão [data]"
  - Beneficiário: chave PIX do psicólogo
  - Vencimento: hoje + 7 dias (configurável)
- Salva `payment_id` no banco

**RF-06.08.** Tela mostra QR Code e botões:
- "Copiar PIX Copia e Cola"
- "Enviar via WhatsApp" (template `cobranca_pix` — ver PRD 04)
- "Imprimir QR" (para paciente presencial)

**RF-06.09.** Se sessão `no_show` ou `cancelled <24h` com cobrança aplicável (RF-06.04), gerar cobrança normalmente.

### 5.4. Confirmação de pagamento

**RF-06.10.** Webhook do gateway notifica quando PIX é pago:
- Atualiza `payments.status = 'paid'` e `paid_at`
- Marca sessão como `paid`
- Envia confirmação por WhatsApp ao paciente: "Pagamento de R$ X recebido. Obrigada!"
- Notifica psicólogo (in-app)

**RF-06.11.** Pagamento manual: psicólogo pode marcar sessão como `paid` manualmente (caso paciente tenha pago direto na chave PIX sem usar o link gerado). Registrar:
- Data do pagamento
- Forma (PIX direto / dinheiro / outro)
- Valor (pode ser parcial)

**RF-06.12.** Pagamento parcial: registrar valor pago e saldo restante. Sistema mostra "Pago R$ 100 de R$ 200 — Saldo: R$ 100".

### 5.5. Visualização do saldo por paciente

**RF-06.13.** Na ficha do paciente (PRD 02), aba "Financeiro":
- Saldo total a receber (R$)
- Histórico de cobranças (data sessão, valor, status, data pagamento)
- Botão "Cobrar agora" para cobrança avulsa fora de sessão

**RF-06.14.** Pacientes com saldo devedor são destacados na lista geral de pacientes com badge vermelho.

### 5.6. Pacote de sessões (pré-pago)

**RF-06.15.** Botão "Vender pacote" cria registro:
- Quantidade de sessões (ex: 4)
- Valor total (com possível desconto)
- Vencimento de uso (ex: 90 dias)

**RF-06.16.** Gerar cobrança única do valor total. Após pago, paciente tem "saldo de sessões" decrementado a cada sessão `done`.

**RF-06.17.** Se sessão for cancelada por paciente <24h: decrementa do saldo (cobra falta) ou não, conforme política.

**RF-06.18.** Saldo de sessões é visível no perfil do paciente. Ao acabar, oferecer renovação.

### 5.7. Cobrança avulsa (sem sessão)

**RF-06.19.** Caso especial: psicólogo precisa cobrar algo que não é sessão (ex: laudo R$ 800). Botão "Nova cobrança" pede:
- Paciente
- Descrição
- Valor
- Vencimento

**RF-06.20.** Gera PIX igual fluxo da sessão.

### 5.8. Relatório financeiro mensal

**RF-06.21.** Em `/app/financeiro`, dashboard com:
- Receita do mês atual (acumulada e meta)
- Receita prevista (cobranças pendentes que devem ser pagas)
- Receita do mês anterior (comparativo)
- Gráfico de barras: receita por mês (últimos 12 meses)
- Gráfico de pizza: receita por modalidade (presencial / online)
- Tabela: top 10 pacientes por receita gerada
- Inadimplência: total a receber em atraso

**RF-06.22.** Exportação em CSV/Excel para o contador.

### 5.9. Inadimplência

**RF-06.23.** Cobrança não paga após data de vencimento:
- Marcada como `overdue`
- Sistema oferece "Enviar lembrete de cobrança" (template específico — texto educado, não agressivo)
- Após 30 dias overdue, status `stale`

**RF-06.24.** Lembrete de cobrança automático (opcional, configurável):
- 3 dias antes do vencimento: lembrete suave
- 1 dia após vencimento: lembrete educado
- 7 dias após vencimento: lembrete formal
- 30+ dias: psicólogo decide manualmente (delicado, paciente pode estar em crise)

**RF-06.25.** Configuração para desativar cobrança automática para pacientes específicos (psicólogo julga clinicamente delicado).

### 5.10. Estorno e ajuste

**RF-06.26.** Botão "Estornar pagamento" pede motivo (texto livre); marca como `refunded`. Estorno real é responsabilidade do psicólogo via banco/gateway (sistema só registra o status).

**RF-06.27.** Edição de valor de cobrança já paga é proibida (integridade); permite "ajuste manual" como nova entrada (ex: crédito futuro).

## 6. Requisitos não-funcionais

**RNF-06.01.** Geração de PIX QR Code: <2s.

**RNF-06.02.** Webhook de confirmação processa em <5s, com idempotência.

**RNF-06.03.** Relatório financeiro carrega em <2s para 12 meses de dados.

**RNF-06.04.** Histórico financeiro completo e auditável (nunca apagar registros — append-only).

**RNF-06.05.** Não armazenar dados sensíveis de cartão no banco. PIX não tem esse problema, mas se cartão for adicionado em v2, usar tokenização do gateway (PCI-DSS).

## 7. Regras de negócio

**RN-06.01.** O sistema NUNCA recebe dinheiro do paciente em nome do psicólogo. Pagamento vai sempre direto para conta do psicólogo no gateway.

**RN-06.02.** Sistema cobra do psicólogo apenas pela assinatura SaaS. Taxa do gateway por transação é responsabilidade do psicólogo (transparente).

**RN-06.03.** Status possíveis de pagamento:
- `pending` — gerado, aguardando paciente
- `paid` — confirmado
- `partial` — pago parcialmente
- `overdue` — vencido sem pagamento
- `stale` — >30 dias overdue
- `cancelled` — cobrança cancelada pelo psicólogo
- `refunded` — estornado

**RN-06.04.** Pagamento confirmado é imutável. Para corrigir, criar novo registro de ajuste.

**RN-06.05.** Não é permitido excluir registro de pagamento (LGPD ok, mas integridade fiscal preservada).

**RN-06.06.** Aplicação de cobrança de cancelamento/no-show segue política configurada; não pode contrariar termo de consentimento (que paciente assinou — PRD 02).

**RN-06.07.** Em caso de psicólogo PJ: sistema deve permitir associação de cobrança ao CNPJ; nota fiscal automatizada via integração (RPS) é v2.

## 8. Edge cases

| Caso | Tratamento |
|---|---|
| Paciente paga valor diferente do PIX (R$ 200 em vez de R$ 250) | Marcar como `partial`; saldo de R$ 50 a receber |
| Paciente paga 2x (duplicado) | Webhook detecta; sistema avisa psicólogo; estorno é manual no banco |
| Gateway cai durante geração de PIX | Retry; se falhar, oferecer "gerar manual" com chave PIX simples (sem QR dinâmico) |
| Webhook do gateway perdido | Polling de 1 hora reconcilia status |
| PIX expirado (>7 dias) sem pagamento | Marcar `expired`; permitir gerar nova cobrança |
| Paciente em assistência social isenta | Política específica para o paciente: valor R$ 0 ou apenas registro sem cobrança |
| Mudança de gateway (Asaas → MP) | Manter cobranças antigas no gateway antigo; novas no novo |
| Paciente perdeu o PIX antigo | Botão "Reenviar" gera mensagem WA ou email com mesmo link |
| Cobrança gerada por engano | Cancelar antes de paciente pagar; após pago, processo de estorno manual |
| Pacote de 4 sessões usado em 5 (paciente não viu fim do saldo) | Sistema avisa antes de cada sessão "Saldo: 1 sessão restante"; ao zerar, oferecer renovação |
| Psicólogo sai de férias 2 semanas | Não há ação automática; cobranças geradas seguem com vencimento normal |
| Reembolso parcial (paciente pagou e quer R$ 50 de volta) | Registrar como ajuste; estorno real é manual no banco |
| Imposto retido na fonte (psicólogo PJ presta serviço para empresa) | Permitir configurar campo "valor com retenção" — registrar valor bruto e líquido |

## 9. Critérios de aceitação

- [ ] Configuração de chave PIX em <2 minutos
- [ ] Geração de PIX QR Code em <2s
- [ ] Link de pagamento via WhatsApp aberto pelo paciente mostra QR claro
- [ ] Webhook confirma pagamento e atualiza status corretamente
- [ ] Marcação manual de pagamento funciona (caso paciente pagou fora do link)
- [ ] Pagamento parcial registra saldo restante corretamente
- [ ] Política de no-show aplica cobrança automaticamente
- [ ] Relatório mensal mostra receita real e prevista
- [ ] Comparativo com mês anterior funciona
- [ ] Top 10 pacientes por receita aparece corretamente
- [ ] Pacote de 4 sessões: pagamento único, decremento por sessão usada
- [ ] Lembrete de cobrança envia template suave/formal conforme tempo
- [ ] Estorno marca como `refunded` mas mantém registro
- [ ] CSV exportado abre corretamente em Excel/Google Sheets
- [ ] Integridade: tentativa de excluir pagamento é bloqueada
- [ ] Chave PIX do psicólogo nunca passa pelo sistema (testar fluxo end-to-end)

## 10. Dependências

- Gateway de pagamento: Asaas
- Webhook handler com idempotência
- PRD 02 (paciente) e PRD 03 (sessão) implementados
- PRD 04 (WhatsApp) — envio de cobranças

## 11. Referências regulatórias

- Banco Central — regulação PIX
- Lei 12.865/2013 — institui arranjos de pagamento (sistema NÃO se enquadra como instituição de pagamento por não receber recursos)
- Receita Federal — IN RFB 2.240/2024 (Receita Saúde — ver PRD 07)
- LGPD — dados financeiros do paciente são pessoais (mas não sensíveis no sentido restrito do art. 11)

## Apêndice A — Modelo de dados

```sql
CREATE TABLE financial_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE,
  pix_key VARCHAR(120),
  pix_key_type VARCHAR(20), -- 'cpf', 'email', 'phone', 'random'
  beneficiary_name VARCHAR(120),
  bank_name VARCHAR(120),
  default_session_value DECIMAL(10,2),
  noshow_charge_percent INT DEFAULT 100, -- 0, 50, 100
  cancellation_24h_charge_percent INT DEFAULT 100,
  cancellation_lt24h_charge_percent INT DEFAULT 100,
  cancellation_lt1h_charge_percent INT DEFAULT 100,
  payment_due_days INT DEFAULT 7,
  auto_reminder_enabled BOOLEAN DEFAULT TRUE,
  gateway_provider VARCHAR(30), -- 'asaas', 'mercado_pago'
  gateway_account_id VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  patient_id UUID REFERENCES patients(id) NOT NULL,
  session_id UUID REFERENCES sessions(id), -- NULL se cobrança avulsa
  amount DECIMAL(10,2) NOT NULL,
  amount_paid DECIMAL(10,2) DEFAULT 0,
  description TEXT,
  due_date DATE,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'paid', 'partial', 'overdue', 'stale', 'cancelled', 'refunded', 'expired'
  payment_method VARCHAR(20), -- 'pix', 'cash', 'transfer', 'card_v2'
  pix_qr_code TEXT,
  pix_copy_paste TEXT,
  gateway_id VARCHAR(255),
  gateway_link TEXT,
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE session_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  patient_id UUID REFERENCES patients(id),
  total_sessions INT NOT NULL,
  remaining_sessions INT NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  payment_id UUID REFERENCES payments(id),
  expires_at DATE,
  status VARCHAR(20) DEFAULT 'active', -- 'active', 'completed', 'expired'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payment_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID REFERENCES payments(id),
  amount DECIMAL(10,2) NOT NULL, -- positivo crédito, negativo débito
  reason TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_user_status ON payments(user_id, status);
CREATE INDEX idx_payments_patient ON payments(patient_id, due_date DESC);
CREATE INDEX idx_payments_overdue ON payments(status, due_date) WHERE status IN ('pending', 'partial');
```