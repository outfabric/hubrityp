## Context

PRD 10 estabelece <5 min de latência para sessão de 50 min (RNF-10.01), retries 3x para falhas Gemini (critério de aceitação), pseudonimização (RN-10.08), zero teor em logs (RN-10.10), descarte 24h (RN-10.03/RNF-10.06). O design tem que entregar tudo isso E ser resiliente a falhas reais do Gemini (rate-limit, safety blocks, schema drift, timeouts).

A skill `gemini-api-dev` e o Context7 confirmam: o SDK correto é `@google/genai` (já adicionado em foundation). Modelos atuais incluem `gemini-3.5-flash` (default). Arquivos grandes vão pela Files API (`ai.files.upload`); o token de retorno é uma URI usada em `createPartFromUri`. `responseMimeType: 'application/json'` + `responseJsonSchema` garante saída estruturada validável. Files API permite `ai.files.delete` para reduzir retenção do operador.

Inngest é a escolha do projeto para jobs assíncronos (já em produção). Padrão de `step.run()` com retries independentes por step é a maneira correta de modelar este pipeline — cada step que pode falhar isoladamente (download, upload Gemini, transcrição, geração da nota) tem seu próprio counter de retry. `NonRetriableError` é usado para erros conhecidos como permanentes (consent revogado, schema inválido após N tentativas).

Supabase Realtime existe no codebase; usar para empurrar `ready` para o frontend evita polling.

## Goals / Non-Goals

**Goals:**

- Pipeline observável e fail-safe: cada step idempotente, retries por step, status persistido após cada transição, descarte do áudio garantido mesmo em failure.
- Pseudonimização **antes** de qualquer chamada Gemini para a nota (a transcrição inicial é "transcreva pt-BR" sem nome — não tem como pseudonimizar antes de transcrever; mas o segundo chamado, do prompt da nota, recebe a transcrição já pseudonimizada).
- Saída do LLM **sempre** valida o `GeneratedNoteSchema` Zod; drift detectado vira `error_code='invalid_response_schema'`, retry, e em última instância `status='failed'`.
- Custo aproximado registrado (tokens × preço) para a UI de stats.
- Realtime entrega `ready` sem polling.

**Non-Goals:**

- Streaming da transcrição (UI vai ver a nota só quando estiver pronta). Suficiente para MVP — latência <5 min e UX assíncrona já é aceitável.
- Tradução. PRD MVP é pt-BR.
- Diarização (RF-10.10 v2). Os timestamps são ativados, mas a saída atual da nota não diferencia falantes.
- Cancelamento de jobs em andamento (transcribing/generating) por consent revogado — RN-10.06 explicitamente NÃO exige isso.
- Análise emocional (excluída do escopo no PRD §3).

## Decisions

### D1. Gemini Files API para áudios >20MB; inline base64 para menores

**Decisão:** o threshold é 20MB (limite inline da API). Acima disso, sempre Files API. Para uniformidade e simplicidade, podemos **sempre** usar Files API independente de tamanho (apenas mais um round-trip), mas isso adiciona latência em áudios curtos. Decisão: branch por tamanho.

**Por quê:** Files API tem retenção própria de 48h do lado do Gemini. Não queremos áudio lá mais que o necessário. `ai.files.delete` chamado no step `delete-gemini-file` reduz isso a "tempo de processamento + cleanup".

### D2. Dois prompts (transcrição + nota) vs um único multi-modal

**Decisão:** dois prompts. (1) Transcreva pt-BR. (2) Recebe a transcrição pseudonimizada + template + sensibilidade de risco, retorna nota estruturada + alertas.

**Por quê:**
- A pseudonimização precisa rodar entre os dois — não dá pra pseudonimizar áudio.
- Custos: o segundo prompt é puramente texto (mais barato).
- Falhas isoláveis: se a transcrição passou e a nota falhou, dá pra retentar só a segunda.
- Auditoria: o que foi enviado em cada chamada fica mais claro.

**Alternativa:** um único `generateContent` com áudio + system prompt complexo. Rejeitada — pseudonimização fica impossível, e qualquer falha derruba tudo.

### D3. `responseMimeType: 'application/json'` + `responseJsonSchema`

**Decisão:** o Gemini gera JSON estruturado. Convertemos `GeneratedNoteSchema` (Zod) para JSON Schema via `zod-to-json-schema` no boot do módulo (cached). Passamos como `responseJsonSchema`. Depois validamos a saída via `GeneratedNoteSchema.safeParse(JSON.parse(response.text))`.

**Por quê:** double-defense. Gemini geralmente respeita o schema mas pode driftar; nosso Zod garante que nada inválido entra no DB.

### D4. Pseudonimização "shallow": substitui nome e sobrenome do paciente

**Decisão:** o helper já criado em `foundation` (`pseudonymizeTranscript`) cobre. **Bug de borda conhecido:** se o paciente menciona uma terceira pessoa pelo nome (mãe, parceiro), o LLM recebe esse nome. PRD assume isso e o termo de IA cobre legalmente.

### D5. Status `cancelled` adicionado, não reaproveitado

**Decisão:** novo valor no enum CHECK. `cancelled` é estritamente "consent revogado antes do processamento começar" (e job foi marcado dessa forma pelo `onConsentRevoked`). `failed` é qualquer outra falha. Distinção facilita UI ("Cancelada pelo paciente" vs "Falhou — tente novamente").

### D6. Cron `discardOldAudios` rodando a cada 1h, não 24h

**Decisão:** o cron roda **a cada 1h**, mas só apaga áudios cujo `created_at < now() - (settings.keep_audio_hours || 24)`. Resultado: descarte real ocorre dentro de uma janela de 24h–25h. RN-10.03 diz "em até 24h"; aceitamos a pequena folga em troca de não precisar cron mais agressivo.

**Por quê:** rodar diário é arriscado (se o cron falha, perdemos 24h adicionais). Hourly + filtro temporal converge rápido após falhas.

### D7. Cron `purgeFailedAudios` rodando a cada 1h, descarta failed >1h

**Decisão:** áudios em `failed` ou `cancelled` que ainda têm `audio_object_key` não-nulo são descartados após 1h em estado terminal. Não há razão para reter algo que nunca virou nota.

**Por quê:** redução agressiva de superfície LGPD para arquivos sem uso clínico.

### D8. Realtime broadcast

**Decisão:** `supabase.channel('ai-transcription:user:' + userId).send({ type: 'broadcast', event: 'ready', payload: { transcriptionId } })`. Cliente assina o canal no layout do dashboard.

**Por quê:** zero polling, latência sub-segundo.

**Alternativa:** SSE custom. Rejeitada — Supabase Realtime já está em uso.

### D9. Sensibilidade de risco mapeada a instrução no prompt

**Decisão:** `risk_detection_sensitivity: 'low'` → "sinalize APENAS menções explícitas e literais"; `'medium'` (default) → "sinalize menções diretas e fortes hipóteses"; `'high'` → "sinalize qualquer indício mesmo tênue". A diferença é só a system instruction.

**Por quê:** simples, sem precisar ajustar `temperature` ou outros knobs.

### D10. `temperature: 0.2` para a nota; `temperature: 0.1` para transcrição

**Decisão:** transcrição precisa ser literal (baixa temperatura). Nota precisa de leve flexibilidade ao parafrasear sem fabricar. Valores conservadores conscientemente.

**Por quê:** alucinação é o pior cenário (PRD §1). Baixa temperatura é a mitigação principal.

### D11. Safety settings: relaxar `HARASSMENT` e `HATE_SPEECH`

**Decisão:** sessões clínicas mencionam violência, suicídio, abuso — conteúdo legítimo da nota. Default safety blocks frequentemente bloqueariam. Configurar `safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' }, { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' }, ...]`. Não desabilitamos completamente; setamos para "block only high" para reduzir falsos positivos.

**Por quê:** sem isso, `generateContent` retorna `safety_block` em uma fração não-trivial de sessões reais e o pipeline trava.

### D12. Custo opcional, fallback elegante

**Decisão:** se `response.usageMetadata` está disponível, registramos. Se não (versão do SDK, modelo experimental), `transcription_cost_usd = NULL`. UI de stats lida com null.

### D13. Idempotência

**Decisão:** cada step persiste seu efeito (status DB). Re-execução do step lê estado atual; se já está no estado-alvo, NO-OP. Garante que retries Inngest não criam duplicatas.

Especificamente: o step `persist-note` é `UPDATE ... WHERE status IN ('generating')` — se já é `ready`, UPDATE retorna 0 rows e o step é NO-OP.

## Risks / Trade-offs

- [Risco] **Gemini 429 (rate limit) em horário de pico** → Mitigação: Inngest retry com backoff exponencial (4 retries, 30s/2min/8min/32min). Após esgotar, `error_code='gemini_429'`. Estimar volume real e provisionar tier pago se necessário (fora de escopo desta change; documentar custo em PR).
- [Risco] **Gemini retorna JSON inválido apesar do schema** → Mitigação: `GeneratedNoteSchema.safeParse`; se falha, retry. Após 3 falhas seguidas, `error_code='invalid_response_schema'`, `status='failed'`.
- [Risco] **Áudio NÃO foi descartado em 24h por falha do cron** → Mitigação: o cron é Inngest scheduled function com 4 retries; alerta se 3 execuções consecutivas falharem (monitoramento Inngest). Tarefa: configurar alerta no painel Inngest.
- [Risco] **Safety block legítimo (conteúdo realmente extremo)** → Mitigação: `error_code='gemini_safety_block'`. UI vai informar o psicólogo e oferecer "tente escrever manualmente". Áudio descartado normalmente.
- [Risco] **Custo descontrolado** → Mitigação: registrar custo por linha; UI mostra; alerta admin se média semanal sobe >X% (fora de escopo aqui, mas a coluna é prep).
- [Risco] **LLM "alucina" — gera fato que não estava na sessão** → Mitigação: temperature baixa, system instruction explícita ("Não invente conteúdo. Se algo não foi dito, escreva [não mencionado]"), psicólogo é o último filtro (revisão obrigatória — `saved_to_prontuario = false` até ele clicar — change seguinte).
- [Risco] **Pipeline lento — UX ruim** → Mitigação: Realtime broadcast; UI mostra indicador "Processando..." sem bloqueio.
- [Risco] **Áudio passa por servidor Gemini fora do BR (LGPD)** → Mitigação: termo de IA documenta isso explicitamente; psicólogo é controlador, Gemini é operador. Não é uma falha do nosso design — é o trade-off documentado.
- [Trade-off] **Não cancelamos jobs em curso ao revogar consent** → aceito (RN-10.06).

## Migration Plan

1. Drizzle: ALTER CHECK do enum `status` para incluir `cancelled`; ADD COLUMN `transcription_cost_usd` e `llm_cost_usd` (numeric, nullable).
2. Instalar `zod-to-json-schema`.
3. Implementar `gemini-client.ts` com `import 'server-only'`.
4. Implementar prompts e schemas.
5. Implementar a função `processAudioTranscription` (steps).
6. Implementar crons `discardOldAudios`, `purgeFailedAudios`.
7. Substituir o stub `onConsentRevokedStub` (registrado em `ai-transcription-consent`) por `onConsentRevoked` real.
8. Registrar todas as funções em `src/app/api/inngest/route.ts`. Remover o stub `onAudioUploadedStub`.
9. Testes integração com MSW para Gemini.
10. Testes e2e seeded com Gemini totalmente mockado.

**Rollback:** a migração é reversível. Se o pipeline tem bug em produção, podemos desativar a função Inngest via painel (sem deploy); jobs em fila ficam aguardando. Áudios continuam sendo descartados pelo cron mesmo sem o processamento — desejável.

## Open Questions

- **Q1.** Devemos cachear o `responseJsonSchema` (`responseJsonSchemaConverted`) entre invocações? **Decisão:** sim, top-level const no módulo (cached na primeira import). Re-converte só em hot-reload.
- **Q2.** Quantos retries para o pipeline inteiro? **Decisão:** confiar nos retries por step do Inngest (default 4 cada). O pipeline inteiro não tem retry global — se step terminal falha, marca `failed`.
- **Q3.** Como o psicólogo vê uma falha? **Decisão:** UI da change seguinte (`review-ui`) renderiza um card de "Falhou — motivo: <human label>" com botão "Tentar de novo" que re-dispara `audio.uploaded`. Esta change deixa o evento idempotente.
- **Q4.** Áudios longos (>2h) — chunking? **Decisão:** PRD edge case menciona. MVP: a Gemini Files API aceita arquivos grandes até ~1h de áudio. Para >1h, marcamos `error_code='audio_too_long'` e instruímos psicólogo a dividir em arquivos. Não chunking automático.
