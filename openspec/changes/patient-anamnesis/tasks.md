## 1. Database Schema — Anamnesis

- [x] 1.1 Adicionar tabela `anamnesis` em `src/shared/db/schema/patients/tables.ts` (colunas: id, patient_id FK UNIQUE, chief_complaint, history_present_illness, family_history, educational_professional, physical_health, prior_therapy, initial_hypothesis, treatment_plan, custom_sections JSONB, created_at, updated_at)
- [x] 1.2 Adicionar RLS policies para `anamnesis` em `src/shared/db/schema/patients/policies.ts` — policy via subquery: `patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid())`
- [x] 1.3 Rodar `npm run db:generate`, editar migration para incluir RLS policies, FK constraint para patients(id) com ON DELETE CASCADE, UNIQUE constraint em patient_id
- [x] 1.4 Testar migration com `npm run db:migrate` local
- [x] 1.5 **Teste de integração:** Criar `src/__tests__/integration/patients/anamnesis-schema.int.test.ts` — verificar tabela existe, RLS habilitado, UNIQUE em patient_id, policies existem

## 2. Dependencies — Tiptap

- [ ] 2.1 Instalar dependências: `npm install @tiptap/react @tiptap/starter-kit @tiptap/pm @tiptap/extension-placeholder`

## 3. Server Actions — Anamnesis

- [ ] 3.1 Criar `src/modules/patients/server/get-anamnesis.ts` — busca anamnesis por patient_id (RLS via subquery garante ownership)
- [ ] 3.2 Criar `src/modules/patients/server/upsert-anamnesis.ts` — INSERT ... ON CONFLICT (patient_id) DO UPDATE SET para todas as seções. Usado tanto pelo save manual quanto pelo auto-save
- [ ] 3.3 **Testes de integração:** Criar `src/__tests__/integration/patients/anamnesis-crud.int.test.ts` — testar get (existente, inexistente), upsert (create, update), RLS (cross-user bloqueado), dados persistidos corretamente

## 4. Module Barrel Update

- [ ] 4.1 Atualizar `src/modules/patients/index.ts` para reexportar: getAnamnesis, upsertAnamnesis, tipos de anamnesis

## 5. Frontend — Tiptap Editor Component

> **Design System Sálvia** (`docs/design-system/rules.md`): editor com tokens do tema, ícones Lucide, acessibilidade.

- [ ] 5.1 Criar componente `src/modules/patients/components/tiptap-editor.tsx` (Client Component) — **Design system:** toolbar com `Button ghost` (size sm 32px) para cada ação, ícones Lucide 16px (`Bold`, `Italic`, `Underline`, `Heading3`, `Heading4`, `List`, `ListOrdered`). Toolbar com `role="toolbar"`, navegação por setas. Editor area: bg `surface-sunken`, border `border`, focus border `brand-500` + `shadow-focus`, radius `md`. Conteúdo em body-lg (17px/400, line-height 1.65). Placeholder em `text-disabled`. Max-width 720px (leitura longa). `aria-label` no editor. Respeitar `prefers-reduced-motion`
- [ ] 5.2 **Teste unitário:** Criar `src/__tests__/unit/modules/patients/components/tiptap-editor.test.tsx` — testar que renderiza, aceita content inicial, emite onChange ao digitar

## 6. Frontend — Auto-Save Hook

- [ ] 6.1 Criar hook `src/modules/patients/lib/use-auto-save.ts` — `useAutoSave(content: T, saveFn: (content: T) => Promise<void>, options: { interval: number })`. Retorna `{ status: 'idle' | 'saving' | 'saved' | 'error', lastSavedAt: Date | null }`. Compara content com lastSaved via JSON.stringify, debounce no interval
- [ ] 6.2 **Teste unitário:** Criar `src/__tests__/unit/modules/patients/lib/use-auto-save.test.ts` — testar que auto-save dispara após interval, não dispara se content unchanged, reseta timer em mudanças rápidas, retorna status corretos

## 7. Frontend — Anamnesis Tab

> **Design System Sálvia**: Card flat por seção, auto-save indicator em `text-tertiary`, dirty state modal, max-width 720px.

- [ ] 7.1 Criar componente `src/modules/patients/components/anamnesis-tab.tsx` (Client Component) — **Design system:** cada seção em `Card flat` (border, radius `xl`, padding `space-6`). Label da seção em h4 (16px/500). Gap entre seções `space-12`. Max-width 720px para área de edição. Indicador auto-save no topo direito: "Salvo às HH:MM" em caption `text-tertiary`, "Salvando..." com spinner (<300ms animação), "Erro ao salvar" em `danger-700` com ícone `AlertCircle` e retry. Botão "Salvar" como `Button primary` com loading state. Dirty state: modal "Alterações não salvas" ao sair com mudanças (botões "Continuar editando" primary / "Descartar" secondary). Integra useAutoSave com Server Action de upsert
- [ ] 7.2 Atualizar `patient-tabs.tsx` para renderizar AnamnesisTab na tab "Anamnese" (em vez de placeholder)
- [ ] 7.3 Criar route action `src/app/(app)/pacientes/[id]/actions.ts` se não existir — adicionar upsertAnamnesis como Server Action delegada
- [ ] 7.4 **Teste E2E:** Criar `src/__tests__/e2e/seeded/patients/patient-anamnesis.spec.ts` — fluxo: navegar para detalhe do paciente, clicar tab "Anamnese", preencher seção "Queixa principal" com texto, aguardar indicador "Salvo", recarregar página, verificar que conteúdo persiste
