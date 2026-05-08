## Why

O psicólogo precisa de um cadastro centralizado de pacientes como ponto de partida para todas as funcionalidades clínicas e administrativas do sistema (agenda, prontuário, cobrança). Hoje esses dados vivem em WhatsApp, planilhas e cadernos — o CRUD de pacientes é a fundação sobre a qual os PRDs 03–11 se apoiam.

## What Changes

- Nova tabela `patients` com RLS owner-scoped (`user_id` = psicólogo logado)
- Novo módulo `src/modules/patients/` com Server Actions: createPatient, listPatients, getPatient, updatePatient, archivePatient, unarchivePatient
- Validators Zod para criação/edição (incluindo validação de telefone BR, CPF, email)
- Nova rota `/app/pacientes` com listagem paginada (25/página), busca por nome/telefone/email, filtros (status, tags), ordenação por coluna
- Nova rota `/app/pacientes/novo` ou modal de criação com formulário em 2 etapas (dados básicos + complementares)
- Nova rota `/app/pacientes/:id` com página de detalhes (cabeçalho + tab "Visão geral")
- Edição de paciente (inline ou página dedicada)
- Arquivamento/desarquivamento com modal de confirmação e fundamentação legal
- Proteção contra duplicatas (unique constraint em user_id+phone e user_id+email)
- Foto do paciente via Supabase Storage (bucket privado, URL assinada 5min)
- Índices para performance: GIN full-text search em `full_name`, compound index em `(user_id, status)`

## Capabilities

### New Capabilities
- `patient-crud`: CRUD completo de pacientes (create, list, get, update, archive/unarchive), validação de campos, proteção contra duplicatas, upload de foto, e regras de negócio para exclusão (soft-delete obrigatório, hard-delete apenas sem sessões)
- `patient-listing`: Listagem de pacientes com busca full-text, filtros (status, tags), ordenação multi-coluna, paginação server-side
- `patient-detail`: Página de detalhes do paciente com cabeçalho (foto, nome, idade, contatos, tags, status) e estrutura de tabs para módulos futuros

### Modified Capabilities
<!-- Nenhuma capability existente é modificada — este é um domínio novo -->

## Impact

- **Banco de dados:** Nova migration criando tabela `patients` com RLS, índices GIN e compound
- **Drizzle schema:** Novo domínio `src/shared/db/schema/patients/` (tables.ts + policies.ts)
- **Módulo novo:** `src/modules/patients/` com server/, lib/, components/, index.ts
- **Rotas novas:** `src/app/(app)/pacientes/` (page, [id]/page, novo/page ou modal)
- **Supabase Storage:** Novo bucket `patient-photos` (privado)
- **Dependências:** `cpf-cnpj-validator` (validação de CPF)
- **Middleware:** Nenhuma alteração — já protege rotas (app) para profiles com status `active`
