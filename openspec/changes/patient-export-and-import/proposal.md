## Why

O psicólogo precisa exportar dados do paciente em PDF para atender direito LGPD de portabilidade (art. 18, V) e para encaminhamentos a outros profissionais. Também precisa importar pacientes existentes de planilhas (migração de consultório) sem recadastrar um a um manualmente.

## What Changes

- Botão "Exportar PDF" na página de detalhes do paciente, gerando documento com dados cadastrais, anamnese, e histórico (com alerta de sigilo antes de incluir prontuário)
- Geração de PDF server-side com pdfkit (download direto, sem armazenamento permanente)
- Página de importação CSV (`/app/pacientes/importar`) com upload, mapeamento de colunas, preview, e validação linha a linha
- Validação de duplicatas na importação (mesmo telefone OU email para o mesmo psicólogo)
- Preview com indicação de linhas válidas/inválidas antes de confirmar importação
- Server Action de importação em batch com feedback de progresso

## Capabilities

### New Capabilities
- `patient-export`: Geração de PDF com dados cadastrais e anamnese do paciente, com confirmação de inclusão de dados sensíveis (prontuário) — atende portabilidade LGPD
- `patient-import`: Importação de pacientes via CSV com mapeamento de colunas, validação (formato, duplicatas), preview, e inserção em batch

### Modified Capabilities
- `patient-detail`: Menu de ações ganha opção "Exportar PDF"
- `patient-listing`: Botão "Importar CSV" na toolbar da listagem

## Impact

- **Dependências:** `pdfkit` (já adicionado na change de consent), `papaparse` ou `csv-parse` (parsing de CSV)
- **Rotas novas:** `src/app/(app)/pacientes/importar/page.tsx`
- **Módulo pacientes:** Server actions para gerar PDF e processar importação CSV
- **Frontend:** Modal de confirmação (exportação), página de importação com upload + preview + validação
- **Performance:** Importação de 100+ linhas deve usar batch insert com tratamento de erros por linha
