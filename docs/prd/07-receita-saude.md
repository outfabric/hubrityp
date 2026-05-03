# PRD 07 — Emissão Receita Saúde

> **Pré-requisitos:** PRD 00, PRD 01, PRD 02, PRD 03, PRD 06.
>
> **Importante:** este é o wedge de validação do produto. A obrigatoriedade da Receita Saúde é o gancho regulatório que faz o psicólogo PROCURAR o sistema. Não pode ter erros aqui.

---

## 1. Contexto e problema

A **Receita Saúde** é uma plataforma da Receita Federal lançada em 2024, obrigatória para profissionais de saúde pessoa física desde **01/01/2025** (Instrução Normativa RFB nº 2.240/2024). Substitui o RPA (Recibo de Prestação Autônoma).

O psicólogo precisa emitir um recibo eletrônico via Receita Saúde **para cada atendimento pago** (PF). Esse recibo:
1. É enviado eletronicamente à Receita Federal
2. Cai no app/portal do paciente (e-CAC)
3. **Pré-preenche automaticamente a declaração de IR do paciente** (despesas dedutíveis com saúde)

**Impactos para o psicólogo:**
- Multa de até 20% do valor declarado por erro ou omissão
- Sem o recibo, paciente não consegue deduzir no IR (cliente fica chateado)
- Emissão manual no portal e-CAC: **5–15 minutos por recibo**, com 30+ pacientes/mês = **3–8 horas por mês perdidas**

**Cronograma legal:**
- Obrigatório desde 01/01/2025
- Prazo de emissão retroativa: até último dia útil de fevereiro do ano seguinte (ADE Cofis nº 11/2025)
- A partir de 2026, integração total com IRPF do paciente — pré-preenchimento

## 2. Objetivo da feature

Permitir que o psicólogo emita Receita Saúde com **um clique** após confirmação de pagamento, eliminando a fricção do portal e-CAC e reduzindo risco de erro fiscal.

## 3. Escopo

### Dentro do escopo
- Configuração da integração com e-CAC (certificado digital ICP-Brasil ou login gov.br)
- Emissão individual após pagamento confirmado
- Emissão em lote (bulk — múltiplas sessões já pagas)
- Validação prévia (CPF do paciente, valor, data)
- Visualização do recibo emitido (espelho oficial)
- Cancelamento/retificação de recibo emitido com erro
- Histórico completo de recibos emitidos
- Alerta de prazos legais (proximidade do fim de fevereiro, etc.)
- Suporte a múltiplos beneficiários (paciente vs. responsável legal)

### Fora do escopo (versões futuras)
- Receita Saúde para pessoa jurídica (psicólogo PJ não emite Receita Saúde — ele emite NFS-e municipal; ver PRD futuro)
- Conciliação automática com declaração IR do psicólogo
- Robô para clientes que ainda não migraram do RPA
- Importação de histórico antigo do e-CAC

## 4. User stories

- **Como psicóloga PF**, quero emitir Receita Saúde em 1 clique após paciente pagar.
- **Como psicóloga**, quero emitir todas as Receitas Saúde do mês de uma vez (lote).
- **Como psicóloga**, quero saber se algum recibo deu erro de validação.
- **Como psicóloga**, quero corrigir um recibo que emiti com valor errado.
- **Como psicóloga**, quero garantia de que não vou perder o prazo de fevereiro.
- **Como paciente**, quero ver no meu app gov.br que minha psicóloga emitiu o recibo.

## 5. Requisitos funcionais

### 5.1. Integração com Receita Saúde (e-CAC)

**RF-07.01.** Em Configurações > Receita Saúde, dois fluxos de autenticação:

**Fluxo A — Certificado Digital ICP-Brasil (e-CPF)**:
- Upload do arquivo .pfx ou .p12
- Senha do certificado
- Sistema armazena criptografado (vault dedicado, NUNCA em código ou logs)
- Valida certificado contra cadeia ICP-Brasil
- Mostra: validade, titular, status

**Fluxo B — Login gov.br nível Ouro**:
- OAuth com gov.br
- Verificar nível de assinatura digital (deve ser Ouro para emissão)
- Token salvo com expiração curta; refresh automático

**RF-07.02.** Apenas psicólogo Pessoa Física pode usar Receita Saúde. Sistema verifica se conta está marcada como PF; se PJ, mostra mensagem instruindo a usar NFS-e (será PRD futuro).

**RF-07.03.** Sistema testa conexão imediatamente após configuração e mostra "Conectado ✅" ou erro detalhado.

### 5.2. Configurações específicas Receita Saúde

**RF-07.04.** Configurações > Receita Saúde:
- Código de serviço (CNAE/Código IRPF para Psicologia: já fixo no código — confirmar com Receita)
- Tipo de profissional: Psicólogo (fixo)
- Município de emissão (autodetectado pelo CRP UF, editável)
- Modelo de descrição padrão (ex: "Atendimento psicológico — sessão de [duração] minutos")
- Incluir CID-10 no recibo? (Não/Opcional/Sempre — Não é o default por sigilo)

### 5.3. Pré-requisitos para emissão

**RF-07.05.** Para emitir Receita Saúde de uma sessão, são obrigatórios:
- CPF do paciente (ou do responsável legal, se menor) — válido (algoritmo)
- Nome completo do beneficiário
- Valor pago (deve ser >0)
- Data de pagamento (deve estar no ano fiscal vigente ou anterior dentro do prazo)
- Descrição do serviço

**RF-07.06.** Se algum dado obrigatório está faltando, sistema bloqueia emissão e mostra checklist do que preencher.

**RF-07.07.** Validação de CPF: algoritmo (dígitos verificadores) + opcional consulta status na Receita (CPF pode estar suspenso/cancelado — alerta).

### 5.4. Emissão individual

**RF-07.08.** Em uma sessão `paid` (PRD 06), botão "Emitir Receita Saúde":
- Pré-preenche dados (paciente, valor, data)
- Permite editar descrição
- Mostra resumo final
- Botão "Emitir" envia para API e-CAC

**RF-07.09.** Após resposta da API:
- **Sucesso**: salva número do recibo, link do PDF oficial, status `issued`. Notifica psicólogo.
- **Erro**: mostra mensagem da Receita (ex: "CPF inválido", "Sistema indisponível"). Permite retry.

**RF-07.10.** Recibo emitido fica visível no perfil do paciente e na sessão correspondente.

### 5.5. Emissão em lote

**RF-07.11.** Em `/app/financeiro/receita-saude`, listar todas as sessões `paid` SEM Receita Saúde emitida:
- Tabela com checkbox
- Botão "Emitir Receita Saúde para selecionadas (N)"
- Antes de emitir, validação prévia (RF-07.05) por sessão; aviso se alguma falha

**RF-07.12.** Emissão em lote é assíncrona (worker):
- Job processa uma sessão por vez (rate limit da API e-CAC)
- Progresso visível: "Emitindo 12 de 30..."
- Ao final, relatório: X com sucesso, Y com erro. Erros listados para retry manual.

**RF-07.13.** Botão "Emitir todos pendentes" (atalho) — útil no fim do mês.

### 5.6. Visualização e download do recibo

**RF-07.14.** Recibo emitido tem registro com:
- Número do recibo (gerado pela Receita)
- Data de emissão
- Status: `issued`, `cancelled`, `error`
- Link para PDF oficial (mantido em cache local)
- Hash de verificação

**RF-07.15.** Botão "Ver recibo" abre PDF (modal ou nova aba).

**RF-07.16.** Botão "Enviar ao paciente via WhatsApp" envia template `recibo_emitido` com link do PDF.

### 5.7. Cancelamento / retificação

**RF-07.17.** Recibo emitido com erro pode ser cancelado/retificado dentro do prazo legal (até final de fev do ano seguinte ao fato).

**RF-07.18.** Fluxo de cancelamento:
- Botão "Cancelar/Retificar" pede motivo (texto)
- Chama API e-CAC para cancelar
- Após sucesso, status `cancelled`. Sessão volta a poder emitir novo recibo.

**RF-07.19.** Histórico mantém todos os recibos emitidos, mesmo cancelados (auditoria fiscal).

### 5.8. Alertas e prazos

**RF-07.20.** Notificações automáticas:
- Banner no dashboard se há sessões pagas sem recibo emitido (>30 dias) — "Você tem N recibos pendentes"
- Alerta crítico em fevereiro: "Prazo final para emitir recibos de [ano anterior] é [data]"
- Lembrete por email semanal se há acumulado >10 recibos pendentes

**RF-07.21.** Bloquear/avisar se sessão paga há mais de 60 dias sem Receita Saúde — chance de esquecer aumenta.

### 5.9. Histórico

**RF-07.22.** Em `/app/financeiro/receita-saude/historico`:
- Filtros: ano, mês, paciente, status
- Tabela: data, paciente, valor, número do recibo, status, ações
- Total emitido no período (para conferência)
- Exportação CSV/Excel

**RF-07.23.** Comparativo com declaração IR do psicólogo (no fim do ano): total emitido vs total declarado pelo psicólogo no Carnê-Leão. Útil para auditoria pessoal.

### 5.10. Suporte a paciente menor de idade

**RF-07.24.** Se paciente é menor de idade (PRD 02), Receita Saúde pode ser emitida em nome:
- Do paciente (CPF do menor, se existir) — recomendado se já tem CPF
- Do responsável legal que pagou (CPF do responsável)

**RF-07.25.** Configuração padrão na ficha do paciente menor: qual CPF usar. Pode ser alterado por sessão.

## 6. Requisitos não-funcionais

**RNF-07.01.** Latência de emissão individual: <10s end-to-end (depende da API Receita).

**RNF-07.02.** Emissão em lote: 1 sessão / segundo (respeitar rate limit da API).

**RNF-07.03.** Confiabilidade: 99% de sucesso em emissão (excluir falhas de API externa).

**RNF-07.04.** Retry inteligente: erros transitórios (timeout, 5xx) tentam até 3x; erros de validação (4xx) NÃO tentam novamente, mostram mensagem clara.

**RNF-07.05.** Logs de cada chamada API (request + response) por 5 anos para defesa em caso de fiscalização.

**RNF-07.06.** Certificado digital armazenado em vault criptografado (nunca em variável de ambiente plaintext, nunca em logs).

## 7. Regras de negócio

**RN-07.01.** Apenas usuário PF pode emitir Receita Saúde. Conta marcada como PJ é orientada a NFS-e municipal.

**RN-07.02.** Receita Saúde só emite após pagamento confirmado (status `paid`, parcial OK desde que o valor seja >0).

**RN-07.03.** Valor da Receita Saúde = valor pago, mesmo se for parcial. Se houver pagamento adicional posterior, emitir nova Receita Saúde para o saldo (ou retificar — depende do fluxo aprovado pela Receita).

**RN-07.04.** Se sessão tem múltiplos pagamentos parciais, é mais simples emitir uma Receita Saúde no fim, com soma. Sistema oferece "Emitir Receita Saúde do total acumulado" quando sessão está totalmente paga.

**RN-07.05.** **Conflito ético — CID-10:** Receita Saúde permite incluir CID-10. CFP recomenda discrição (sigilo). Default do sistema: NÃO incluir CID-10. Psicólogo pode habilitar caso a caso, com confirmação extra.

**RN-07.06.** Recibo emitido erroneamente deve ser cancelado, não apenas substituído. Sistema impõe esse fluxo.

**RN-07.07.** Backup local do PDF oficial: além do link da Receita, manter cópia no Storage privado (caso a Receita perca o documento — improvável, mas auditoria recomenda).

**RN-07.08.** Em caso de processo do paciente contra o psicólogo, recibos emitidos são prova legal — integridade do registro é crítica.

## 8. Edge cases

| Caso | Tratamento |
|---|---|
| API e-CAC fora do ar | Retry com backoff; após 3 falhas, marcar como `pending_retry` e notificar psicólogo. Tentar novamente automaticamente em 1h |
| CPF do paciente cadastrado errado | Validação preventiva detecta na maioria dos casos. Receita rejeita: erro claro com instrução de corrigir |
| Paciente sem CPF (estrangeiro) | Receita Saúde NÃO aceita. Sistema avisa e oferece emitir RPA simples (texto) como fallback ou orientar paciente a obter CPF |
| Paciente menor sem CPF | Usar CPF do responsável; configurar na ficha do paciente |
| Pagamento antes de cadastro de CPF | Bloquear emissão; pedir CPF |
| Múltiplas sessões mesmo dia, mesmo paciente | Emitir 1 recibo por sessão (cada com data e descrição) — não somar |
| Pagamento por terceiro (avó pagou para o neto) | Receita Saúde usa CPF do beneficiário (paciente), não de quem pagou |
| Paciente reembolsa convênio: o convênio ressarciu, mas o psi recebeu integral | Receita Saúde reflete o valor cheio (pago pelo paciente direto). Reembolso é entre paciente e plano |
| Sessão em janeiro do ano seguinte ao pagamento | Receita Saúde usa data do pagamento, não da sessão (regime de caixa). Atenção a transições de ano fiscal |
| Estorno de pagamento já com Receita Saúde emitida | Cancelar recibo na Receita; refletir no sistema |
| Certificado ICP-Brasil expirado | Notificar 30 dias antes; bloquear emissão se expirar |
| Mudança de regime PF → PJ | Encerrar Receita Saúde; orientar migração para NFS-e |
| Receita Saúde em manutenção 48h | Sistema mostra status oficial (verificar API de saúde da Receita); enfileira emissões para quando voltar |

## 9. Critérios de aceitação

- [ ] Configuração de e-CPF ICP-Brasil funciona (testar com certificado real ou de homologação)
- [ ] Configuração via gov.br funciona (testar com conta nível Ouro)
- [ ] Validação de CPF rejeita CPFs inválidos antes de chamar API
- [ ] Emissão individual <10s (testar end-to-end)
- [ ] Emissão em lote de 30 recibos completa em <2 min
- [ ] Recibo emitido aparece no e-CAC do paciente (testar com CPF de teste)
- [ ] Cancelamento de recibo emitido funciona dentro do prazo
- [ ] Banner de pendências aparece com >0 sessões pagas sem recibo
- [ ] Lembrete de prazo de fevereiro aparece em janeiro
- [ ] Histórico exporta CSV correto para conferência com IR
- [ ] CID-10 default OFF; ativável caso a caso com aviso
- [ ] Falha de API e-CAC permite retry; logs preservados
- [ ] Recibo PDF é armazenado localmente como backup
- [ ] Conta PJ é bloqueada de usar Receita Saúde com mensagem clara

## 10. Dependências

- API Receita Saúde (e-CAC) — documentação oficial da Receita Federal
- Vault para certificados: Supabase Vault
- Lib de validação CPF: `cpf-cnpj-validator`
- PRD 02 (paciente — CPF), PRD 03 (sessão), PRD 06 (pagamento confirmado)

## 11. Referências regulatórias

- **Instrução Normativa RFB nº 2.240/2024** — institui Receita Saúde como obrigatória
- **ADE Cofis nº 11/2025** — fixa prazo de emissão retroativa
- **Lei 12.865/2013** — atos eletrônicos da Receita
- **Código Tributário Nacional** — multa por erro/omissão
- **Resolução CFP** sobre sigilo (referência indireta para decisão de incluir CID-10)
- **MP 2.200-2/2001** — validade de assinatura digital ICP-Brasil

## 12. Considerações operacionais

- Documentação técnica oficial: https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/receita-saude

## Apêndice A — Modelo de dados

```sql
CREATE TABLE receita_saude_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE,
  auth_method VARCHAR(30), -- 'icp_brasil', 'gov_br'
  certificate_vault_id VARCHAR(255), -- referência ao certificado em vault
  certificate_expires_at DATE,
  gov_br_token_encrypted TEXT,
  gov_br_token_expires_at TIMESTAMPTZ,
  service_description_template TEXT,
  include_cid10_default BOOLEAN DEFAULT FALSE,
  is_pf BOOLEAN DEFAULT TRUE,
  configured_at TIMESTAMPTZ,
  last_health_check_at TIMESTAMPTZ
);

CREATE TABLE receita_saude_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  patient_id UUID REFERENCES patients(id) NOT NULL,
  session_id UUID REFERENCES sessions(id),
  payment_id UUID REFERENCES payments(id),
  beneficiary_cpf VARCHAR(14) NOT NULL,
  beneficiary_name VARCHAR(120) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_date DATE NOT NULL,
  service_description TEXT NOT NULL,
  cid10_code VARCHAR(10),
  receipt_number VARCHAR(50), -- número gerado pela Receita
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'issued', 'cancelled', 'error'
  pdf_url_official TEXT, -- link Receita
  pdf_url_backup TEXT, -- nosso backup
  hash_verification VARCHAR(255),
  api_request_log JSONB,
  api_response_log JSONB,
  error_message TEXT,
  retry_count INT DEFAULT 0,
  issued_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rs_records_user_status ON receita_saude_records(user_id, status);
CREATE INDEX idx_rs_records_session ON receita_saude_records(session_id);
CREATE INDEX idx_rs_records_pending ON receita_saude_records(user_id, payment_date) 
  WHERE status = 'pending';
```