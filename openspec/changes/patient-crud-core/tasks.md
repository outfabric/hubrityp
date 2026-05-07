## 1. Database Schema & Migration

- [x] 1.1 Criar Drizzle schema `src/shared/db/schema/patients/tables.ts` com tabela `patients` (todas as colunas: id, user_id, full_name, patient_type, birth_date, approximate_age, gender, phone, email, cpf, address, profession, marital_status, source, tags, photo_path, notes, status, consent_signed_at, consent_revoked_at, couple_id, created_at, updated_at, archived_at)
- [x] 1.2 Criar `src/shared/db/schema/patients/policies.ts` com RLS policies owner-scoped (SELECT, INSERT, UPDATE, DELETE via `auth.uid() = user_id`)
- [x] 1.3 Atualizar barrel `src/shared/db/schema/index.ts` para reexportar `./patients/tables`
- [x] 1.4 Rodar `npm run db:generate` para gerar migration SQL
- [x] 1.5 Editar migration gerada para adicionar: `CREATE EXTENSION IF NOT EXISTS unaccent`, RLS policies (do policies.ts), partial unique index em `(user_id, email) WHERE email IS NOT NULL`, índice GIN em `to_tsvector('portuguese', full_name)`, compound index em `(user_id, status)`
- [x] 1.6 Testar migration com `npm run db:migrate` em ambiente local (docker compose up)
- [x] 1.7 **Teste de integração:** Criar `src/__tests__/integration/patients/patient-schema.int.test.ts` — verificar que a tabela patients existe, RLS está habilitado, policies existem, índices existem, e que a policy-coverage do projeto continua passando

## 2. Validators & Types

- [x] 2.1 Instalar dependência `cpf-cnpj-validator` (`npm install cpf-cnpj-validator`)
- [x] 2.2 Criar `src/modules/patients/lib/patient-validators.ts` com funções de validação: `isValidBrazilianPhone(phone: string)`, `isValidCpf(cpf: string)`, `formatPhone(phone: string)`
- [x] 2.3 Criar `src/modules/patients/lib/patient-input-schema.ts` com Zod schemas: `createPatientSchema` (step 1 + step 2 fields), `updatePatientSchema` (partial), `listPatientsQuerySchema` (page, status, search, tags, sort, order)
- [x] 2.4 Criar `src/modules/patients/lib/patient-types.ts` com tipos TypeScript do domínio: `PatientStatus`, `PatientType`, tipos de input/output
- [x] 2.5 **Testes unitários:** Criar `src/__tests__/unit/modules/patients/lib/patient-validators.test.ts` — testar validação de telefone BR (formatos válidos/inválidos), CPF (válidos/inválidos incluindo edge cases como 000.000.000-00)
- [x] 2.6 **Testes unitários:** Criar `src/__tests__/unit/modules/patients/lib/patient-input-schema.test.ts` — testar createPatientSchema (campos obrigatórios, opcionais, rejeição de formatos inválidos), updatePatientSchema (parcialidade), listPatientsQuerySchema (defaults, validação de page/sort)

## 3. Server Actions — CRUD

- [x] 3.1 Criar `src/modules/patients/server/create-patient.ts` — Server Action que valida input (createPatientSchema), verifica duplicata (phone e email), insere no banco via Drizzle, retorna patient ID. Tratar unique constraint violation com mensagem user-friendly
- [x] 3.2 Criar `src/modules/patients/server/get-patient.ts` — Server Action que busca paciente por ID via Drizzle (RLS garante ownership)
- [x] 3.3 Criar `src/modules/patients/server/update-patient.ts` — Server Action que valida input (updatePatientSchema), verifica duplicata em update, atualiza via Drizzle com `updated_at=now()`
- [x] 3.4 **Testes de integração:** Criar `src/__tests__/integration/patients/patient-crud.int.test.ts` — testar createPatient (sucesso, duplicata phone, duplicata email, campos inválidos), getPatient (own vs. other user), updatePatient (sucesso, duplicata em update, patient de outro user)

## 4. Server Actions — Archive & Delete

- [x] 4.1 Criar `src/modules/patients/server/archive-patient.ts` — Server Action com `archivePatientImpl` (set status=archived, archived_at=now) e `unarchivePatientImpl` (set status=active, archived_at=null)
- [x] 4.2 Criar `src/modules/patients/server/delete-patient.ts` — Server Action que verifica ausência de sessões/anamnese/consent antes de permitir hard delete
- [x] 4.3 **Testes de integração:** Criar `src/__tests__/integration/patients/patient-archive.int.test.ts` — testar archive (sucesso, preserva dados), unarchive (sucesso, limpa archived_at), delete (paciente sem registros OK, paciente com registros bloqueado)

## 5. Server Actions — Listing & Search

- [x] 5.1 Criar `src/modules/patients/server/list-patients.ts` — Server Action que aceita query params (page, status, search, tags, sort, order), aplica filtros via Drizzle (ILIKE com unaccent para busca, @> para tags, WHERE status para filtro), pagina com LIMIT/OFFSET, retorna {patients, total, page, pageSize}
- [x] 5.2 **Testes de integração:** Criar `src/__tests__/integration/patients/patient-listing.int.test.ts` — testar listagem (default, filtro por status, busca por nome parcial, busca por telefone, filtro por tags, paginação, ordenação, combinação de filtros)

## 6. Server Actions — Photo Upload

- [x] 6.1 Criar `src/modules/patients/server/upload-patient-photo.ts` — Server Action que valida file type (JPEG, PNG, WebP) e size (<2MB), faz upload para bucket `patient-photos` via Supabase Storage client, atualiza patient.photo_path
- [x] 6.2 Criar `src/modules/patients/server/get-patient-photo-url.ts` — Server Action que gera signed URL (5min expiration) para patient.photo_path
- [x] 6.3 **Testes unitários:** Criar `src/__tests__/unit/modules/patients/server/upload-patient-photo.test.ts` — testar validação de tipo e tamanho de arquivo (mock Supabase Storage)

## 7. Module Barrel & Route Shells

- [x] 7.1 Criar `src/modules/patients/index.ts` — barrel reexportando: Server Actions (createPatient, getPatient, updatePatient, archivePatient, unarchivePatient, deletePatient, listPatients, uploadPatientPhoto, getPatientPhotoUrl), Zod schemas, types, e componentes
- [x] 7.2 Criar `src/app/(app)/pacientes/actions.ts` com diretiva `'use server'` — delegar para módulo (padrão route shell)
- [x] 7.3 Criar route shell `src/app/(app)/pacientes/[id]/actions.ts` com `'use server'`

## 8. Frontend — Patient Listing Page

> **Design System Sálvia** (`docs/design-system/rules.md`): seguir obrigatoriamente.

- [x] 8.1 Criar componente `src/modules/patients/components/patient-list.tsx` (Client Component) — **Seguir design system:** usar shadcn `Table` (header bg `surface-muted`, text `secondary`, 11px uppercase; hover bg `surface-muted`; mobile → cards stackados via breakpoint md:768px). Avatar com fallback iniciais (bg `brand-100`, text `brand-700`, radius-full). Status badge: `success` variante (Ativo), `neutral` (Arquivado). Tags como `Badge` neutral. Ícone `Search` no input de busca, `SlidersHorizontal` para filtros. Botão "+ Novo Paciente" como `Button primary` com ícone `Plus`. Paginação com botões `secondary`. Empty state com ícone `Users` tertiary + h4 + descrição + CTA. Busca com debounce no input, filtro de status (segmented control), filtro de tags (multi-select), ordenação (column headers clicáveis), paginação (prev/next, page numbers, total count). State sincronizado com URL search params
- [x] 8.2 Criar Server Component `src/app/(app)/pacientes/page.tsx` — título h1 "Pacientes" (28px/600), lê search params, chama listPatients, passa dados para PatientList
- [x] 8.3 **Teste E2E:** Criar `src/__tests__/e2e/seeded/patients/patient-listing.spec.ts` — verificar que listagem renderiza pacientes, busca por nome funciona, filtro por status funciona, paginação funciona, botão "+ Novo Paciente" existe

## 9. Frontend — Patient Creation Form

> **Design System Sálvia**: página dedicada (não modal — wizard multi-passo). Validação em **blur**. Máscaras BR. Erros inline com `AlertCircle`.

- [ ] 9.1 Criar componente `src/modules/patients/components/patient-form.tsx` (Client Component) — formulário em 2 etapas com react-hook-form + Zod resolver. **Design system:** inputs com shadcn `Input` (bg `surface-sunken`, focus border `brand-500` + `shadow-focus`). Validação em **blur** (não onChange). Erros inline: ícone `AlertCircle` + mensagem em `danger-700`. Máscaras BR: telefone `+55 (DD) NNNNN-NNNN`, CPF `XXX.XXX.XXX-XX`. Labels sempre com `for`/`id`. Gap label→input `space-2`. Botão "Salvar" como `Button primary` com loading state obrigatório. "Próximo"/"Pular" como `Button secondary`/`ghost`. Step 1: full_name, patient_type (select), birth_date (shadcn Calendar) ou approximate_age, phone (masked). Step 2: gender, email, cpf (masked), address fields, profession, marital_status, source, tags (multi-select criável), photo (upload dropzone max 2MB), notes (textarea). Mobile: form em coluna única. Erros humanos: "Telefone inválido. Use o formato (11) 98765-4321."
- [ ] 9.2 Criar Server Component `src/app/(app)/pacientes/novo/page.tsx` — título h1 "Novo paciente", renderiza PatientForm em modo criação
- [ ] 9.3 **Teste E2E:** Criar `src/__tests__/e2e/seeded/patients/patient-create.spec.ts` — fluxo completo de criação de paciente adulto (preencher step 1, avançar, pular step 2, verificar redirect para detalhe, verificar paciente na listagem)

## 10. Frontend — Patient Detail Page

> **Design System Sálvia**: Avatar (`radius-full`, tamanho lg 56px), Tabs underline, Badge semântico, ícones do mapa fixo.

- [ ] 10.1 Criar componente `src/modules/patients/components/patient-detail-header.tsx` — **Design system:** Avatar lg (56px, fallback iniciais bg `brand-100` text `brand-700`). Nome em h1 (28px/600). Idade em body-sm `text-secondary`. Status badge: `success` (Ativo) / `neutral` (Arquivado). Tags como `Badge neutral`. Botão WhatsApp: `Button ghost` com ícone `MessageCircle` + "Abrir no WhatsApp". Botão copiar email: `Button ghost` com tooltip. Menu ações: shadcn `DropdownMenu` trigger `MoreHorizontal`
- [ ] 10.2 Criar componente `src/modules/patients/components/patient-tabs.tsx` — shadcn `Tabs` underline style (tab ativa: text `primary`, border-bottom 2px `brand-500`; idle: text `secondary`; padding `space-3 space-4`). Tabs: "Visão geral" (ativo), demais como placeholder com ícone + "Em breve" em `text-tertiary`
- [ ] 10.3 Criar componente `src/modules/patients/components/patient-overview-tab.tsx` — layout em card `default` (bg `surface`, border, radius `xl`, shadow `xs`, padding `space-6`). Dados em grid 2-col desktop / 1-col mobile. CPF mascarado como "***.***.***-XX". Labels em caption-upper (12px/500/uppercase/tracking). Valores em body (15px/400)
- [ ] 10.4 Criar Server Component `src/app/(app)/pacientes/[id]/page.tsx` — carrega paciente, gera signed URL da foto, renderiza header + tabs
- [ ] 10.5 **Teste E2E:** Criar `src/__tests__/e2e/seeded/patients/patient-detail.spec.ts` — verificar que cabeçalho mostra nome/telefone/tags, tab "Visão geral" mostra dados, botão WhatsApp tem href correto, tabs placeholder mostram "Em breve"

## 11. Frontend — Patient Edit & Actions

> **Design System Sálvia**: Modal para confirmações (max-width 480px, radius `2xl`, shadow `lg`). Toast Sonner. Confirmação destrutiva com input digitado.

- [ ] 11.1 Criar Server Component `src/app/(app)/pacientes/[id]/editar/page.tsx` — título h1 "Editar paciente", carrega paciente, renderiza PatientForm em modo edição (pré-preenchido). Toast success "Paciente atualizado" ao salvar (Sonner, border-left 4px `success-500`, auto-dismiss 4s)
- [ ] 11.2 Criar componente `src/modules/patients/components/archive-confirm-modal.tsx` — shadcn `AlertDialog` (max-width 480px, padding `space-8`, radius `2xl`). Título h3. Texto de fundamentação legal (CFP/Lei 13.787). Botão "Arquivar" como `Button primary`, "Cancelar" como `Button secondary`. Escape/click-fora fecha
- [ ] 11.3 Criar componente `src/modules/patients/components/delete-confirm-modal.tsx` — shadcn `AlertDialog`. Input de senha + campo de texto onde o usuário digita "EXCLUIR DEFINITIVAMENTE" para confirmar. Botão "Excluir definitivamente" como `Button danger` com ícone `Trash2`, desabilitado até input correto. Mensagem humana: "Esta ação é irreversível"
- [ ] 11.4 Adicionar menu de ações (dropdown) no header do detalhe: shadcn `DropdownMenu` com trigger ícone `MoreHorizontal`. Itens: `Pencil` Editar, `Archive` Arquivar/Desarquivar, `Trash2` Excluir (condicional, text `danger-700`)
- [ ] 11.5 **Teste E2E:** Criar `src/__tests__/e2e/seeded/patients/patient-edit-archive.spec.ts` — testar edição (alterar nome, verificar toast success), arquivamento (confirmar modal, verificar que paciente sai da lista default), desarquivamento
