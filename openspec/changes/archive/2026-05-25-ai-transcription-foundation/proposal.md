## Why

PRD 10 (Transcrição Automática de Sessão com IA) é um diferencial central do produto e simultaneamente o módulo de maior risco ético/regulatório (LGPD art. 11, CFP 13/2022, sigilo profissional). Antes de qualquer fluxo de captura de áudio, processamento Gemini ou UI de revisão poder ser construído, precisamos de um chão técnico estável: módulo de domínio com edge-safe boundary, modelo de dados Drizzle + RLS por psicólogo nas duas tabelas centrais (`ai_transcription_settings`, `ai_transcriptions`), validadores Zod / branded types compartilhados, configuração de env (`GEMINI_API_KEY`, bucket de áudio, retenção), helpers de pseudonimização (RN-10.08) e um logger garantido a NÃO emitir teor da sessão (RN-10.10). Sem essa base, as changes subsequentes (consent, upload, processing, review-ui, settings-ui) não têm onde escrever.

## What Changes

- Cria o módulo de domínio `src/modules/ai-transcription/` com `index.ts` (barrel público), `edge.ts` (entrypoint edge-safe consumido por `middleware.ts` quando classificarmos as novas rotas), `lib/` (schemas Zod, branded types `TranscriptionId`, `TranscriptionStatus`, mappers, helper `pseudonymizeTranscript`, helper `redactForLogs`), e `server/` (placeholder com `index.ts`).
- Adiciona schema Drizzle em `src/shared/db/schema/ai-transcription/`:
  - `tables.ts` com `aiTranscriptionSettings` (1:1 com `users`) e `aiTranscriptions` (uma linha por sessão processada, FKs nullable para `sessionId`/`evolutionId`/`patientId` honrando os fluxos do PRD).
  - `policies.ts` com RLS por operação (SELECT/INSERT/UPDATE/DELETE), todas escopadas em `user_id = auth.uid()`. **RLS habilitada já na migração inicial.**
  - `index.ts` (barrel do domínio) re-exportado pelo `src/shared/db/schema/index.ts`.
  - Migração Drizzle correspondente em `src/shared/db/migrations/`.
- Indexa as colunas usadas em predicados RLS (`user_id`) e em filtros operacionais críticos (`status`, `audio_discarded_at`, `created_at` parcial para o cron de descarte).
- Adiciona variáveis ao schema central de env (`src/shared/env/schemas.ts` + `index.ts`): `GEMINI_API_KEY` (server-only), `GEMINI_MODEL_TRANSCRIPTION` (default `gemini-3.5-flash`), `GEMINI_MODEL_NOTE` (default `gemini-3.5-flash`), `AI_TRANSCRIPTION_BUCKET` (default `ai-transcription-audio`), `AI_TRANSCRIPTION_AUDIO_TTL_HOURS` (default `24`), `AI_TRANSCRIPTION_MAX_AUDIO_MB` (default `200`). Nenhuma das chaves cai em `NEXT_PUBLIC_*`.
- Cria bucket privado `ai-transcription-audio` no Supabase Storage (migração SQL + política de acesso restrita à service-role em jobs Inngest e à URL assinada de curta duração quando exigido).
- Documenta o boundary controlador/operador (RN-10.02): psicólogo é controlador, Gemini é operador. Helper `pseudonymizeTranscript({ patientFirstName, patientFullName, transcript })` substitui ocorrências por `"Paciente"` antes de qualquer prompt sair da máquina.
- Logger derivado de `@/shared/lib/logger` (`createTranscriptionLogger`) com `redactForLogs` aplicado: SEMPRE emite IDs/timestamps/métricas, NUNCA conteúdo da sessão, transcrição bruta, nota gerada ou nome do paciente.
- Nenhum endpoint, Server Action de produto ou UI nessa change. Apenas a fundação técnica. As capacidades downstream (consent, upload, processing, review-ui, settings) serão construídas sobre esse chão.

## Capabilities

### New Capabilities

- `ai-transcription-data-model`: tabelas Drizzle (`ai_transcription_settings`, `ai_transcriptions`), políticas RLS por operação escopadas em `auth.uid()`, índices operacionais (incluindo índice parcial para o job de descarte de áudio), bucket privado de áudio no Supabase Storage. Cobre RN-10.03 (descarte), RN-10.10 (teor fora de logs), RNF-10.04 (áudio cifrado em repouso) ao nível de esqueleto.
- `ai-transcription-module`: módulo de domínio `src/modules/ai-transcription/` com barrel público (`index.ts`), edge entrypoint (`edge.ts`), `lib/` com schemas Zod canônicos (TranscriptionStatus, TranscriptionSource, generatedNoteSchema, riskAlertSchema), branded types (`TranscriptionId`), helpers de pseudonimização e redação de logs, e `server/` placeholder. Cobre RN-10.08 e RN-10.10 no nível de utilitários.
- `ai-transcription-env-config`: variáveis de ambiente server-only para Gemini, bucket de áudio, TTL de descarte e limite de upload, validadas via Zod no boot, consumidas exclusivamente por `serverEnv`.

### Modified Capabilities

- `data-layer`: o schema union em `src/shared/db/schema/index.ts` passa a re-exportar o novo domínio `ai-transcription`. Drizzle Kit gera migração contendo as duas tabelas, RLS habilitada e políticas. Sem alteração nas tabelas existentes.
- `env-and-logging`: o validador central de env (`src/shared/env/schemas.ts`) ganha as chaves Gemini e de áudio; o helper de logger ganha um wrapper `createTranscriptionLogger` que aplica `redactForLogs` por default — sem mudar contratos existentes.

## Impact

- **Código**: novo módulo `src/modules/ai-transcription/` (sem Server Actions de produto), novo schema folder `src/shared/db/schema/ai-transcription/`, edits em `src/shared/db/schema/index.ts` (re-export), `src/shared/env/schemas.ts` e `src/shared/env/index.ts` (novas variáveis), `src/shared/lib/logger.ts` (factory).
- **Banco de dados**: 1 migração Drizzle criando 2 tabelas + RLS + 3 índices + 1 bucket de Storage. Nenhuma alteração destrutiva. Reversível.
- **Dependências**: nova dependência `@google/genai` (server-only) instalada para uso nas changes downstream; nenhuma instalação client-side. Drizzle ORM, Supabase Storage e Inngest já presentes.
- **Rotas**: nenhuma rota adicionada nem alterada nesta change. Atualização do `middleware.ts:classifyPath()` é responsabilidade das changes de UI (review-ui, settings-ui).
- **Segurança**: RLS é o último anel de defesa para áudio/transcrição/nota — sai habilitada com policies por operação na migração inicial. Bucket de áudio nasce PRIVADO; nenhuma URL pública é gerada. Nenhum secret entra em `NEXT_PUBLIC_*`.
- **Riscos LGPD**: nenhum dado de paciente trafega ainda — esta change apenas prepara o terreno. Os controles de descarte (24h), pseudonimização e ausência de teor em logs são instalados aqui como utilitários, mas só passam a ser exercitados pelas changes seguintes.
