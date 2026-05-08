## Context

A change `patient-crud-core` estabelece a tabela `patients` e o módulo de pacientes. Esta change estende o modelo para menores de idade (com responsáveis legais) e casais (dois pacientes vinculados). Ambos são variações do fluxo de cadastro que afetam formulário, validação e detalhes.

## Goals / Non-Goals

**Goals:**
- Tabela `patient_guardians` com RLS baseado em JOIN com patients
- Coluna `couple_id` auto-referencial em patients
- Formulário condicional por patient_type
- Regra de menores de 12: comunicação direcionada a responsáveis

**Non-Goals:**
- Template de comunicação WhatsApp para responsáveis (depende de PRD sobre lembretes)
- Sessões conjuntas de casal (depende de PRD 03 — Agenda)

## Decisions

### 1. Tabela `patient_guardians` com RLS via subquery

RLS de `patient_guardians` não pode usar `auth.uid() = user_id` diretamente porque a tabela não tem `user_id`. A policy usará subquery: `patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid())`.

**Alternativa considerada:** Adicionar `user_id` redundante em `patient_guardians` — rejeitada por desnormalização que exigiria manutenção em cascata.

### 2. `couple_id` como UUID auto-referencial

Ambos os pacientes do casal compartilham o mesmo `couple_id` (UUID gerado no momento da criação). Não é uma FK para outra tabela — é apenas um valor compartilhado. Para encontrar o parceiro: `SELECT * FROM patients WHERE couple_id = :id AND id != :current_patient_id`.

### 3. Criação de casal como transação atômica

A Server Action `createCouplePatient` criará ambos os pacientes na mesma transação Drizzle. Se a criação do segundo falhar (ex: duplicata de telefone), ambos são revertidos.

### 4. Formulário condicional no frontend

O componente `patient-form.tsx` da change anterior será estendido com seções condicionais baseadas no valor de `patient_type`. Quando "child"/"adolescent" é selecionado, campos de guardian aparecem. Quando "couple", campos do parceiro aparecem. Usar react-hook-form `watch` para reatividade.

## Frontend — Design System Sálvia (`docs/design-system/rules.md`)

Todas as telas adicionadas/estendidas DEVEM seguir o design system Sálvia.

### Formulário condicional (guardians)
- Seção de guardians aparece dentro do `patient-form.tsx` quando patient_type="child"/"adolescent"
- Usar shadcn `Card flat` para agrupar cada guardian (bg `surface`, border, radius `xl`, sem shadow)
- Botão "Adicionar responsável" como `Button ghost` com ícone `Plus` (desabilitado se já existem 2)
- Labels em caption-upper, inputs com validação em blur, máscaras BR
- Warning ao remover último guardian: shadcn `Alert` variante `warning` (bg `warning-50`, text `warning-700`, ícone `AlertTriangle`)

### Formulário condicional (casal)
- Seção de dados do parceiro(a) quando patient_type="couple"
- Usar `Card flat` separado com título h4 "Parceiro(a)"

### Indicador de casal na listagem
- Badge `info` (bg `info-50`, text `info-700`) com texto "Casal" ao lado do nome na listagem

### Seção de guardians no detalhe
- Dentro do overview tab, card com título h4 "Responsáveis"
- Cada guardian como row com nome, parentesco, telefone, badge `brand` se primary
- Botões `ghost` com ícones `Pencil`/`Trash2`

### Seção de parceiro no detalhe
- Card com título h4 "Parceiro(a)", nome como link `Button link` (text `brand-700`)
- Botão "Desvincular casal" como `Button ghost` com ícone, confirmação via `AlertDialog`

## Risks / Trade-offs

- **[RLS via subquery em guardians]** → Pode ser mais lento que um check direto. Para o volume esperado (<100 guardians por psicólogo), é insignificante.
- **[couple_id sem constraint foreign key]** → Risco de inconsistência (um paciente com couple_id apontando para nada). Mitigation: a Server Action de unlink limpa ambos os lados na mesma transação.
