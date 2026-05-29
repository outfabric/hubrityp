## Why

Tudo até aqui é "invisível": dados entram, pipeline roda, nota é gerada. Esta change entrega a única superfície onde o psicólogo INTERAGE com o resultado da IA — exatamente a peça que o PRD 10 marca como **non-negotiable**: "Nota gerada por IA — REVISE antes de salvar" (RF-10.15). Sem isso, o sistema poderia salvar notas como evolução clínica oficial sem supervisão humana, violando o ponto central do PRD (RF-10.19: "Sistema NÃO toma decisão clínica") e a Resolução CFP 001/2009 (psicólogo é responsável pelo prontuário). Esta change é também onde **alertas de risco** (RF-10.17/18) tornam-se ação clínica via banner vermelho proeminente.

## What Changes

- **Nova rota gated** `/dashboard/transcricoes/[id]/revisar`:
  - Layout: cabeçalho com badge de status, banner amarelo "Esta nota é um rascunho. Você é responsável pelo conteúdo final." (RF-10.15), banner vermelho condicional sobre risco (RF-10.18) destacando trechos, formulário de campos editáveis da nota, três ações na base: `[Salvar no prontuário]`, `[Editar mais]`, `[Descartar e escrever manualmente]` (RF-10.15).
  - Renderizada como Server Component que faz fetch inicial via Drizzle (RLS-scoped); o formulário interno é Client Component.
  - **Gating**: adicionar `/dashboard/transcricoes` ao `middleware.ts:classifyPath()` como `'app'`. Negative-auth test obrigatório.

- **Server Actions** em `src/modules/ai-transcription/server/`:
  - `getTranscriptionForReview({ transcriptionId })`: leitura segura (autenticação + ownership via RLS) que devolve `generated_note`, `risk_alerts`, `status`, `patient.firstName` (apenas para exibição na UI; **não** entra em log nem em prompt), `template_used`, `created_at`. Saída validada por Zod.
  - `updateTranscriptionDraft({ transcriptionId, generatedNote })`: salva edições parciais do psicólogo no JSONB (incrementa `user_edits_count`). Idempotente.
  - `saveTranscriptionToProntuario({ transcriptionId })`: cria uma evolução na tabela `evolutions` via integração com `medical-records/server/create-evolution.ts` (factory existente), marca a evolução com **flag nova `ai_assisted: true`** + `ai_transcription_id` (FK), atualiza a row de `ai_transcriptions` com `status='reviewed'`, `evolution_id`, `saved_to_prontuario=true`, `reviewed_at=now()`. Cobertura: RF-10.16.
  - `discardTranscription({ transcriptionId })`: marca `status='reviewed'`, `saved_to_prontuario=false`, `reviewed_at=now()`. Não deleta a linha (auditoria preservada); o áudio será descartado pelo cron como qualquer outra. Audit log entry.

- **Schema delta na tabela `evolutions`** (módulo `medical-records`):
  - Adicionar colunas `ai_assisted boolean NOT NULL DEFAULT false` e `ai_transcription_id uuid NULL REFERENCES ai_transcriptions(id) ON DELETE SET NULL`.
  - Migração + RLS reaproveita policies existentes (FK adicional não muda predicado).
  - Índice `(user_id, ai_assisted)` para queries de auditoria/estatística.

- **Indicador 🤖 na agenda** (RF-10.21):
  - Componente atualizado `src/modules/agenda/components/session-card.tsx`: quando a sessão tem `ai_transcriptions.status='ready'` vinculada, renderiza um `Badge` com ícone `Sparkles` ("Nota IA pronta") clicável que navega para `/dashboard/transcricoes/[id]/revisar`.
  - Query: TanStack Query carrega `useTranscriptionsByUser` (status `ready` + não `reviewed`) e join client-side. Para não onerar a query principal da agenda, fazemos uma chamada paralela.

- **Inbox/Notificações** (incremental, MVP):
  - Lista em `/dashboard/transcricoes` (rota nova já gated): cards das transcrições com status `ready` aguardando revisão. Empty state. Filtros por status/data simples.

- **Realtime no dashboard**:
  - Layout do `(app)` instala um subscriber em `ai-transcription:user:<userId>` (broadcast da change anterior). Recebe `{ transcriptionId }` → invalida queries do TanStack Query (`['ai-transcription', 'ready-count']`, etc.) → `Sonner` toast `"Nova nota IA pronta para revisão."` com ação `Ver`.

- **Estatística de aceitação** (preparatória para settings-ui):
  - O contador `user_edits_count` é incrementado a cada `updateTranscriptionDraft`. `saveTranscriptionToProntuario` registra `saved_to_prontuario=true`. A change `ai-transcription-settings-ui` consome esses dois para calcular taxa de aceitação (RF-10.23).

## Capabilities

### New Capabilities

- `ai-transcription-review-ui`: rotas gated `/dashboard/transcricoes` (lista) e `/dashboard/transcricoes/[id]/revisar` (revisão), Server Actions `getTranscriptionForReview` / `updateTranscriptionDraft` / `saveTranscriptionToProntuario` / `discardTranscription`, componente `<TranscriptionReviewForm>`, banners de risco e rascunho, indicador 🤖 na agenda, subscriber Realtime no layout do app, lista em inbox.

### Modified Capabilities

- `evolutions`: a tabela `evolutions` ganha `ai_assisted` e `ai_transcription_id`. A capability incorpora "evoluções podem ser originadas a partir de uma transcrição IA, sempre marcadas com `ai_assisted = true` e linkadas via `ai_transcription_id`". RLS não muda.
- `middleware-gating`: `classifyPath()` passa a classificar `/dashboard/transcricoes` (e seus subpaths) como `'app'` (gated).

## Impact

- **Código** (novos arquivos):
  - `src/app/(app)/dashboard/transcricoes/page.tsx` (lista — Server Component).
  - `src/app/(app)/dashboard/transcricoes/[id]/revisar/page.tsx` (revisão — Server Component).
  - `src/app/(app)/dashboard/transcricoes/[id]/revisar/_components/transcription-review-form.tsx` (Client Component).
  - `src/modules/ai-transcription/server/get-transcription-for-review.ts`
  - `src/modules/ai-transcription/server/update-transcription-draft.ts`
  - `src/modules/ai-transcription/server/save-transcription-to-prontuario.ts`
  - `src/modules/ai-transcription/server/discard-transcription.ts`
  - `src/modules/ai-transcription/components/risk-alert-banner.tsx`
  - `src/modules/ai-transcription/components/draft-warning-banner.tsx`
  - `src/modules/ai-transcription/components/transcription-status-badge.tsx`
  - `src/modules/ai-transcription/hooks/use-ai-transcription-realtime.ts` (subscriber Realtime client-side).
- **Código** (edits):
  - `src/middleware.ts` — `classifyPath()`.
  - `src/shared/db/schema/medical-records/tables.ts` — colunas em `evolutions`.
  - `src/modules/medical-records/server/create-evolution.ts` — aceita opções `aiAssisted`/`aiTranscriptionId`.
  - `src/modules/agenda/components/session-card.tsx` — badge IA.
  - `src/app/(app)/layout.tsx` — hook Realtime ativado.
- **Banco**: migração pequena (2 colunas em `evolutions` + 1 índice). Reversível. Backfill default `ai_assisted=false`.
- **Rotas**: 2 novas, ambas gated. Atualizar `middleware.ts:classifyPath()`. Negative-auth tests obrigatórios.
- **Realtime**: nova subscription no layout `(app)`.
- **Segurança**: este é a fronteira "fui-revisado-por-humano" — qualquer brecha aqui significa salvar nota IA como evolução sem supervisão. Cada Server Action: getUser + Zod + ownership via RLS. Negative tests obrigatórios para cada uma.
- **LGPD**: a UI exibe o nome do paciente — é a tela do psicólogo, autorizada. Mas a página deve ter `Referrer-Policy: strict-origin-when-cross-origin` (já default) E o `transcriptionId` na URL é UUID (não vaza paciente).
