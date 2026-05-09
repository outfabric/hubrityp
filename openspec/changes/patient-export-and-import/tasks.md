## 1. Dependencies

- [x] 1.1 Instalar `papaparse` e `@types/papaparse`: `npm install papaparse @types/papaparse`
- [x] 1.2 Se `pdfkit` não foi instalado pela change patient-consent-term, instalar: `npm install pdfkit @types/pdfkit`

## 2. PDF Export — Server Action

- [x] 2.1 Criar `src/modules/patients/server/export-patient-pdf.ts` — Server Action que recebe patient_id e flag `includeClinicalData`. Busca patient + profile (psicólogo). Se includeClinicalData, busca anamnesis. Gera PDF via pdfkit e retorna como base64 ou stream URL. PDF inclui: header (psicólogo nome/CRP, data), dados cadastrais, e opcionalmente anamnese
- [x] 2.2 Criar `src/modules/patients/lib/generate-patient-pdf.ts` — função pura que recebe dados estruturados e retorna Buffer de PDF. Reutiliza pattern similar ao consent PDF
- [x] 2.3 **Teste unitário:** Criar `src/__tests__/unit/modules/patients/lib/generate-patient-pdf.test.ts` — testar que PDF é gerado com dados cadastrais, com e sem anamnese, header inclui dados do psicólogo

## 3. CSV Import — Parsing & Validation

- [x] 3.1 Criar `src/modules/patients/lib/csv-column-mapping.ts` — mapeamento esperado de colunas CSV (nome→full_name, telefone→phone, email→email, data_nascimento→birth_date, tags→tags, observacao→notes). Função para detectar e sugerir mapeamento automático por nome de coluna
- [x] 3.2 Criar `src/modules/patients/lib/validate-csv-row.ts` — função que recebe uma row mapeada e retorna `{ valid: boolean, errors: string[], warnings: string[] }`. Valida: phone format, email format, date format
- [x] 3.3 **Testes unitários:** Criar `src/__tests__/unit/modules/patients/lib/csv-column-mapping.test.ts` — testar mapeamento automático (headers comuns em PT-BR), headers desconhecidos
- [x] 3.4 **Testes unitários:** Criar `src/__tests__/unit/modules/patients/lib/validate-csv-row.test.ts` — testar validação de cada campo (phone válido/inválido, email válido/inválido, date formats)

## 4. CSV Import — Server Action

- [x] 4.1 Criar `src/modules/patients/server/check-csv-duplicates.ts` — recebe array de {phone, email}, retorna quais já existem para o psicólogo (batch query)
- [x] 4.2 Criar `src/modules/patients/server/import-patients-csv.ts` — recebe array de pacientes validados (do frontend), verifica limite (200), insere em transação batch via Drizzle `db.insert(patients).values([...])`. Rollback total se falhar
- [x] 4.3 **Testes de integração:** Criar `src/__tests__/integration/patients/patient-import.int.test.ts` — testar import batch (sucesso com 10 rows, rollback em caso de erro, rejeita >200 rows, detecta duplicatas corretamente)

## 5. Module Barrel Update

- [x] 5.1 Atualizar `src/modules/patients/index.ts` para reexportar: exportPatientPdf, checkCsvDuplicates, importPatientsCsv, csv helpers, pdf helpers

## 6. Frontend — Export PDF

> **Design System Sálvia** (`docs/design-system/rules.md`): AlertDialog para confirmação, Alert warning para sigilo, Button primary com loading + ícone Download.

- [x] 6.1 Adicionar opção "Exportar PDF" no `DropdownMenu` de ações do patient-detail-header (ícone `Download`)
- [x] 6.2 Criar componente `src/modules/patients/components/export-confirm-modal.tsx` (Client Component) — **Design system:** shadcn `AlertDialog` (max-width 480px, radius `2xl`, padding `space-8`). Título h3 "Exportar dados do paciente". shadcn `Checkbox` "Incluir dados clínicos (anamnese)". Aviso de sigilo: shadcn `Alert` variante `warning` (bg `warning-50`, text `warning-700`, ícone `AlertTriangle`, texto "Os dados clínicos são sigilosos. Compartilhe apenas quando estritamente necessário."). Botão "Exportar" `Button primary` + ícone `Download` + loading state obrigatório. "Cancelar" `Button secondary`
- [x] 6.3 Criar route action em `src/app/(app)/pacientes/[id]/actions.ts` — adicionar exportPatientPdf delegada

## 7. Frontend — CSV Import Page

> **Design System Sálvia**: Card interactive para dropzone, Table com rows semânticas, Badge para contagem, Button secondary na toolbar, empty state.

- [ ] 7.1 Criar componente `src/modules/patients/components/csv-upload.tsx` (Client Component) — **Design system:** `Card interactive` (border dashed `border-strong`, hover border `brand-500`, radius `xl`, padding `space-8`). Ícone `Upload` 24px `text-tertiary` centralizado. Texto body "Arraste um arquivo CSV ou clique para selecionar" em `text-secondary`. Aceita apenas `.csv`. Parsing client-side com papaparse, detecção automática de colunas
- [ ] 7.2 Criar componente `src/modules/patients/components/csv-column-mapper.tsx` (Client Component) — **Design system:** cada coluna como row em `Card flat`. Label do CSV em body, shadcn `Select` para campo do sistema. Ícone `ArrowRight` entre label e select. Gap `space-4` entre rows
- [ ] 7.3 Criar componente `src/modules/patients/components/csv-preview-table.tsx` (Client Component) — **Design system:** shadcn `Table` (header bg `surface-muted`, 11px uppercase). Rows: válido → bg default, erro → bg `danger-50`, duplicata → bg `warning-50`. Mensagens de erro inline em caption (12px) `danger-700` com ícone `AlertCircle`. Summary no topo: `Badge neutral` "50 linhas", `Badge success` "45 válidas", `Badge danger` "3 com erros", `Badge warning` "2 duplicadas". Botão "Importar 45 pacientes" `Button primary` com loading state, disabled se 0 válidas. Mobile: table → cards stackados. Empty state: ícone `FileText` tertiary + h4 "Nenhuma linha válida" + descrição + CTA
- [ ] 7.4 Criar Server Component `src/app/(app)/pacientes/importar/page.tsx` — título h1 "Importar pacientes" (28px/600). Renderiza fluxo: upload → mapping → preview → confirm. Toast success "45 pacientes importados com sucesso" (Sonner, border-left `success-500`)
- [ ] 7.5 Criar route action `src/app/(app)/pacientes/importar/actions.ts` com `'use server'` — delega checkCsvDuplicates e importPatientsCsv
- [ ] 7.6 Adicionar botão "Importar CSV" como `Button secondary` + ícone `Upload` na toolbar da listagem, ao lado de "+ Novo Paciente"

## 8. Frontend — E2E Tests

- [ ] 8.1 **Teste E2E:** Criar `src/__tests__/e2e/seeded/patients/patient-export.spec.ts` — fluxo: navegar para detalhe do paciente, abrir menu de ações, clicar "Exportar PDF", confirmar no modal (sem dados clínicos), verificar que download inicia
- [ ] 8.2 **Teste E2E:** Criar `src/__tests__/e2e/seeded/patients/patient-import.spec.ts` — fluxo: navegar para /app/pacientes/importar, fazer upload de CSV fixture com 5 rows válidas e 1 inválida, verificar preview (5 verdes, 1 vermelha), confirmar importação, verificar redirect para listagem com toast de sucesso, verificar que 5 novos pacientes aparecem
