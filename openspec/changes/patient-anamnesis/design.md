## Context

A anamnese é o primeiro documento clínico do paciente — estruturado em seções padrão, editável com rich text, e com auto-save para evitar perda durante sessão. Depende do módulo de pacientes (`patient-crud-core`) já existir. A tabela tem relação 1:1 com `patients`.

## Goals / Non-Goals

**Goals:**
- Tabela `anamnesis` com RLS via subquery em patients
- Editor Tiptap integrado para cada seção
- Auto-save debounced a cada 10 segundos com indicador visual
- Tab "Anamnese" funcional na página de detalhes

**Non-Goals:**
- Templates de anamnese por abordagem (v2 — RF-02.14)
- Seções customizadas UI (o campo JSONB existe mas a UI de adicionar seções custom fica para v2)
- Audit log de leitura (PRD 11)

## Decisions

### 1. Tiptap como editor rich-text

Tiptap é React-native, extensível, e tem boa DX. Usaremos `@tiptap/react` + `@tiptap/starter-kit` (bold, italic, headings, lists). Cada seção da anamnese é uma instância separada de Tiptap, armazenando HTML como texto.

**Alternativa considerada:** Lexical (Meta) — rejeitada por API mais complexa e menos exemplos em produção com Next.js App Router.

### 2. Auto-save com hook customizado

Criar `useAutoSave(content, saveFn, { interval: 10_000 })` hook que:
1. Mantém referência do último conteúdo salvo
2. Compara com conteúdo atual a cada ciclo
3. Debounce de 10s desde a última mudança
4. Retorna status: `idle` | `saving` | `saved` | `error`

A save function é um Server Action que faz upsert (INSERT ON CONFLICT DO UPDATE) na tabela `anamnesis`.

### 3. Upsert via Drizzle `onConflictDoUpdate`

Como a relação é 1:1 (UNIQUE em patient_id), o Server Action usa `INSERT ... ON CONFLICT (patient_id) DO UPDATE SET ...`. Não precisa de lógica de create vs. update no frontend.

### 4. Todas as seções em uma request

Auto-save envia todas as seções de uma vez (não por seção individual). Simplifica a lógica e evita race conditions entre saves parciais.

## Frontend — Design System Sálvia (`docs/design-system/rules.md`)

### Tab "Anamnese"
- Integra no shadcn `Tabs` underline existente (tab ativa: border-bottom 2px `brand-500`)
- Cada seção da anamnese em `Card flat` com título h4 (16px/500) como label da seção

### Editor Tiptap
- Toolbar: usar `Button ghost` para cada ação de formatação (bold, italic, etc.), ícones Lucide 16px
- Editor area: bg `surface-sunken`, border `border`, focus border `brand-500` + `shadow-focus`, radius `md`
- Placeholder em `text-disabled`
- Linha máxima de leitura: 720px (regra de tipografia para leitura longa)
- body-lg (17px/400) com line-height 1.65 para o conteúdo

### Auto-save indicador
- Posição: topo direito da tab, inline com título
- "Salvo às HH:MM" em `text-tertiary` (caption 12px/500)
- "Salvando..." com ícone spinner (animação <300ms)
- "Erro ao salvar" em `danger-700` com ícone `AlertCircle`
- Respeitar `prefers-reduced-motion` no spinner

### Dirty state
- Ao sair da tab/página com mudanças não salvas: modal "Alterações não salvas" com botões "Continuar editando" (`Button primary`) e "Descartar" (`Button secondary`)

### Acessibilidade
- Cada seção do editor com `aria-label` descrevendo a seção
- Toolbar com `role="toolbar"` e navegação por setas

## Risks / Trade-offs

- **[Tamanho do payload de auto-save]** → Com 8 seções de texto rico, o payload pode chegar a ~50-100KB. Aceitável para uma request a cada 10s.
- **[Múltiplas instâncias Tiptap]** → Cada seção é um editor separado. Para 8 seções, isso é OK em termos de performance. Se escalar para muitas seções custom, considerar virtualização.
- **[Armazenamento de HTML vs Markdown]** → HTML do Tiptap é mais fiel à formatação. Markdown perderia informações de formatação. Escolhemos HTML.
