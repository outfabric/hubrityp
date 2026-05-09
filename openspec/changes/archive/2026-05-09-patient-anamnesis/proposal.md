## Why

A anamnese é o documento clínico de entrada do paciente — registra queixa principal, história familiar, hipóteses diagnósticas e plano terapêutico. Hoje o psicólogo faz isso em Word/papel sem padronização. A anamnese precisa ser digital, editável com rich text, e com auto-save para evitar perda de dados durante sessão.

## What Changes

- Nova tabela `anamnesis` (1:1 com patients) com seções padrão como colunas TEXT e campo JSONB para seções customizadas
- Editor de texto rico (Tiptap) integrado à tab "Anamnese" na página de detalhes do paciente
- Auto-save a cada 10 segundos (debounced, comparando diff antes de salvar)
- Server Actions: getAnamnesis, upsertAnamnesis, autoSaveAnamnesis
- Seções padrão: queixa principal, história da queixa, história familiar, escolar/profissional, saúde física, histórico psicoterapêutico, hipóteses diagnósticas, plano terapêutico
- Dados sensíveis (LGPD art. 11) — mesmas regras de retenção do prontuário

## Capabilities

### New Capabilities
- `patient-anamnesis`: Formulário de anamnese com seções padrão, editor rich-text (Tiptap), auto-save debounced, seções customizáveis via JSONB, tratamento como dado sensível de saúde

### Modified Capabilities
- `patient-detail`: A página de detalhes ganha a tab "Anamnese" funcional (antes era placeholder)

## Impact

- **Banco de dados:** Nova migration criando tabela `anamnesis` com RLS owner-scoped (via JOIN com patients.user_id)
- **Drizzle schema:** Nova tabela em `src/shared/db/schema/patients/tables.ts`
- **Dependências:** `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-placeholder` (editor rich-text)
- **Módulo pacientes:** Novos server actions para anamnese, hook de auto-save no frontend
- **Frontend:** Componente de editor Tiptap, tab "Anamnese" na página de detalhes, indicador visual de salvamento
