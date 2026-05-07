## Context

Exportação e importação são funcionalidades complementares: exportar atende portabilidade LGPD (art. 18, V) e encaminhamentos; importar facilita migração de consultório. Ambos dependem do módulo de pacientes existir. A exportação opcionalmente inclui anamnese (depende de `patient-anamnesis`).

## Goals / Non-Goals

**Goals:**
- PDF de exportação com dados cadastrais e opcionalmente anamnese
- Importação CSV com upload, preview, validação, e inserção em batch
- Mapeamento de colunas CSV flexível

**Non-Goals:**
- Exportação de sessões e financeiro (dependem de PRDs 03/06)
- Importação de formatos além de CSV (Excel, JSON)
- Importação direta de outros softwares (iClinic, Psicomanager)

## Decisions

### 1. PDF via pdfkit (server-side streaming)

O PDF é gerado na Server Action e retornado como stream (não armazenado). O psicólogo recebe download imediato. Usaremos `pdfkit` que já será adicionado na change de consent term.

Para a exportação, o PDF tem layout simples: cabeçalho com dados do psicólogo, seção de dados cadastrais, e opcionalmente seção de anamnese.

### 2. CSV parsing com papaparse (client-side)

O parsing do CSV acontece no browser (papaparse). Vantagens:
- Preview instantâneo sem upload para servidor
- Feedback de validação interativo
- Menor carga no servidor

A validação de duplicatas (telefone/email) requer consulta ao servidor — feita via Server Action que recebe os valores a verificar em batch.

**Alternativa considerada:** Server-side parsing — rejeitada por latência na experiência de preview. O CSV nunca contém dados sensíveis do sistema (é dados do psicólogo), então parsing no client é seguro.

### 3. Inserção em batch via Drizzle

O Server Action de importação recebe o array de pacientes validados e faz `db.insert(patients).values([...])` em uma transação. Se falhar, rollback total.

### 4. Limite de 200 linhas

Protege contra uploads muito grandes. 200 cobre o cenário de psicólogo migrando todos os pacientes. Se necessário escalar, pode ser aumentado ou implementar importação assíncrona (Inngest job).

## Frontend — Design System Sálvia (`docs/design-system/rules.md`)

### Modal de exportação PDF
- shadcn `AlertDialog` (max-width 480px, radius `2xl`, padding `space-8`)
- Checkbox "Incluir dados clínicos (anamnese)" com shadcn `Checkbox`
- Aviso de sigilo: shadcn `Alert` variante `warning` (bg `warning-50`, text `warning-700`, ícone `AlertTriangle`)
- Botão "Exportar" como `Button primary` com ícone `Download` e loading state
- Botão "Cancelar" como `Button secondary`

### Página de importação CSV
- Título h1 "Importar pacientes" (28px/600)
- Dropzone: `Card interactive` (border dashed `border-strong`, hover border `brand-500`), ícone `Upload` centralizado em `text-tertiary`, texto "Arraste um arquivo CSV ou clique para selecionar"
- **Column mapping UI:** cada coluna como row com label do CSV + shadcn `Select` para campo do sistema
- **Preview table:** shadcn `Table` com rows coloridas via bg semântico: válido → sem destaque (default), erro → bg `danger-50`, duplicata → bg `warning-50`. Mensagens de erro inline em caption (12px) `danger-700`
- **Summary:** card com badges contando total/válidos/erros/duplicatas
- Botão "Importar N pacientes" como `Button primary` com loading state, desabilitado se 0 válidos
- Empty state se CSV vazio: ícone `FileX` tertiary + "Nenhuma linha encontrada no arquivo"

### Botão na listagem
- "Importar CSV" como `Button secondary` com ícone `Upload` ao lado do "+ Novo Paciente"

### Microcopy
- "Importar pacientes" (não "Upload CSV")
- Erro: "Máximo de 200 linhas por importação. Seu arquivo tem 201." (humano, não técnico)
- Sucesso: "45 pacientes importados com sucesso"

## Risks / Trade-offs

- **[papaparse no bundle size]** → ~30KB minified. Aceitável. Dynamic import para não impactar páginas que não usam importação.
- **[Transação única para batch]** → Se o batch é grande (200 rows), a transação pode ser lenta. Para o volume esperado, é aceitável (<1s para 200 inserts em Supabase).
- **[PDF sem sessões/financeiro]** → O PRD pede incluir histórico de sessões e financeiro no export, mas esses módulos não existem ainda. A versão inicial exporta apenas cadastro + anamnese. Quando os módulos existirem, o PDF será estendido.
