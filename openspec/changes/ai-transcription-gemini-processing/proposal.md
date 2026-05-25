## Why

Com fundação, consentimento e upload no lugar, o sistema agora aceita áudios mas não faz nada com eles. Esta change é o coração do PRD 10: pega uma linha `ai_transcriptions` em `pending`, executa o pipeline (a) **transcrição via Gemini** (RF-10.07), (b) **geração de nota estruturada** por template (RF-10.11), (c) **detecção de risco** (RF-10.17), (d) **descarte do áudio em 24h** (RN-10.03, RNF-10.06), tudo de forma assíncrona, resiliente, com pseudonimização (RN-10.08) e zero teor em logs (RN-10.10). É também o único ponto do produto onde dados clínicos saem do nosso perímetro — o termo de IA já documenta isso, mas a implementação precisa honrar literalmente: nome do paciente NUNCA vai para o prompt; áudio nunca permanece além de 24h; logs nunca exibem transcrição ou nota.

## What Changes

- **Cliente Gemini server-only** em `src/modules/ai-transcription/server/gemini-client.ts`: `import 'server-only'` no topo. Cria uma única instância de `GoogleGenAI` com `apiKey: serverEnv.GEMINI_API_KEY`. Expõe `getGeminiClient()` lazy (instancia na primeira chamada). Reúsa o cliente entre invocações Inngest.

- **Pipeline Inngest `processAudioTranscription`** consumindo `ai-transcription/audio.uploaded` (já emitido pela change anterior). Substitui o stub `onAudioUploadedStub`. Steps (cada um com retries Inngest independentes):
  1. `assert-consent` — re-checa `assertAiConsentActive` (paciente pode ter revogado entre upload e processamento — RN-10.06).
  2. `transition-to-transcribing` — UPDATE `status='transcribing'`.
  3. `download-audio` — baixa do nosso bucket via service-role (system job).
  4. `upload-to-gemini-files-api` — chama `ai.files.upload(...)` para áudios >20MB (Files API). Para áudios menores, usa inline base64. A decisão por tamanho é local.
  5. `run-transcription` — `ai.models.generateContent({ model: GEMINI_MODEL_TRANSCRIPTION, contents, config: { systemInstruction: 'Transcreva...em pt-BR...', responseMimeType: 'text/plain', audioTimestamp: true } })`. Forçar pt-BR via instruction (RF-10.07).
  6. `pseudonymize` — passa o texto transcrito pelo helper `pseudonymizeTranscript` antes de qualquer prompt subsequente.
  7. `transition-to-generating` — UPDATE `status='generating'`.
  8. `generate-structured-note` — `ai.models.generateContent({ model: GEMINI_MODEL_NOTE, contents: structuredPrompt({ template, transcript: pseudonymized, riskSensitivity }), config: { responseMimeType: 'application/json', responseJsonSchema: GeminiNoteJsonSchema, systemInstruction: 'Você é um assistente clínico...' } })`. Modelo retorna JSON. Zod-valida via `GeneratedNoteSchema` no boundary.
  9. `extract-risk-alerts` — durante o mesmo prompt (ou prompt separado), o LLM identifica trechos de risco. Saída validada por `RiskAlertSchema`.
  10. `delete-gemini-file` — best-effort `ai.files.delete(...)` para reduzir retenção do lado deles.
  11. `persist-note` — UPDATE row com `generated_note`, `risk_alerts`, `template_used`, `status='ready'`, `completed_at=now()`.
  12. `notify-user` — Realtime broadcast no canal do psicólogo: `ai-transcription:ready` com o `transcriptionId`. UI da change `review-ui` consome isso para atualizar o indicador 🤖.

- **Cron Inngest `discardOldAudios`** (rodando a cada 1h): query `WHERE audio_object_key IS NOT NULL AND audio_discarded_at IS NULL AND created_at < now() - (settings.keep_audio_hours || 24) hours`, para cada linha: deleta do bucket → UPDATE `audio_object_key=NULL`, `audio_discarded_at=now()`. Honra a configuração por psicólogo (`keep_audio_hours`).

- **Cron Inngest `purgeFailedAudios`** (a cada 1h): áudios com `status='failed'` há mais de 1h têm objeto deletado imediatamente (não esperam 24h — não há motivo para reter algo que nunca virou nota).

- **Handler de `ai-transcription/consent.revoked`** (substitui o stub criado em `ai-transcription-consent`): quando consent é revogado, identifica transcrições em curso (`status IN ('pending','transcribing','generating')` para aquele paciente) e:
  - Se `pending` → marca `status='cancelled'` (novo enum), agenda descarte imediato.
  - Se `transcribing` ou `generating` → deixa terminar (RN-10.06: "gravações passadas processadas continuam"). Loga `consent_revoked_mid_processing` para auditoria.

- **Prompts versionados** em `src/modules/ai-transcription/server/prompts/`:
  - `transcription.ts` — system instruction da transcrição.
  - `note-tcc.ts`, `note-psicanalise.ts`, `note-sistemica.ts`, `note-aba.ts`, `note-livre.ts` — system instructions por template, todos compartilhando o mesmo response schema (`GeneratedNoteSchema`).
  - Cada arquivo exporta `PROMPT_VERSION = 1` e o texto. A linha `ai_transcriptions.template_used` grava `${template}:v${PROMPT_VERSION}` para auditoria.

- **Detecção de risco** integrada no prompt da nota (o LLM retorna `palavrasRisco` como array de strings + `risk_alerts` como array de objetos com `kind`, `excerpt`, `confidence`). Sensibilidade controlada via `risk_detection_sensitivity` das settings: a instrução do prompt muda ("seja conservador" vs "sinalize qualquer indício mesmo que tênue").

- **Status `cancelled`** adicionado ao enum (migração Drizzle pequena: ALTER CHECK constraint).

- **Realtime channel** `ai-transcription:user:<userId>` (privado, RLS via Supabase Realtime).

- **Custos**: tracking opcional via colunas `transcription_cost_usd` e `llm_cost_usd` em `ai_transcriptions` (não no PRD, mas útil para `ai-transcription-settings-ui` mostrar estatística — RF-10.23). Cálculo via `response.usageMetadata.tokenCount` quando disponível, multiplicado por preço hardcoded em `lib/pricing.ts` (versionado).

- **Falhas**: cada step com Inngest retry default. Após esgotar, `status='failed'`, `error_code` taxonomizado (`gemini_429`, `gemini_5xx`, `gemini_safety_block`, `invalid_response_schema`, `consent_revoked_mid_processing`, etc.). Cron `discardOldAudios` continua descartando o áudio mesmo de jobs falhos (não retém indefinidamente). Falha 3 vezes consecutivas para o mesmo psicólogo: alerta toast/email (futuro; nesta change apenas log e métrica).

## Capabilities

### New Capabilities

- `ai-transcription-gemini-processing`: pipeline Inngest completo (`processAudioTranscription`), cliente Gemini server-only, prompts versionados por template, validação Zod de saída estruturada, integração com Gemini Files API para áudios grandes, descarte programado (`discardOldAudios`), descarte rápido de falhas (`purgeFailedAudios`), handler real de `consent.revoked` (que cancela jobs `pending`), Realtime broadcast no canal do psicólogo.

### Modified Capabilities

- `ai-transcription-data-model`: o enum de `status` em `ai_transcriptions` ganha o valor `cancelled` (CHECK reescrito). Coluna nova `transcription_cost_usd`, `llm_cost_usd` (decimal nullable). Nenhuma RLS alterada.

## Impact

- **Código** (novos arquivos):
  - `src/modules/ai-transcription/server/gemini-client.ts`
  - `src/modules/ai-transcription/server/process-audio-transcription.ts` — wrapper de alto nível chamado pela função Inngest.
  - `src/modules/ai-transcription/inngest/process-audio-transcription.ts` (função Inngest)
  - `src/modules/ai-transcription/inngest/discard-old-audios.ts` (cron)
  - `src/modules/ai-transcription/inngest/purge-failed-audios.ts` (cron)
  - `src/modules/ai-transcription/inngest/on-consent-revoked.ts` (substitui o stub de `ai-transcription-consent`)
  - `src/modules/ai-transcription/server/prompts/*.ts` (6 arquivos)
  - `src/modules/ai-transcription/server/json-schemas/gemini-note.ts` — JSON Schema do `responseJsonSchema` (Zod → JSON Schema via `zod-to-json-schema`).
  - `src/modules/ai-transcription/server/realtime/broadcast.ts` — helper para emitir no canal Realtime.
  - `src/modules/ai-transcription/lib/pricing.ts` — preços por mil tokens, versionados.
- **Código** (edits):
  - `src/shared/db/schema/ai-transcription/tables.ts` — adiciona `cancelled` ao enum, adiciona colunas de custo.
  - `src/app/api/inngest/route.ts` — registra as novas funções, remove stubs.
- **Banco**: 1 migração pequena (ALTER CHECK, ADD COLUMN ×2). Reversível.
- **Dependências**: `zod-to-json-schema` (server-only) para converter `GeneratedNoteSchema` para o formato JSON Schema do Gemini.
- **Rotas**: nenhuma.
- **Segurança**: este é o ponto onde teor sai do nosso perímetro pela primeira vez. Pseudonimização obrigatória ANTES do prompt; nome do paciente NUNCA aparece no prompt nem no log; Gemini Files API é instruída a deletar após uso; auditoria registra `template_used` mas nunca o prompt completo.
- **LGPD**: descarte em 24h tem cron real; falhas têm purga rápida; revogação real cancela `pending` (RN-10.06). Logger redacted protege RN-10.10.
