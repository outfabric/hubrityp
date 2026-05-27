## Why

Com a fundação (schema, módulo, helpers) e o consent flow no lugar, falta a peça que **leva áudio para dentro do sistema**: (a) **Modo B — upload manual** de sessão presencial (RF-10.05), via Server Action que valida MIME/tamanho/extensão no servidor e grava no bucket privado; (b) **Modo A — sessão online via telepsicologia** (RF-10.04), capturando o arquivo de gravação produzido pelo Stream.io ao final da chamada, transferindo-o para o nosso bucket privado (sa-east-1) e enfileirando para processamento. Em ambos os modos a peça crítica é: **nada acontece sem `assertAiConsentActive` retornar `ok: true`**. Esta change é onde a barreira de consentimento se torna executável e auditável — sem ela, qualquer função futura de captura cairia em "vou checar depois" e o sistema vazaria.

## What Changes

- **Bucket de áudio (Modo B — upload manual)**:
  - Server Action `requestAudioUploadUrl({ patientId, sessionId, contentType, sizeBytes })`: valida consent ativo → valida `contentType ∈ { audio/mpeg, audio/mp4, audio/wav, audio/webm, audio/x-m4a }` (allowlist) e `sizeBytes ≤ AI_TRANSCRIPTION_MAX_AUDIO_MB * 1024 * 1024` → cria linha em `ai_transcriptions` (status `pending`, source `manual_upload`) → retorna signed URL POST para `ai-transcription-audio/<userId>/<transcriptionId>.<ext>` (TTL 5 min, `upsert=false`).
  - Server Action `confirmAudioUpload({ transcriptionId })`: re-valida ownership e consent ativo → consulta Storage para confirmar que o objeto existe e bate o tamanho declarado → atualiza linha com `audio_object_key`, `audio_size_bytes`, `audio_duration_seconds` (se possível via metadata) → dispara evento Inngest `ai-transcription/audio.uploaded` (Zod-validado) → retorna `{ ok: true, transcriptionId }`.
  - Validação de MIME real (não confiar no Content-Type do cliente): após upload, ler primeiros bytes do objeto via Storage SDK e bater magic numbers (libs como `file-type`); se mismatch, marcar `status = 'failed'`, `error_code = 'invalid_mime'`, agendar exclusão imediata do objeto.

- **Captura de gravação telepsicologia (Modo A)**:
  - Integração com o webhook de Stream.io que entrega o link da gravação (já existe infra em `telepsicologia/`, hoje guarda no Stream — vamos baixar do Stream para nosso bucket).
  - Função Inngest `ingestStreamRecording`: triggered por evento `telepsicologia/recording.completed` (a ser emitido pela change `telepsicologia-recording`, hoje já parcialmente presente — vamos criar o emit caso falte) → re-checa consent → baixa do Stream → faz PUT no nosso bucket → grava `ai_transcriptions` (status `pending`, source `video_session`) → dispara `ai-transcription/audio.uploaded`.
  - Backstop: se consent não está ativo no momento do webhook (revogado durante a sessão — RN-10.06), arquivo NÃO é baixado; evento NÃO é emitido; row em `ai_transcriptions` NÃO é criada; log `consent_inactive_at_ingest`.

- **Refactor de fluxo de consentimento no telepsicologia**:
  - `toggle-recording.ts` (já valida `patients.recordingConsentSignedAt` — campo legado) passa a usar `assertAiConsentActive` do módulo `ai-transcription`. As duas verificações coexistem por enquanto (defesa em profundidade); a coluna legada `recording_consent_*` será mantida (não removida nesta change para minimizar blast radius) mas a regra de "tem termo de IA?" é a nova autoridade. Documentar a transição em comentário no código.

- **Validação server-side (sempre)**:
  - Allowlist de extensão pela ÚLTIMA parte do nome (não confiar em qualquer string de input).
  - Limite de tamanho (configurável via env `AI_TRANSCRIPTION_MAX_AUDIO_MB`).
  - Duração estimada — best-effort via ffprobe (se disponível) ou via webm header parsing; aceitamos `null` quando não disponível.

- **Eventos Inngest**:
  - `ai-transcription/audio.uploaded`: payload `{ transcriptionId, userId, patientId, source: 'manual_upload'|'video_session' }`. Schema Zod definido em `ai-transcription/inngest/events.ts` (estendendo o arquivo criado em `ai-transcription-consent`).
  - Consumidor desse evento NÃO é criado aqui (fica para `ai-transcription-gemini-processing`); um stub `onAudioUploadedStub` apenas loga IDs para garantir que o evento chega.

- **UI mínima de upload (Modo B)**:
  - Componente `<AudioUploadSheet>` na ficha do paciente / na visão de sessão, com drag-and-drop, barra de progresso, mensagens de erro humanizadas. **Mostra o estado de consent e desabilita upload se `none`/`pending`/`revoked`** (consome `getAiConsentStatus`). Esta UI é o vão entre esta change e a `ai-transcription-review-ui` — aqui só capturamos; a tela de revisão da nota vem na próxima change.

- **Rate limiting**:
  - `requestAudioUploadUrl`: ≤ 6 chamadas/minuto/usuário (proteção contra enumeration e abuse).
  - Endpoint público do webhook Stream.io: validação de assinatura (HMAC com `crypto.timingSafeEqual`) ANTES de qualquer leitura do payload.

## Capabilities

### New Capabilities

- `ai-transcription-audio-upload`: Server Actions `requestAudioUploadUrl` e `confirmAudioUpload`, função Inngest `ingestStreamRecording`, eventos `ai-transcription/audio.uploaded` e `ai-transcription/recording.completed` (este último consumido pelo módulo telepsicologia para reportar fim de gravação), validação MIME server-side com magic numbers, componente UI `AudioUploadSheet`, refactor do `toggle-recording` para usar `assertAiConsentActive` em paralelo ao consent legado.

### Modified Capabilities

- `telepsicologia-recording`: a verificação de consent passa a delegar a `assertAiConsentActive`; o fim de gravação dispara `ai-transcription/recording.completed`. Sem quebra de contrato externo — apenas reforço de gating.

## Impact

- **Código**:
  - `src/modules/ai-transcription/server/request-audio-upload-url.ts` (novo).
  - `src/modules/ai-transcription/server/confirm-audio-upload.ts` (novo).
  - `src/modules/ai-transcription/server/validators/mime.ts` (novo — magic-number check).
  - `src/modules/ai-transcription/inngest/ingest-stream-recording.ts` (novo).
  - `src/modules/ai-transcription/inngest/on-audio-uploaded-stub.ts` (novo — stub).
  - `src/modules/ai-transcription/inngest/events.ts` (estendido com `audioUploadedEventSchema`, `recordingCompletedEventSchema`).
  - `src/modules/ai-transcription/components/audio-upload-sheet.tsx` (novo).
  - `src/modules/ai-transcription/components/audio-upload-button.tsx` (entry point pequeno).
  - `src/modules/ai-transcription/lib/audio-validators.ts` (Zod schemas, allowlist, helpers).
  - `src/modules/telepsicologia/server/toggle-recording.ts` (editado: também chama `assertAiConsentActive`; emite `recording.completed` ao parar).
  - `src/modules/telepsicologia/inngest/recording-cleanup.ts` (editado: ao confirmar gravação concluída do Stream, dispara `ai-transcription/recording.completed`).
- **Rotas**: nenhuma rota nova; o upload usa Server Action + signed URL (não passa por Route Handler nosso, vai direto para Supabase Storage). O webhook do Stream.io já existe.
- **Banco de dados**: nenhuma alteração de schema (tabela `ai_transcriptions` já criada em foundation). Nenhuma migração.
- **Dependências**: adiciona `file-type` (~30KB, server-only) para magic-number validation. Adiciona limite de rate-limit (reaproveita helper existente se houver, senão cria minimalista em `shared/lib/rate-limit/`).
- **Segurança**: este é o ponto onde dados sensíveis começam a entrar. Quatro camadas:
  1. Middleware/auth gating (Server Actions só rodam autenticadas via `getUser()`).
  2. Zod no boundary (input do cliente).
  3. `assertAiConsentActive` (gate de domínio).
  4. RLS de Storage + RLS da tabela `ai_transcriptions`.
  Toda Server Action tem teste negativo (anon, IDOR, sem consent, MIME inválido, tamanho excedido).
- **LGPD**: áudio entra cifrado em repouso (Supabase Storage AES-256 default) + bucket privado + signed URL TTL 5 min + descarte 24h (cron na change seguinte). Nenhum áudio em log. Nome do objeto NÃO contém PII (formato `<userId>/<transcriptionId>.<ext>`).
