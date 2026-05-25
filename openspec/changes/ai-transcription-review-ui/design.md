## Context

A change anterior gera notas e as marca `status='ready'`. Esta change é a tela onde isso vira valor real: o psicólogo abre, lê, edita, confirma — e a nota vira EVOLUÇÃO oficial no prontuário (`evolutions` table, governado por CFP 001/2009 e Lei 13.787/2018, retenção de 20 anos). Erros aqui têm gravidade dupla: (a) salvar nota errada como evolução oficial; (b) deixar passar um alerta de risco vermelho (suicídio, autolesão). Por isso o design prioriza **visibilidade dos banners** e **fricção deliberada antes de salvar** (botão "Salvar no prontuário" requer revisão explícita do checkbox "Confirmo que revisei a nota antes de salvar").

A integração com `medical-records` é o ponto de mais responsabilidade: `createEvolutionImpl` é o factory existente. Vamos estendê-lo com parâmetros opt-in `{ aiAssisted, aiTranscriptionId }` sem quebrar callers atuais.

A rota `/dashboard/transcricoes` é NOVA dentro do route group `(app)` e o folder de URL é `dashboard/transcricoes` — portanto cai sob o `'app'` class que o `classifyPath()` atual cobre (`/dashboard*`). Verificar e adicionar testes negativos.

## Goals / Non-Goals

**Goals:**

- Fluxo de revisão claro, sem ambiguidade. Banners proeminentes (amarelo "rascunho" sempre, vermelho "risco" condicional).
- Salvar no prontuário é **ato deliberado** — checkbox de confirmação + botão; o psicólogo não consegue salvar sem confirmar.
- Edições parciais persistidas (auto-save a cada 10s com indicador "Salvo às HH:MM" — alinhado com a regra Sálvia para forms grandes).
- Indicador 🤖 na agenda sutil mas perceptível (`Badge` com ícone `Sparkles`).
- Realtime sem polling.
- Cada Server Action negative-tested.

**Non-Goals:**

- Edição rica com Tiptap. O formulário é por campo (TextArea para cada `pauta`/`conteudoTrabalhado`/etc.). Rich text pode vir depois.
- Diff visual ("você editou isso"). Salvamos `user_edits_count`, não o diff. Versionamento detalhado é responsabilidade da tabela `evolutions` (já tem version history).
- Sumarização lateral, IA "ajudar a melhorar". Esta change é só revisão; geração é da change anterior.
- Notificações por email. Realtime + UI suficiente para MVP.

## Decisions

### D1. Server Component + Client Component híbrido

**Decisão:** a página `page.tsx` faz fetch inicial via Drizzle no servidor (SSR rápido, sem hidratação pesada). Embute `<TranscriptionReviewForm initialData={...} />` que é Client Component (precisa de form state, Sonner, auto-save).

**Por quê:** padrão Next 16+ App Router que o resto do app usa.

### D2. Auto-save a cada 10s + on-blur

**Decisão:** o formulário tem auto-save a cada 10s OU on-blur de cada campo (o que vier antes), seguindo a regra Sálvia para forms grandes. `updateTranscriptionDraft` é idempotente. Indicador `"Salvo às HH:MM"` em `text-tertiary` no canto superior direito do form.

### D3. Botão "Salvar no prontuário" requer checkbox

**Decisão:** abaixo dos campos: `<Checkbox required label="Revisei a nota e confirmo que reflete a sessão." />`. Botão "Salvar no prontuário" disabled até checkbox marcado.

**Por quê:** PRD §1 explícito ("Psicólogo confiar cegamente — IA é ferramenta"). Fricção deliberada > UX fluida.

### D4. Botão "Descartar e escrever manualmente"

**Decisão:** abre `AlertDialog` perguntando "Deseja descartar esta nota IA e criar a evolução manualmente?". Se confirmado: chama `discardTranscription` + redireciona para o editor de evolução existente (`/dashboard/pacientes/[id]/evolucoes/nova?sessionId=...`).

### D5. Risk alert banner: lista trechos identificados com `kind` traduzido

**Decisão:** banner vermelho (cor `danger-50` bg, `danger-700` text) renderizado IFF `risk_alerts.length > 0`. Conteúdo: heading "⚠ Conteúdo de risco identificado" + uma lista de trechos com `kind` traduzido para pt-BR (`suicidal` → "Ideação suicida"). NÃO ofuscamos o texto — o psicólogo precisa ler. Banner exorta: "Considere: contato pós-sessão, plano de segurança, encaminhamento." (RF-10.18).

**Decisão de acessibilidade:** banner tem `role="alert"` e foco automático ao abrir a página.

### D6. Evolution table: `ai_assisted` (boolean) + `ai_transcription_id` (FK)

**Decisão:** dois campos. `ai_assisted=true` é a "marca" auditável (RF-10.16); `ai_transcription_id` é o FK opcional. FK `ON DELETE SET NULL` para que excluir uma transcrição (improvável) não derrube a evolução.

### D7. `createEvolutionImpl` ganha argumentos opcionais

**Decisão:** o factory existente recebe `{ aiAssisted?: boolean; aiTranscriptionId?: string | null }` (default `false`/`null`). Sem quebra para callers atuais.

### D8. `getTranscriptionForReview` retorna `patient.firstName` para exibição

**Decisão:** a tela mostra "Nota da sessão com {firstName}" no header. A Server Action retorna o `firstName` (já que ela tem ownership confirmado). NUNCA loga esse campo.

**Por quê:** UX (psicólogo precisa saber sobre quem é). Risco controlado: campo só sai pelo response, não pelo log.

### D9. Lista `/dashboard/transcricoes` mostra pendentes primeiro

**Decisão:** ordenação default `status='ready' AND saved_to_prontuario=false` (pendentes), depois `reviewed`, depois `failed`. Filtro simples (segmentação por aba: "Pendentes" | "Revisadas" | "Falhas"). Paginação básica.

### D10. Indicador 🤖 na agenda renderiza badge fina, não chip cheio

**Decisão:** `Badge` variante `brand` (subtle), com ícone `Sparkles` 14px, texto "Nota IA". Clicável → navega.

**Por quê:** Sálvia §"Proibições" proíbe cards aninhados e emojis na UI; usar `Sparkles` é canônico. PRD usa "🤖" no texto do requirement, mas Sálvia governa a UI: `Sparkles` é o equivalente Lucide.

## Risks / Trade-offs

- [Risco] **Psicólogo aperta "Salvar" sem ler de fato** → Mitigação: checkbox obrigatório. Não é prova de leitura, mas é fricção mínima requerida pela responsabilidade técnica (PRD §1).
- [Risco] **Banner vermelho passa despercebido em scroll longo** → Mitigação: foco automático + `role="alert"` para leitores de tela; banner é sticky no topo do form.
- [Risco] **Auto-save sobrescreve edição de outra aba** → Mitigação: `updateTranscriptionDraft` é UPDATE no JSONB inteiro (idempotente). Se duas abas editam simultaneamente, a última gravação vence. Documentado; UI pode mostrar "Nota foi atualizada em outra aba — recarregar?" se detectado via `updated_at` (futura).
- [Risco] **Realtime broadcast atrasa/perde** → Mitigação: além do broadcast, a página `/dashboard/transcricoes` revalida ao foco (`window.focus`) via TanStack Query.
- [Risco] **Adicionar `ai_transcription_id` em `evolutions` cria coupling ruim** → Mitigação: FK opcional, `ON DELETE SET NULL`. A direção da dependência segue a regra: `evolutions` (existente) referencia `ai_transcriptions` (novo) — não o contrário. Já temos `evolution_id` em `ai_transcriptions`; agora temos o reverso. Documentar a bidirecionalidade no comentário do schema.
- [Trade-off] **Sem diff visual** → aceito MVP.

## Migration Plan

1. Drizzle: ALTER TABLE `evolutions` ADD COLUMN `ai_assisted boolean NOT NULL DEFAULT false`, ADD COLUMN `ai_transcription_id uuid NULL REFERENCES ai_transcriptions(id) ON DELETE SET NULL`, CREATE INDEX `idx_evolutions_user_ai_assisted` ON `(user_id, ai_assisted)`.
2. Implementar Server Actions.
3. Estender `createEvolutionImpl`.
4. Estender `middleware.ts:classifyPath()`.
5. Implementar rotas e componentes.
6. Implementar hook Realtime.
7. Atualizar `session-card.tsx`.
8. Testes (incluindo negative-auth).

**Rollback:** seguro — colunas novas têm default; podem ser dropadas. As Server Actions são puro código.

## Open Questions

- **Q1.** O psicólogo pode salvar parcialmente (alguns campos sim, outros não)? Decisão MVP: sim, qualquer estado da nota gera uma evolução; o psicólogo é responsável.
- **Q2.** Edição posterior da evolução criada (na tela normal de prontuário) afeta `user_edits_count`? Decisão: NÃO, `user_edits_count` cobre apenas edições na tela de revisão da transcrição. Auditoria suficiente.
- **Q3.** A página `/dashboard/transcricoes/[id]/revisar` deveria ser modal/drawer (PRD usa "modal/tela")? Decisão: **página dedicada**, conforme Sálvia ("Use página dedicada para edição complexa"). Modal seria insuficiente para o formulário longo.
