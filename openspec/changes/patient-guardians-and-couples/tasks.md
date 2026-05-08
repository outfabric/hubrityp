## 1. Database Schema — Guardians

- [x] 1.1 Adicionar tabela `patient_guardians` em `src/shared/db/schema/patients/tables.ts` (colunas: id, patient_id FK, full_name, relationship, cpf, phone, email, is_primary, created_at)
- [x] 1.2 Adicionar RLS policies para `patient_guardians` em `src/shared/db/schema/patients/policies.ts` — policy via subquery: `patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid())`
- [x] 1.3 Rodar `npm run db:generate`, editar migration para incluir RLS policies, FK constraint para patients(id) com ON DELETE CASCADE
- [x] 1.4 Testar migration com `npm run db:migrate` local
- [x] 1.5 **Teste de integração:** Criar `src/__tests__/integration/patients/patient-guardians-schema.int.test.ts` — verificar tabela existe, RLS habilitado, policies existem, FK cascade funciona

## 2. Database Schema — Couple ID

- [x] 2.1 Adicionar coluna `couple_id UUID` na tabela `patients` em `src/shared/db/schema/patients/tables.ts` (se não existir — pode já ter sido adicionada no patient-crud-core como placeholder)
- [x] 2.2 Gerar e aplicar migration para a nova coluna

## 3. Validators & Types — Guardians

- [x] 3.1 Criar `src/modules/patients/lib/guardian-input-schema.ts` com Zod schemas: `createGuardianSchema` (full_name required, relationship required, phone required, cpf optional, email optional), `updateGuardianSchema` (partial)
- [x] 3.2 **Testes unitários:** Criar `src/__tests__/unit/modules/patients/lib/guardian-input-schema.test.ts` — testar validação de campos obrigatórios, CPF opcional, limite de 2 guardians

## 4. Server Actions — Guardians

- [ ] 4.1 Criar `src/modules/patients/server/add-guardian.ts` — valida input, verifica que patient é menor, verifica limite de 2, insere guardian. Se é o primeiro, marca is_primary=true
- [ ] 4.2 Criar `src/modules/patients/server/update-guardian.ts` — valida input, atualiza guardian via Drizzle
- [ ] 4.3 Criar `src/modules/patients/server/remove-guardian.ts` — remove guardian, se era primary e existe outro, promove o restante a primary. Se era o último, mostra warning
- [ ] 4.4 Criar `src/modules/patients/server/list-guardians.ts` — lista guardians de um paciente
- [ ] 4.5 **Testes de integração:** Criar `src/__tests__/integration/patients/patient-guardians-crud.int.test.ts` — testar add (sucesso, limite 2, auto-primary), update, remove (promoção, warning), RLS (cross-user bloqueado)

## 5. Server Actions — Couples

- [ ] 5.1 Criar `src/modules/patients/server/create-couple-patient.ts` — transação atômica: gera couple_id, cria 2 patients com mesmo couple_id e patient_type="couple"
- [ ] 5.2 Criar `src/modules/patients/server/unlink-couple.ts` — transação: limpa couple_id e muda patient_type para "adult" em ambos os pacientes
- [ ] 5.3 Criar `src/modules/patients/server/get-couple-partner.ts` — dado um patient com couple_id, retorna o outro patient com mesmo couple_id
- [ ] 5.4 **Testes de integração:** Criar `src/__tests__/integration/patients/patient-couples.int.test.ts` — testar criação de casal (2 records, mesmo couple_id), unlink (ambos ficam adult, couple_id null), get partner (retorna correto)

## 6. Module Barrel Update

- [ ] 6.1 Atualizar `src/modules/patients/index.ts` para reexportar: addGuardian, updateGuardian, removeGuardian, listGuardians, createCouplePatient, unlinkCouple, getCouplePartner, guardian schemas e types

## 7. Frontend — Conditional Form Sections

> **Design System Sálvia** (`docs/design-system/rules.md`): Card flat para guardians, inputs com validação blur, máscaras BR, ícones Lucide do mapa fixo.

- [ ] 7.1 Estender `patient-form.tsx`: quando patient_type="child" ou "adolescent", mostrar seção de guardians. **Design system:** cada guardian em shadcn `Card flat` (bg `surface`, border, radius `xl`, padding `space-6`). Título h4 "Responsável 1" / "Responsável 2". Campos com shadcn `Input` (validação blur, erro inline `AlertCircle` + `danger-700`). Máscara CPF e telefone BR. Botão "Adicionar responsável" como `Button ghost` + ícone `Plus` (disabled se 2). Usar react-hook-form `useFieldArray`
- [ ] 7.2 Estender `patient-form.tsx`: quando patient_type="couple", mostrar seção do parceiro(a). **Design system:** `Card flat` com título h4 "Parceiro(a)". Mesmos padrões de input/validação. Botões em mobile: full-width
- [ ] 7.3 Adicionar validação condicional no createPatientSchema: child/adolescent requer pelo menos 1 guardian, couple requer dados do partner
- [ ] 7.4 **Teste E2E:** Criar `src/__tests__/e2e/seeded/patients/patient-minor.spec.ts` — fluxo: selecionar tipo "Criança", preencher dados do paciente + 1 guardian, salvar, verificar na detail que guardian aparece
- [ ] 7.5 **Teste E2E:** Criar `src/__tests__/e2e/seeded/patients/patient-couple.spec.ts` — fluxo: selecionar tipo "Casal", preencher dados dos 2 parceiros, salvar, verificar que ambos aparecem na listagem com indicador visual de casal

## 8. Frontend — Guardians in Patient Detail

> **Design System Sálvia**: Card para seção, Badge brand para primary, ícones `Pencil`/`Trash2`, Alert warning.

- [ ] 8.1 Criar componente `src/modules/patients/components/patient-guardians-section.tsx` — **Design system:** `Card flat` com título h4 "Responsáveis". Cada guardian como row: nome (body), parentesco (caption `text-secondary`), telefone com ícone `MessageCircle` (link WhatsApp), `Badge brand` (bg `brand-100`, text `brand-700`) "Principal" se is_primary. Botões `ghost` com ícones `Pencil`/`Trash2`. Botão "Adicionar responsável" `ghost` + `Plus` (disabled se 2). Alert `warning` se paciente menor sem guardians: "Este paciente menor está sem responsável cadastrado" com ícone `AlertTriangle`
- [ ] 8.2 Integrar guardians-section no overview-tab (renderizado condicionalmente para patient_type child/adolescent)

## 9. Frontend — Couple Display

> **Design System Sálvia**: Badge info para casal, Button link para parceiro, AlertDialog para desvincular.

- [ ] 9.1 Adicionar `Badge info` (bg `info-50`, text `info-700`) "Casal" ao lado do nome na listagem de pacientes
- [ ] 9.2 Adicionar seção "Parceiro(a)" no overview-tab: `Card flat` com título h4 "Parceiro(a)", nome como `Button link` (text `brand-700`, underline em hover) linkando para detail page, e botão "Desvincular casal" `Button ghost` text `danger-700` com ícone. Confirmação via shadcn `AlertDialog` (max-width 480px)
