## Context

PRD 10 RF-10.04 (Modo A — sessão online) e RF-10.05 (Modo B — upload presencial) precisam convergir para um único pipeline downstream. A maneira mais limpa é: **um único formato canônico de entrada** — uma linha em `ai_transcriptions` (status `pending`) + um objeto no bucket privado + um evento `ai-transcription/audio.uploaded` — produzido por DOIS caminhos diferentes. Daí pra frente a change `ai-transcription-gemini-processing` consome o evento e não precisa saber por onde o áudio entrou.

O codebase já tem o módulo `telepsicologia/` com gravação via Stream.io ativada por `toggle-recording.ts` e fim de chamada em `end-video-session.ts`. Hoje a verificação de consent usa `patients.recordingConsentSignedAt` (campo legado, vindo de PRDs anteriores). Como a change de consent introduziu `consent_terms.kind = 'ai_recording'` como a fonte da verdade, precisamos fazer o caminho do Modo A passar pelo NOVO gate (`assertAiConsentActive`). Para não criar uma janela em que telepsicologia continua confiando só no campo legado, exigimos **dois checks AND**: o legado E o novo. Defesa em profundidade durante a transição.

Stream.io grava o áudio em servidores deles. Para honrar (a) RNF-10.04 (áudio em repouso em sa-east-1) e (b) RN-10.03 (descarte garantido em 24h), precisamos **trazer o áudio para o nosso bucket** assim que o Stream sinalizar "gravação pronta". A janela em que o áudio fica no Stream antes de ser baixado é minimizada (idealmente segundos); o Stream tem a própria política de retenção, que documentamos no design mas não controlamos.

## Goals / Non-Goals

**Goals:**

- Servidor é a única autoridade sobre o que é aceito. Cliente envia "quero subir um arquivo X" → servidor valida tudo (consent, ownership, MIME via allowlist, tamanho) → servidor emite signed URL. Cliente NUNCA escolhe path nem nome do objeto.
- Validação real de MIME (magic number) APÓS o upload, antes de marcar a linha como pronta para processamento. Se mismatch, marca falha e agenda exclusão do objeto.
- Convergência de Modo A e Modo B em UM evento (`ai-transcription/audio.uploaded`) — a próxima change só precisa lidar com um trigger.
- Refactor mínimo do `toggle-recording.ts`: adicionamos a chamada ao novo helper, mantemos a checagem legada como fallback de segurança. Não derrubamos o sistema atual.
- UI mínima e funcional: drag-and-drop com feedback de progresso, mensagens em pt-BR, estados de erro humanizados.

**Non-Goals:**

- Diarização (RF-10.10 marca v2 opcional).
- Chunked upload de arquivos >200MB (limite hard via env; PRD aceita 200MB).
- Cache/CDN dos arquivos de áudio (eles vivem 24h apenas).
- Geração da nota nem chamada ao Gemini — entram em `ai-transcription-gemini-processing`.
- Remoção do campo legado `patients.recordingConsentSignedAt` — fica para futura cleanup pós-MVP.

## Decisions

### D1. Signed URL com upload direto para Supabase Storage (não proxy via Next.js)

**Decisão:** o Server Action `requestAudioUploadUrl` retorna uma signed URL gerada por `supabase.storage.from(bucket).createSignedUploadUrl(path)`. O cliente faz `PUT` direto contra Supabase Storage (sa-east-1). O servidor Next.js NUNCA toca o byte stream do áudio.

**Por quê:**

- Latência menor (cliente → Storage direto, sem hop via Vercel).
- Custo menor (Vercel cobra por egress/CPU; Storage não).
- Vercel tem timeout de 30s em Server Actions; 200MB de upload pode estourar.
- Bucket de Storage tem suas próprias políticas + criptografia em repouso por default.

**Trade-off:** validação de MIME só pode acontecer DEPOIS do upload (no `confirmAudioUpload`). Aceitamos — o objeto já vive sob nosso `userId` prefix, e em caso de mismatch deletamos antes de processar.

### D2. Allowlist de MIME tanto no input (declarado) quanto no objeto real (magic number)

**Decisão:** allowlist = `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/webm`, `audio/x-m4a`. O input do Server Action declara qual; isso é usado para gerar a signed URL (e parametrizar `contentType` do PUT). Após upload, `confirmAudioUpload` baixa os primeiros ~4KB do objeto via Storage SDK e roda `file-type` (que olha magic numbers). Se o `mime` real não bate com o declarado, a linha vira `failed` e o objeto é agendado para exclusão imediata.

**Por quê:** atacante pode tentar subir um `.exe` declarando `audio/mpeg`. Sem magic number check, o pipeline seguinte (Gemini) recebe lixo e cospe erros. Pior: o objeto fica no nosso bucket cifrado, agregando responsabilidade LGPD sem que sirva pra nada.

**Alternativa:** Storage S3-compatível conseguia rejeitar por MIME no PUT — Supabase não suporta isso server-side. Decisão é solução prática.

### D3. Magic number check em até 8KB do objeto

**Decisão:** baixamos os primeiros 8KB usando `range: 'bytes=0-8191'` do Storage SDK. Suficiente para `file-type` detectar todos os formatos da allowlist. Custa um round-trip Supabase, mas é local e barato.

### D4. Convergência via evento único `ai-transcription/audio.uploaded`

**Decisão:** os dois modos terminam emitindo o MESMO evento (com `source` distinguindo `manual_upload` vs `video_session`). A change `gemini-processing` lê um único trigger e não precisa de branches.

### D5. Modo A: baixar do Stream para nosso bucket via função Inngest

**Decisão:** quando `toggle-recording.ts` para a gravação, marca `video_recordings.status = 'processing'`. O Stream.io entrega o arquivo via webhook (ou polling — a infra atual de `recording-cleanup.ts` já lida com isso). Em vez de remover só localmente, o cleanup dispara `telepsicologia/recording.completed` com o URL do Stream. A nova função Inngest `ingestStreamRecording` consome esse evento e:

1. Re-verifica `assertAiConsentActive` (paciente pode ter revogado entre o fim da chamada e o webhook).
2. Se consent inativo: NÃO baixa; loga `consent_inactive_at_ingest`; instrui Stream a deletar a gravação (via API deles); sai.
3. Se ativo: baixa via fetch streaming → faz PUT chunked no nosso bucket sob `<userId>/<transcriptionId>.webm` → cria linha em `ai_transcriptions` (`status='pending'`, `source='video_session'`) → emite `ai-transcription/audio.uploaded`.
4. Stream.io é instruído a deletar a gravação após o download bem-sucedido.

**Por quê:** mantém uma única "porta de entrada" no nosso bucket, com nosso prefixo de `userId`, com nosso TTL.

**Trade-off:** janela de 1-2 minutos em que o áudio vive nos dois lugares (Stream + nosso bucket). Aceitável; logada para auditoria.

### D6. `toggle-recording` mantém legado + adiciona novo gate

**Decisão:** o `toggle-recording.ts` continua checando `patients.recordingConsentSignedAt` E `recordingConsentRevokedAt IS NULL`, MAS também chama `assertAiConsentActive`. SE qualquer um falhar, gravação não inicia. Comentário no código explica a transição e referencia a OpenSpec change `ai-transcription-consent`.

**Por quê:** zero janela. O dia da migração, AMBOS os flags precisam estar em conformidade. Se algum paciente tem o legado mas não tem o termo novo, gravação não inicia — admin precisa gerar o termo de IA. Documentar isso no changelog/run-book.

**Plano de cleanup:** uma change futura (`ai-transcription-consent-cleanup`) migra o estado do legado para `consent_terms` e remove os campos `patients.recording_consent_*`. Fora do escopo do MVP.

### D7. Rate limit 6 chamadas/minuto/usuário em `requestAudioUploadUrl`

**Decisão:** signed URLs custam infra. Limit basto. Usar `@upstash/ratelimit` se já presente no repo; senão, um middleware in-memory (mas isso só funciona em runtime único — em Vercel multi-instância, in-memory não basta). **Tarefa explícita:** investigar o que já existe; se nada, criar `src/shared/lib/rate-limit/` minimalista com backing por tabela Postgres (registra última chamada + count em janela móvel) — barato e correto em multi-instância.

**Alternativa:** Supabase rate-limit nativo. Não temos hoje.

### D8. Validação de duração best-effort

**Decisão:** tentamos detectar duração via `file-type`/header parsing dos primeiros KB. Se não conseguir, `audio_duration_seconds` fica `NULL`. Não bloqueia. A change de processamento Gemini pode calcular duração precisa após transcrição.

### D9. UI: drag-and-drop com `react-dropzone` ou nativo

**Decisão:** nativo via `<input type="file" accept="audio/*" />` + ondrop handlers. Evita dependência extra. Suficiente para MVP.

### D10. Upload aborta em mid-flight quando o paciente revoga (best-effort)

**Decisão:** se o cliente tem o upload em andamento E o psicólogo (em outra aba/dispositivo) revoga o consent, o `confirmAudioUpload` (chamado quando o PUT termina) detecta consent revogado e marca a linha como `failed`, agendando exclusão. Não interrompemos o PUT no meio (Storage não suporta), mas evitamos o processamento subsequente.

## Risks / Trade-offs

- [Risco] **Magic-number check falha em arquivos válidos de borda** (alguns containers WebM com headers customizados) → Mitigação: a allowlist é restrita a 5 MIMEs comuns; testes unitários do `mime.ts` cobrem amostras reais; em produção, casos não-cobertos viram `failed` e log permite ajuste.
- [Risco] **Signed URL tem TTL 5 min — uploads lentos em redes ruins falham** → Mitigação: TTL 5 min é o default; reusamos a Server Action — se expirar, o cliente pode pedir nova URL e retomar (UI dá mensagem clara). Não fazemos resume nativo nesta change.
- [Risco] **Stream.io demora a entregar o arquivo / falha** → Mitigação: a função Inngest tem 3 retries com backoff (padrão Inngest). Se persistir, marca `failed` e notifica o psicólogo (toast/email — implementação futura).
- [Risco] **Atacante autenticado faz PUT direto na signed URL para outro path** → Mitigação: o path no signed URL é fixo (`<userId>/<transcriptionId>.<ext>`); o cliente não pode alterar. Storage policy adicional bloqueia escrita fora do próprio prefixo.
- [Risco] **Webhook do Stream forjado** → Mitigação: validação de assinatura HMAC com `crypto.timingSafeEqual`. Já existente no codebase (`twilio` faz isso); replicar para Stream.
- [Risco] **Race condition: psicólogo revoga consent enquanto sessão está rolando** → Mitigação: a função `ingestStreamRecording` re-checa `assertAiConsentActive` ANTES de baixar. Se inativo nesse instante, descarta. Documentado como comportamento esperado (RN-10.06).
- [Trade-off] **Mantemos legado de `patients.recording_consent_*`** → custo: dois lugares pra ler. Benefício: zero downtime.
- [Trade-off] **Upload direto para Supabase pula a chance de scanear vírus** → aceito; o pipeline downstream (Gemini) é um processador de áudio, não roda código do payload.

## Migration Plan

1. Instalar `file-type` no `dependencies`.
2. Criar a infraestrutura de rate-limit (se ausente) ou identificar a existente.
3. Implementar Server Actions e função Inngest.
4. Refactor `toggle-recording.ts` (passo de menor risco: adicionar o novo gate em AND com o legado).
5. Refactor `recording-cleanup.ts` para emitir `recording.completed`.
6. Criar UI componentes.
7. Rodar testes de integração + e2e seeded.
8. Deploy: ordem importa — primeiro a feature flag desabilitada (verifica novos pontos de gate), depois habilita a UI gradualmente.

**Rollback:** todos os novos arquivos novos podem ser revertidos. O único edit destrutivo é em `toggle-recording.ts` (refactor); manter o commit isolado.

## Open Questions

- **Q1.** Stream.io permite mudar a região de gravação? Hoje pode estar em US. Verificar com Context7 / docs do Stream antes de fechar — se não, documentar o trade-off LGPD (áudio passou por servidor fora do BR por X minutos). **Decisão MVP:** documentar; o cliente já consentiu (termo de IA menciona explicitamente "transferência de áudio para servidores do operador").
- **Q2.** Devemos cifrar adicionalmente (envelope) o áudio antes do PUT? **Decisão:** não para MVP. Cifra padrão do Supabase + bucket privado + TTL 24h cobre RNF-10.04.
- **Q3.** Upload progress bar precisa de TanStack Query mutation com upload progress? `fetch` PUT não emite progress events. Usamos `XMLHttpRequest` (sim, ainda) por causa do `upload.onprogress`. Documentar no componente.
