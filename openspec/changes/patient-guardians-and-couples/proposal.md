## Why

Psicólogos atendem menores de idade (que exigem responsáveis legais para comunicação e consentimento) e casais (com prontuários separados mas vinculados). Esses são fluxos de cadastro específicos que dependem do CRUD base de pacientes já existir.

## What Changes

- Nova tabela `patient_guardians` para responsáveis legais de menores
- Campo `couple_id` na tabela `patients` para vincular dois pacientes que são casal
- Formulário condicional: ao selecionar tipo "Criança" ou "Adolescente", exibe campos de responsável (até 2 responsáveis)
- Formulário condicional: ao selecionar tipo "Casal", exibe campos para cadastro do parceiro/parceira vinculado
- Server Actions: addGuardian, updateGuardian, removeGuardian, linkCouple, unlinkCouple
- Regra de negócio: menores de 12 anos — comunicação direcionada aos responsáveis (RN-02.04)
- Regra de negócio: casal — prontuários separados, sessões podem ser conjuntas ou individuais (RN-02.07)

## Capabilities

### New Capabilities
- `patient-guardians`: CRUD de responsáveis legais vinculados a pacientes menores, com campos obrigatórios (nome, parentesco, telefone) e opcionais (CPF, email), limite de 2 responsáveis por paciente
- `patient-couples`: Vinculação de dois pacientes como casal via `couple_id`, com fluxo de criação conjunta e possibilidade de desvincular

### Modified Capabilities
- `patient-crud`: O formulário de criação/edição ganha seções condicionais baseadas no `patient_type` (minor → guardians, couple → partner)

## Impact

- **Banco de dados:** Nova migration adicionando tabela `patient_guardians` com RLS, e alteração em `patients` (coluna `couple_id` auto-referencial)
- **Drizzle schema:** Atualiza `src/shared/db/schema/patients/tables.ts` com nova tabela e relação
- **Módulo pacientes:** Novos server actions e validators para guardians e couples
- **Frontend:** Formulário condicional no create/edit, seção "Responsáveis" no detalhe do paciente menor, indicação visual de casal na listagem
