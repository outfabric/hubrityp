## Context

Esta é a primeira change que escreve dados em produção e a primeira que toca uma capacidade existente (`patient-consent`). O termo de IA é um **gatekeeper**: sem ele, todo o pipeline downstream se recusa a rodar. Essa propriedade precisa ser construída no nível mais profundo possível (uma função `assertAiConsentActive` que TODO upload/gravação chama, com testes negativos que provam que falhar dela bloqueia a ação).

O codebase já tem o termo geral em `consent_terms`. Reutilizar essa tabela (com um discriminador `kind`) é mais barato que criar uma tabela paralela: o token público de assinatura, o PDF, o storage do termo assinado, o painel de listagem geral — tudo já funciona. Só precisamos diferenciar **texto** e **regra de revogação**.

Nota importante: a Resolução CFP 13/2022 exige que a revogação interrompa gravações futuras. O termo geral, em contraste, costuma ter validade durante todo o tratamento. Por isso introduzimos `revocation_takes_effect_immediately`: para `ai_recording` o valor é `true` e o helper `assertAiConsentActive` checa `revoked_at IS NULL` em toda chamada. Para o termo geral, o tratamento de revogação fica como está (gerencial, não bloqueia retroativamente).

## Goals / Non-Goals

**Goals:**

- Tornar **impossível**, por construção, gravar sem termo vigente: existe UMA função (`assertAiConsentActive`), ela é a única autoridade, e qualquer Server Action que tente capturar áudio sem chamá-la é detectada por teste de integração negativo.
- Permitir revogação imediata pelo psicólogo, com efeito retroativo na UI (botão de gravar fica desabilitado) e prospectivo no pipeline (gravações futuras param).
- Manter o token público de assinatura (`/termo/[token]`) **público** (qualquer pessoa com o link assina), mas robusto: o token é gerado server-side com `crypto.randomBytes(32).toString('base64url')`, expira em 7 dias se não assinado, e single-use.
- Texto canônico do termo é parte do código (versionado, auditado), não texto livre — o psicólogo pode complementar mas o núcleo legal (LGPD, retenção, controlador/operador, direitos do titular) é fixo.
- Migração não derruba dados de termo geral existente: backfill default `kind = 'general'` em UPDATE em massa antes do `NOT NULL`.

**Non-Goals:**

- Bloquear gravações em curso quando o consentimento é revogado. RN-10.06 diz "gravações futuras param; gravações passadas processadas continuam". Não tentamos cancelar um job Inngest já em execução nesta change. O evento `consent.revoked` é emitido para que `ai-transcription-gemini-processing` (próxima change) decida o que fazer (provavelmente: ignorar se job já passou de `transcribing`, cancelar se ainda `pending`).
- UI de listagem completa de termos. Já existe via `patient-consent`. Apenas adicionamos um painel específico de IA na ficha do paciente.
- Geração do PDF do termo de IA. Reutiliza o gerador de PDF do termo geral (PRD 02), apenas com texto diferente.
- Webhook de re-assinatura por mudança de versão do template. Versionar é importante (`template_version`), mas re-assinar a cada incremento fica para pós-MVP.

## Decisions

### D1. Discriminador `kind` na tabela existente, não tabela paralela

**Decisão:** adicionar `kind text NOT NULL DEFAULT 'general'` em `consent_terms` (CHECK em `('general','ai_recording')`). Migração faz `UPDATE consent_terms SET kind = 'general' WHERE kind IS NULL` e então `ALTER COLUMN kind SET NOT NULL`.

**Por quê:** o termo de IA tem 90% da estrutura do termo geral (psicólogo, paciente, token, assinatura, PDF). Tabela paralela duplicaria infra.

**Alternativa:** tabela `ai_consent_terms`. Rejeitada.

### D2. `revocation_takes_effect_immediately` por kind

**Decisão:** flag booleana com default `false` (geral) e `true` (ai_recording). O helper de verificação respeita esse flag:

- `kind = 'general'`: `revoked_at` é informativo; helper retorna ativo se o termo existe e foi assinado.
- `kind = 'ai_recording'`: helper retorna ativo SOMENTE se `signed_at IS NOT NULL AND revoked_at IS NULL`.

**Por quê:** uma flag em coluna é a forma mais simples de ter regras divergentes por tipo sem if-chain em todas as queries.

### D3. Helper `assertAiConsentActive` em `ai-transcription/lib/consent.ts`, não em `patients/`

**Decisão:** o helper de verificação vive no módulo `ai-transcription` (consumidor), as Server Actions de CRUD do termo vivem no módulo `patients` (produtor). Isso evita acoplamento circular: `ai-transcription/server` chamará `assertAiConsentActive` (do mesmo módulo) e essa função consultará `consent_terms` via Drizzle direto — não importará nada de `patients/`.

**Por quê:** a regra de "termo vigente" é parte do domínio de IA (retenção 24h, revogação imediata). A criação/revogação é parte da gestão de paciente.

### D4. Token: cryptographically random, 7-day expiry, single-use, time-constant compare

**Decisão:** `crypto.randomBytes(32).toString('base64url')` (256 bits). Coluna `token_expires_at = signed_at IS NULL ? created_at + 7 days : NULL`. Lookup público usa `crypto.timingSafeEqual` para evitar timing attack (na verdade, como o token é o lookup key e tem 256 bits de entropia, timing attack é teórico — mas implementar mesmo assim como defesa em profundidade).

**Por quê:** já é o padrão de tokens públicos no repo (auth callback, public confirm session). Manter consistência.

### D5. Texto canônico em código, não em DB

**Decisão:** `src/modules/ai-transcription/lib/consent-template.ts` exporta `AI_CONSENT_TEMPLATE_V1: { version: 1; title: string; sections: Array<{ heading: string; body: string }> }`. Server Action `generateAiConsentTerm` grava `template_version = 1` e o **snapshot** do texto exibido — assim, se o template mudar, o paciente que já assinou continua vinculado ao texto V1.

**Por quê:** auditoria. Texto pode ser revisado pelo legal team. Permitir que "o termo mudou e meu paciente agora está sujeito a outras cláusulas" seria uma falha de governança.

### D6. Evento Inngest `ai-transcription/consent.revoked`

**Decisão:** emitir já nesta change com payload Zod-validado: `{ termId, userId, patientId, revokedAt, reason }`. Consumidor é stub (função que apenas loga) — será preenchido em `ai-transcription-gemini-processing`. Padrão fire-and-forget igual ao das changes de agenda.

**Por quê:** acoplamento via eventos. Decoupling between this change and the processing change.

### D7. Painel mínimo na ficha do paciente

**Decisão:** componente `AiConsentPanel` que mostra três estados:

- "Sem termo de gravação por IA" + botão `[Gerar termo]`
- "Termo gerado, aguardando assinatura — enviar link: {link}" + botão `[Copiar link]` + `[Reenviar]`
- "Termo assinado em DD/MM/YYYY" + botão `[Revogar]`

Após revogar: volta ao estado "Sem termo".

**Por quê:** mínimo para o psicólogo ter onde clicar. UI mais rica (lista de revisões, histórico de revogações) é evolução pós-MVP.

### D8. RLS — reaproveita policy existente de `consent_terms`

**Decisão:** as policies atuais (`user_id = auth.uid()`) cobrem o novo `kind` sem mudança. Nenhuma policy nova.

**Verificação:** teste de integração negativo: psicólogo B tenta `SELECT * FROM consent_terms WHERE kind = 'ai_recording' AND patient_id = (paciente de A).id` → zero linhas.

### D9. Inngest module skeleton — criado nesta change

**Decisão:** `src/modules/ai-transcription/inngest/client.ts` e `src/modules/ai-transcription/inngest/events.ts` criados aqui, com apenas o evento `ai-transcription/consent.revoked` definido. As funções (`audio-uploaded`, `discard-audio`, etc.) serão adicionadas pelas changes seguintes. O cliente é registrado em `src/app/api/inngest/route.ts` agora — o consumidor stub permite testes de fluxo end-to-end mesmo sem o processamento real.

## Risks / Trade-offs

- [Risco] **Esquecer de chamar `assertAiConsentActive` numa Server Action futura** → Mitigação: a primeira tarefa da change `ai-transcription-audio-upload` será adicionar um ESLint custom rule "qualquer arquivo em `ai-transcription/server/**` que importe `aiTranscriptions` (tabela de inserts) DEVE também importar `assertAiConsentActive`". Não cobre 100% mas pega o caso comum. Além disso, **teste de integração negativo é mandatório**: tentar gravar sem termo vigente DEVE falhar.
- [Risco] **Tornar a coluna `kind` `NOT NULL` quebra rows existentes** → Mitigação: a migração faz `UPDATE` antes de `SET NOT NULL`. Backfill é seguro porque o único `kind` possível na produção atual é `general`.
- [Risco] **Token leaked via Referer ao paciente clicar em link externo** → Mitigação: configurar `Referrer-Policy: no-referrer` na rota `/termo/[token]` via `next.config.ts` (per-route header) ou via `<meta>` tag na page específica. Adicionar a configuração no `next.config.ts`.
- [Risco] **Texto do termo está errado / não cobre LGPD adequadamente** → Mitigação: o conteúdo do template é revisado pelo PRD 10 + LGPD art. 7º II e art. 11. Tarefa explícita: "Antes do merge, advogado/responsável legal valida o texto. Documentar em PR description."
- [Trade-off] **Revogação não cancela jobs em curso** → Aceito (RN-10.06 explícita). A future change pode adicionar.
- [Trade-off] **Sem re-assinatura por bump de versão** → Aceito para MVP.

## Migration Plan

1. Generate Drizzle migration: adicionar 4 colunas (`kind`, `revocation_takes_effect_immediately`, `revocation_reason`, `template_version`) em `consent_terms`. Inicialmente `kind` é NULLABLE.
2. Backfill: `UPDATE consent_terms SET kind = 'general', revocation_takes_effect_immediately = false WHERE kind IS NULL`.
3. `ALTER COLUMN kind SET NOT NULL` + CHECK `kind IN ('general','ai_recording')`.
4. Adicionar índice `(user_id, patient_id, kind, revoked_at)` para a lookup do helper.
5. Rodar `npm run db:migrate`; testes de integração rodam contra Postgres real para verificar.

**Rollback:** migração reversível por Drizzle Kit. O `kind` pode voltar a NULLABLE sem perda; as novas colunas podem ser dropadas (perde dados de termos de IA, mas no MVP isso é aceitável).

## Open Questions

- **Q1.** Quando `revocation_reason` é exibida? Decisão MVP: campo livre opcional, exibido só no painel administrativo do psicólogo (não para o paciente). Histórico fica para evolução pós-MVP.
- **Q2.** O termo de IA precisa de assinatura ICP-Brasil? CFP 13/2022 exige consentimento "por escrito"; assinatura eletrônica simples (Lei 14.063/2020) cobre. ICP-Brasil **não** é obrigatório nesse contexto. Decisão MVP: assinatura simples, com captura de `signed_ip` (hash), `signed_user_agent` (hash) e `signed_at` para evidência. ICP-Brasil pode ser opt-in pós-MVP.
- **Q3.** Quando o paciente perde acesso ao link (token expirou): UI mostra "Link expirado. Solicite ao psicólogo um novo link." Server Action `generateAiConsentTerm` permite regerar quando o termo anterior está `revoked` ou `expired`.
