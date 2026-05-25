## Context

PRD 10 quer reduzir o tempo de registro de evolução de 10 min para 1-2 min por sessão, com transcrição automática (Gemini), nota estruturada (LLM) e revisão humana obrigatória do psicólogo. Cinco changes downstream cobrirão consent, captura, processing assíncrono, UI de revisão e UI de configurações. Antes delas, precisamos de um conjunto de fundações estáveis para que as outras não fiquem refazendo decisões básicas (forma do schema, formato da nota, contrato com Gemini, política de logs, política de descarte).

O codebase já possui um padrão sólido a copiar: `whatsapp/` mistura `inngest/`, `components/`, `lib/`, `server/`; `telepsicologia/` expõe `edge.ts` porque é tocado pelo middleware (`postgres-js` quebra Edge runtime); `medical-records/` é o destino das evoluções geradas (`ai_assisted = true` será gravado lá em change subsequente). Stack confirmada nas docs Context7: `@google/genai` é o SDK atual (não `@google/generative-ai`), modelos disponíveis são `gemini-3.5-flash` (default) e variantes preview — o PRD menciona "Gemini 3 Flash", então usaremos o nome estável `gemini-3.5-flash` como default e deixaremos os modelos serem trocáveis por env.

Restrições mandatórias que moldam esta fundação:
- LGPD art. 11 (dado sensível de saúde) + CFP 13/2022 (gravação só com termo) + sigilo profissional.
- Áudio em repouso ≤24h (RN-10.03), TLS 1.3 em trânsito (RNF-10.03), AES-256 em repouso (RNF-10.04 — Supabase Storage faz isso por default em buckets privados).
- Logs sem teor (RN-10.10) — controle de raiz, não decoração.
- Pseudonimização antes do prompt (RN-10.08) — nome real do paciente NUNCA sai daqui.
- Controlador (psicólogo) / Operador (Gemini) documentado.

## Goals / Non-Goals

**Goals:**

- Modelar o estado do recurso `ai_transcriptions` cobrindo todo o ciclo de vida descrito no PRD (status `pending → transcribing → generating → ready → reviewed → failed`) sem precisar de migrações destrutivas nas changes seguintes.
- RLS habilitada com 4 policies (S/I/U/D) escopadas em `auth.uid()` desde a migração inicial — nenhuma policy `USING (true)`, nenhuma janela aberta de "vou adicionar RLS depois".
- Bucket privado `ai-transcription-audio` com nomenclatura de objeto que carrega `user_id` no prefixo (`<userId>/<transcriptionId>.<ext>`) para que policies de Storage também consigam isolar tenants.
- Helpers compartilhados que tornam impossível, por construção, vazar teor ou nome de paciente: `pseudonymizeTranscript` antes do prompt, `createTranscriptionLogger` que serializa pino com `redact` para campos como `transcript`, `generatedNote`, `patientName`, `audioUrl`.
- Edge-safe boundary (`edge.ts`) pronto desde o início — o middleware ainda não consome, mas as changes de UI (review-ui, settings-ui) vão.
- Configuração de modelos Gemini, bucket e TTL parametrizáveis via env, validadas no boot (Zod), com defaults seguros.

**Non-Goals:**

- Nenhuma Server Action de produto (criar transcrição, salvar nota, etc.) — fica para `ai-transcription-audio-upload` e seguintes.
- Nenhum job Inngest (incluindo o de descarte 24h) — fica para `ai-transcription-gemini-processing` (que adiciona a função de processamento E o cron de descarte como artefatos coesos do mesmo pipeline).
- Nenhuma rota nova nem mudança em `middleware.ts:classifyPath()` — as rotas só nascem em `ai-transcription-review-ui` e `ai-transcription-settings-ui`.
- Nenhuma UI.
- Nenhuma alteração nas tabelas `evolutions`, `sessions` ou `patients` existentes — flags como `ai_assisted` em `evolutions` serão adicionadas na change de review-ui, quando o vínculo for criado.
- Nenhuma análise de sentimento, diarização ou detecção de risco (a detecção de risco é prompt do LLM, não regra desta fundação).

## Decisions

### D1. Nome do módulo: `ai-transcription` (não `transcricao-ia`)

**Decisão:** o folder do módulo segue o padrão inglês adotado pelo codebase (`agenda`, `patients`, `medical-records`, `telepsicologia` é a exceção por força do PRD). Microcopy de UI será em pt-BR (Skill Sálvia / PRD 00 §9), mas identificadores de código são em inglês.

**Alternativa considerada:** `transcricao-ia`. Rejeitada porque destoa do resto (`medical-records`, `password-recovery`).

### D2. Duas tabelas, FKs nullable

**Decisão:** `ai_transcription_settings` (1:1 com `users`, configurações por psicólogo) + `ai_transcriptions` (1:N, uma linha por sessão processada).

- `ai_transcriptions.session_id` é **nullable** porque o PRD admite upload manual de presencial sem ainda ter sessão vinculada (RF-10.05). UI/Server Actions impõem o vínculo quando aplicável.
- `ai_transcriptions.evolution_id` é **nullable** e só é preenchido quando o psicólogo aceita salvar a nota no prontuário (RF-10.16). FK é `ON DELETE SET NULL` para que ao excluir uma evolução não derrubemos o histórico de transcrição.
- `ai_transcriptions.patient_id` é **NOT NULL** porque sem paciente não há termo de consentimento válido (RF-10.06).
- `ai_transcriptions.user_id` é **NOT NULL** (escopo RLS).

**Alternativa considerada:** tabela única com configurações JSONB. Rejeitada — auditoria fica mais difícil, queries de cron de descarte ficam mais caras.

### D3. Campos `generated_note` e `risk_alerts` como `jsonb`, validados por Zod no boundary

**Decisão:** `generated_note jsonb` e `risk_alerts jsonb` armazenam a saída estruturada do LLM (template TCC, psicanálise, sistêmica, livre — alinhado com PRD 05). O schema Zod canônico (`generatedNoteSchema`, `riskAlertSchema`) vive em `lib/` desta change e é o único caminho de leitura/escrita — leituras passam por `safeParse` para detectar drift.

**Por quê:** o PRD lista chaves específicas (humor_inicial, humor_final, pauta, conteudo_trabalhado, tarefa_casa, palavras_risco, observacoes_extras), mas a evolução por template (TCC vs psicanálise) torna a forma variável. JSONB + Zod no boundary entrega flexibilidade com tipagem forte na Server Action.

**Trade-off:** queries SQL não conseguem filtrar por campo dentro do JSON sem `->>`. Aceitamos — não há requisito de filtrar transcrições por "humor inicial > 7".

### D4. Bucket de áudio privado com prefixo `<userId>/<transcriptionId>`

**Decisão:** bucket `ai-transcription-audio` privado, RLS de Storage policy `(storage.foldername(name))[1] = auth.uid()::text` para SELECT/INSERT/DELETE. Service-role bypassa RLS e é o único caminho legítimo para o job Inngest de descarte (justificado em comentário no código).

**Alternativa:** bucket por tenant. Rejeitada — Supabase recomenda buckets globais com path-based scoping; multiplicar buckets escala mal.

### D5. SDK: `@google/genai` (server-only) com `import 'server-only'` no arquivo de cliente

**Decisão:** instalar `@google/genai` no `dependencies` (não devDependencies, porque o pipeline real é runtime). O cliente concreto será criado em `ai-transcription-gemini-processing`, mas a env var (`GEMINI_API_KEY`) é definida agora porque é pré-condição de boot. O cliente, quando criado, terá `import 'server-only'` no topo.

**Alternativa considerada:** SDK depreciado `@google/generative-ai`. Rejeitado (Skill `gemini-api-dev` é taxativa: deprecated).

### D6. Modelos default por env, não hardcoded

**Decisão:** `GEMINI_MODEL_TRANSCRIPTION` e `GEMINI_MODEL_NOTE` são variáveis de env separadas (default ambos `gemini-3.5-flash`) com schema Zod aceitando strings que começam com `gemini-` ou `gemma-`. Permite trocar para `gemini-3.1-pro-preview` quando QA pedir, sem deploy de código.

### D7. Pseudonimização determinística e reversível-localmente (mas não para o LLM)

**Decisão:** `pseudonymizeTranscript({ patientFirstName, patientFullName, transcript }): string` faz `replaceAll` case-insensitive das ocorrências por `"Paciente"`. Substituição feita **antes** de qualquer chamada Gemini.

- A substituição é one-way para o LLM (nada volta).
- O log do job grava apenas o **hash SHA-256** do nome (`hashEmail`-style helper) para conseguir correlacionar incidentes sem expor o nome.

**Trade-off:** se o paciente se chama "Paulo" e a sessão fala da "rua Paulo Afonso", trocaremos os dois. Aceitamos no MVP — PRD reconhece que IA pode confundir; psicólogo revisa.

### D8. Logger com redact

**Decisão:** `createTranscriptionLogger()` retorna um wrapper de `pino` com `redact: { paths: ['transcript', 'generatedNote', 'riskAlerts', 'patientName', 'audioUrl', 'rawGeminiResponse'], censor: '[REDACTED]' }`. O logger é o único oferecido pelo barrel do módulo — para o developer que vai implementar as changes downstream, é mais fácil usar o redator do que importar pino direto.

### D9. Migração: RLS na MESMA migração que cria a tabela

**Decisão:** uma única migração SQL que faz `CREATE TABLE` + `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` × 4 por tabela. Não dividimos em "migração 1 cria, migração 2 fecha". Janela aberta = bug.

### D10. Sem cron de descarte aqui

**Decisão:** o cron de descarte 24h (RN-10.03 / RNF-10.06) **NÃO** entra nesta change. Entra em `ai-transcription-gemini-processing` junto com a função Inngest principal — eles compartilham a mesma estrutura de `inngest/` e a mesma lógica de "quando uma transcrição completa, marcar `audio_discarded_at`".

**Por quê:** o cron precisa do bucket E da lógica de processing E de uma fonte de áudios para de fato testar. Aqui só temos o esquema. Adicioná-lo agora violaria o princípio de coesão das changes.

**Mitigação do gap:** a coluna `audio_discarded_at` nasce nesta fundação; o índice parcial `WHERE audio_url IS NOT NULL AND audio_discarded_at IS NULL` também — pronto para o job consumir na próxima change.

## Risks / Trade-offs

- [Risco] **Mudar a forma do `generated_note` jsonb depois quebra dados antigos** → Mitigação: schema Zod com `.passthrough()` + versioning explícito (`generated_note.schemaVersion`) já gravado nesta change.
- [Risco] **Esquecer de habilitar RLS na migração** → Mitigação: a tasks.md exige um teste de integração com Testcontainers que cria duas sessões Supabase de tenants diferentes e prova que B não enxerga linhas de A. Sem esse teste, a change não fecha.
- [Risco] **Vazar nome de paciente em log de erro do Gemini** → Mitigação: `pseudonymizeTranscript` antes do prompt + `redact` no logger + teste unitário que serializa um payload contendo `patientName` e prova que sai `[REDACTED]`.
- [Risco] **`@google/genai` adiciona ~MB ao bundle se importado no client** → Mitigação: `import 'server-only'` no futuro `gemini-client.ts` E ausência total de imports do SDK em arquivos sob `components/`. ESLint rule já bloqueia `process.env` fora do allowlist; quebrar isso exigiria pré-meditação.
- [Risco] **Drizzle Kit não gerar a SQL de policies por enquanto está em beta** → Mitigação: escrevemos as policies em SQL puro num arquivo `policies.sql` e o `policies.ts` apenas referencia-o + temos teste de integração que verifica via `pg_policies` que todas as 8 policies (2 tabelas × 4 ops) existem.
- [Trade-off] **Bucket único com path scoping vs bucket-por-tenant** → escolhemos único; ganha-se simplicidade operacional, perde-se um leve isolamento. RLS de Storage compensa.
- [Trade-off] **Pseudonimização naive (replaceAll)** → assume nomes raros. Falsos positivos possíveis (paciente "Paulo" + rua "Paulo Afonso"). Aceito no MVP; PRD reconhece IA falha e psicólogo revisa.

## Migration Plan

1. Adicionar `@google/genai` ao `package.json` e instalar.
2. Estender `src/shared/env/schemas.ts` com as 6 novas chaves; atualizar `.env.example` (e local docker compose) com defaults seguros (não a chave real — usar comentário "obter no console do Google AI Studio").
3. Criar o folder `src/shared/db/schema/ai-transcription/` com `tables.ts`, `policies.ts` (SQL helpers), `index.ts`.
4. Re-exportar no `src/shared/db/schema/index.ts`.
5. `npm run db:generate` para gerar a migração; revisar SQL para garantir que `ENABLE ROW LEVEL SECURITY` e `CREATE POLICY` × 8 estão na mesma migração. Adicionar manualmente a criação do bucket Storage (Supabase usa SQL: `INSERT INTO storage.buckets ...`) e suas policies.
6. `npm run db:migrate` localmente; rodar testes de integração que provam RLS isolando tenants.
7. Criar o folder `src/modules/ai-transcription/` com `index.ts`, `edge.ts`, `lib/`, `server/index.ts` placeholder.
8. Criar o logger e o helper de pseudonimização com testes unitários.

**Rollback:** a migração é reversível — Drizzle Kit gera `down.sql` automaticamente. O bucket de Storage é dropado por SQL manual. Nenhuma alteração quebra dados existentes (todas as tabelas/buckets são novos).

## Open Questions

- **Q1.** O bucket de Storage deveria ter retention rule de bucket-level (24h)? Supabase Storage não suporta TTL nativo — precisaremos do cron Inngest da change seguinte. Documentado nesta fundação como dependência explícita.
- **Q2.** Em algum momento o psicólogo poderá manter o áudio por mais que 24h ("auditoria com consentimento extra" — RN-10.03 menciona "configurável"). O campo `keep_audio_days` em `ai_transcription_settings` cobre isso; a lógica do cron honrará. UI para escolher entra em `ai-transcription-settings-ui`.
- **Q3.** Vamos cifrar o áudio adicionalmente (envelope encryption) por cima da cifra do Storage? **Decisão MVP:** não. A cifra padrão do Supabase Storage (AES-256 em repouso) + bucket privado + URL assinada de 5 min cobre RNF-10.04. Envelope encryption fica como evolução pós-MVP (anotado no `design.md` para não esquecer).
