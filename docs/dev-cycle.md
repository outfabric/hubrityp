# /dev-cycle — Workflow de desenvolvimento de ciclo fechado

Documento de referência do orquestrador `/dev-cycle`, o slash command que coordena os três subagents do projeto (`fullstack-developer`, `code-reviewer`, `qa-tester`) sobre uma change OpenSpec até o PR estar aberto.

---

## 1. Visão geral

O HubrityP usa três subagents especializados:

- **`fullstack-developer`** — implementa código e testes (Next.js / Supabase / Drizzle / etc.).
- **`code-reviewer`** — faz code review do diff da branch contra `main`, com severidades `BLOCKER` / `HIGH` / `MEDIUM` / `NIT` / `PRAISE`.
- **`qa-tester`** — testa visualmente a aplicação no navegador (Playwright MCP), com severidades `CRÍTICO` / `ALTO` / `MÉDIO` / `BAIXO` / `INFO`.

Sem orquestração, esses agents operam de forma isolada: o usuário precisa invocar manualmente cada um, decidir quando passar do um para o outro, gerenciar o worktree, criar commits e abrir o PR. O ciclo "implementação → revisão → QA → entrega" fica frouxo e suscetível a esquecimento.

`/dev-cycle <change-name>` fecha esse ciclo: consome uma change OpenSpec já planejada, dirige os agents nas posições e gates corretos, aplica caps de iteração para evitar loops infinitos, e termina com um PR aberto e evidência salva.

---

## 2. Diagrama do fluxo

```
                      ┌─────────────────────────┐
        usuário ───▶  │ /dev-cycle <change>     │  (slash command, executado pelo Claude principal)
                      └────────────┬────────────┘
                                   │ orquestra (Agent tool)
       ┌───────────────────────────┼────────────────────────────┐
       ▼                           ▼                            ▼
┌────────────────┐         ┌────────────────┐         ┌────────────────┐
│ fullstack-     │  loop   │ code-reviewer  │  loop   │ qa-tester      │
│ developer      │◀──fix───│  (1× pós-tasks)│◀──fix───│ (1× pós-review)│
└────────────────┘         └────────────────┘         └─── skip if ────┘
        │                          │                  backend-only
        │ per task                 │ feedback estruturado     │
        ▼                          │ (BLOCKER/HIGH)           │ feedback estruturado
   impl → unit → integration       │                          │ (CRÍTICO/ALTO)
   → e2e → lint+typecheck          ▼                          ▼
                              dev corrige                dev corrige
                              + re-validação             + re-validação
                              escopada                   escopada
                                                              │
                                                              ▼
                                                       archive in-place
                                                       (sync specs + mv)
                                                              │
                                                              ▼
                                                       commits semânticos
                                                       (per-task + 1 archive)
                                                       + push + gh pr create
```

> **Notas**:
>
> - `qa-tester` é skipado automaticamente quando uma heurística de 2 sinais conclui que a change é backend-only (sem keywords UI em scenarios e sem paths tocados em `src/app/(app)/`, `src/app/(auth)/`, `src/modules/<dominio>/components/` ou `src/shared/ui/`). Veja seção 7.bis. Force com `/dev-cycle <name> --force-qa`.
> - O **archive** é feito dentro do worktree, na branch `feature/<name>`, antes do push — então o PR já vem com a change movida para `openspec/changes/archive/` e specs sincronizados. `/opsx:archive` ainda existe para uso ad-hoc fora do `/dev-cycle`.

---

## 3. Pré-requisitos

Antes de invocar `/dev-cycle`, garanta:

- **Change OpenSpec existe**: criada via `/opsx:new` ou `/opsx:ff`. Esperado em `openspec/changes/<name>/` com pelo menos `proposal.md` e `tasks.md`. `design.md` e arquivos em `specs/` são fortemente recomendados (sem cenários em `specs/`, o `qa-tester` cai para os critérios de aceite do `proposal.md` ou aborta).
- **Schema da change**: `spec-driven`. Outros schemas não são suportados (ainda).
- **Working tree de `main` limpa**: o orquestrador cria um worktree a partir de `origin/main` recente. Mudanças não commitadas em `main` não são levadas para o worktree.
- **Docker disponível**: o `qa-tester` precisa do app rodando em `http://localhost:3000`. O orquestrador faz `docker compose up -d` se a porta não responder.
- **`gh` autenticado**: necessário no passo final para abrir o PR. Se `gh auth status` falhar, o orquestrador pausa pedindo `gh auth login`.

---

## 4. Como invocar

```
/dev-cycle add-patient-crud
```

Sem argumento:

```
/dev-cycle
```

Forçando QA mesmo quando a heurística do step 5.0 skiparia:

```
/dev-cycle add-patient-crud --force-qa
```

Comportamento:

- Tenta inferir o nome da change pelo contexto da conversa.
- Se ambíguo, executa `openspec list --json` e usa **AskUserQuestion** para o usuário escolher entre as changes ativas.
- `--force-qa` é a única flag suportada hoje. Sem ela, a heurística da seção 7.bis decide se `qa-tester` roda.

---

## 5. Anatomia de uma task

Em `openspec/changes/<name>/tasks.md`, cada task é uma linha checkbox com texto livre descrevendo o que deve ser feito:

```
- [ ] Add /api/health route returning 200 with { ok: true }
- [ ] Add patient list page with skeleton loading
- [ ] Migrate patient table to add 'archived' column
- [ ] Refactor billing helper for clarity
```

**Camadas de teste**: não anotamos tags na task. O `fullstack-developer` decide quais camadas (unit / integration / e2e) cobrem a task analisando o que está sendo implementado:

| Natureza da task                                                                                                                                               | Camadas esperadas                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Lógica pura, validators Zod, helpers, hooks isolados                                                                                                           | unit                                                                                                                 |
| Server Action, Route Handler, query Drizzle, política RLS, função Inngest, integração externa, schema/migration                                                | unit (quando há lógica isolada testável) + integration (sempre, contra Postgres real via Testcontainers)             |
| Fluxo crítico de UI (auth, criação/edição de paciente, agendamento, lembrete WhatsApp, geração de receita, cobrança/PIX, sessão de telepsicologia, prontuário) | unit + integration + e2e (Playwright; tag `@<dominio>` no teste, p.ex. `@patients`, `@billing`)                      |
| Refactor mecânico ou doc-only                                                                                                                                  | re-rodar suítes existentes que cobrem o caminho tocado; criar testes novos só se a refactor expõe lógica não-coberta |

O agent consulta as skills `unit-tests`, `integration-tests` e `e2e-tests` para os padrões concretos (setup, mocks, factories, helpers de auth) de cada camada.

**Escopo dentro da camada**: a tabela escolhe **quais camadas** rodam; dentro de cada camada o agent aplica o **mesmo padrão escopado do modo fix** (ver §7) — `lint`+`typecheck`+`unit` full, `integration` via `--related`, `e2e` via `--grep "@<tag>"`. Isso evita rodar suítes inteiras a cada task numa change com muitas tasks. Forced-fallback (schema/types/env/auth/configs/>10 arquivos) reverte para suíte full daquela camada quando o sinal dispara.

**WIP commits per-task**: depois de cada task PASSar, o orquestrador commita o working tree com Conventional Commits derivado do título da task (`feat:` default, `fix:`/`test:`/`chore:` por convenção). Razão: (a) o agent calcula `git diff HEAD --name-only` para escopar `--related` apenas aos arquivos da task atual; (b) o step 7 (Commits semânticos + PR) já encontra a história linear pronta, sem precisar reconstruir per-task isolation post-hoc.

---

## 6. Pipeline detalhado

### Step 1 — Validação da change

```bash
openspec status --change "<name>" --json
```

- Confirma schema = `spec-driven`.
- Lê `proposal.md`, `tasks.md`, `design.md`, e tudo em `specs/`.
- Anuncia: "Using change: <name> (schema: spec-driven). Tasks: M total, K already complete."

### Step 2 — Setup do worktree

```bash
git fetch origin main
git worktree add ../hubrityp-<name> -b feature/<name> origin/main
mkdir -p ../hubrityp-<name>/.dev-cycle
```

- Reusa worktree existente se já houver um para essa change (idempotência).
- Adiciona `.dev-cycle/` ao `.gitignore` se ausente.

### Step 3 — Loop por task (sequencial)

Para cada task `- [ ]`, em ordem do arquivo:

1. **Invoca `fullstack-developer`** via Agent tool com:
   - `worktree_path` (absoluto)
   - texto literal da task + trechos relevantes de proposal/specs/design
   - instrução: o agent escolhe camadas pela tabela da §5 e aplica a **re-validação escopada (§7)** dentro de cada camada — `lint`+`typecheck`+`unit` full, `integration --related $(git diff HEAD --name-only)`, `e2e --grep "@<tag>"` (só se UI crítico)
   - cap interno de 3 tentativas de fix
   - contrato de saída: `VERDICT: PASS — ...` ou `VERDICT: FAIL — ...` (incluindo no resumo: camadas rodadas, escopado vs. full, fallbacks acionados)
2. **PASS** → marca a task `- [x]` em `tasks.md`, **commita o working tree** com Conventional Commits (`feat:`/`fix:`/`test:`/`chore:` derivado do título da task) + body `OpenSpec change: <name>`. Hooks rodam normalmente; falha de hook vira fix-iteration. A próxima task vai ver `git diff HEAD --name-only` refletindo só o trabalho dela.
3. **FAIL** → pausa, mostra logs em `.dev-cycle/task-<n>-fail.log`, espera o usuário. **Não commita** — o working tree fica sujo com o trabalho parcial; o usuário decide amend, revert ou continuar.

#### Step 3.bis — Regression sweep antes do reviewer

Quando todas as tasks estão `[x]` e commitadas, roda **sweep full** das camadas que foram escopadas per-task: `npm run test:integration` (full) e `npm run test:e2e:seeded` (full, só se algum task rodou e2e). Lint/typecheck/unit já rodaram full em todo per-task — sweep aqui é redundante para essas camadas.

A execução dos testes é **delegada ao `fullstack-developer` em modo sweep** — o orquestrador não roda `npm run test:*` direto. O orquestrador só (a) decide se e2e precisa rodar (heurística por grep nos `task-<n>.summary`), (b) calcula o caminho do `sweep-<N>.log`, (c) invoca o agent com `mode=sweep` + `e2e_required` + `sweep_log_path`, e (d) em failure, escreve o synthetic feedback e re-roteia para fix mode. Em modo sweep o agent é read-only: roda só os comandos pedidos, append no log, e devolve veredicto — não tenta corrigir nem altera código.

- **Verde** (`VERDICT: PASS` do agent) → step 4 (reviewer).
- **Vermelho** (`VERDICT: FAIL` do agent) → orquestrador persiste falhas em `.dev-cycle/sweep-fail-<N>.md` como synthetic feedback (com instrução explícita "rode integration full + e2e full no fim do fix, não escopado") e invoca `fullstack-developer` em modo fix. Cap 3 (budget separado dos steps 4 e 5). A cada fix: agent aplica fix + re-validação full + commit (`fix: <regressão>`); orquestrador re-invoca o agent em sweep mode. Cap atingido → escala sem invocar reviewer.

Custo amortizado da sweep: ~2–3min uma vez por change. Substitui o gasto de ~2min × N tasks que o full-per-task antigo tinha. O overhead extra da delegação ao agent (vs. orquestrador rodar npm direto) é ~5–10s — preço para manter o orquestrador 100% livre de execução de testes/lint/typecheck.

### Step 4 — Loop dev ↔ code-reviewer (cap 3)

Quando todas as tasks estão `[x]`:

1. Invoca `code-reviewer` com worktree path + base = `main`. Persiste em `.dev-cycle/review-<N>.md`.
2. Lê linha `VERDICT:`:
   - `approve` ou `approve-with-comments` → step 5.
   - `request-changes`:
     - Se `REVIEW_ITER >= 3` → escala.
     - **Loop guard**: se os títulos de BLOCKER/HIGH em `review-<N>.md` são idênticos aos de `review-<N-1>.md`, escala imediatamente ("non-converging loop").
     - Senão: invoca `fullstack-developer` em **modo fix** (passa o caminho do `review-<N>.md`, mais `changed_files` e `affected_e2e_tags` calculados pelo orquestrador). Aplica re-validação escopada. Volta a invocar `code-reviewer`.

### Step 5 — Loop dev ↔ qa-tester (cap 3)

#### Step 5.0 — Decisão skip-QA

Antes de qualquer custo (Docker, browser), o orquestrador avalia a heurística de 3 sinais (detalhada na seção 7.bis):

- Se `--force-qa` foi passado → roda QA (anuncia que heurística teria skipado/rodado).
- Se os 3 sinais resultam em PASS → skipa `qa-tester`, anuncia o motivo, e pula direto para o step 6 (Archive in-place). O Docker NÃO é inicializado.
- Caso contrário → roda QA normalmente.

#### Step 5.1 — Bring-up de Supabase + app (com ownership)

QA precisa de Supabase real (Postgres + GoTrue + Kong) e do Next.js. O orquestrador sobe o que faltar e registra em `<worktree>/.dev-cycle/infra-owned.json` o que ele iniciou — esse marker dirige o teardown do step 5.2.

Ordem de operações:

1. **Supabase**: `npx supabase status -o json` valida (mesma CLI usada pela suíte `@auth-real`). Se não responder, roda `npm run supabase:start`, marca `supabase: true`, e dispara `npm run supabase:reset` para garantir estado de DB limpo. Se já estava up (user-owned), reusa sem tocar no DB.
2. **App**: `curl -sf http://localhost:3000`. Se cair, roda `docker compose up -d` e marca `app: true`. Polling de 120s para readiness; timeout escala.
3. **Marker**: `<worktree>/.dev-cycle/infra-owned.json` com `{ supabase, app, started_at }` é sobrescrito (fonte de verdade para o teardown).

A política "subi → reseto o DB" é deliberada: nunca wipear um Supabase que o usuário também usa; sempre resetar um que o orquestrador acabou de subir, para QA partir de um fixture limpo. Isso diverge conscientemente do padrão `@auth-real` ("validate-only, fail loud") porque o `/dev-cycle` é uma orquestração end-to-end que possui seu próprio scratch space, não um test runner one-shot.

#### Step 5.1.1 — Loop QA (quando 5.0 não skipa)

1. **Extrai cenários** dos arquivos em `specs/` — todos os blocos `#### Scenario:`. Numera. Fallback: critérios de aceite do `proposal.md`. Sem nenhum dos dois → aborta.
2. Invoca `qa-tester` com URL base + lista numerada de cenários. Persiste em `.dev-cycle/qa-<N>.md`.
3. Lê linha `VERDICT:`:
   - `clean` → step 5.2 (teardown), depois step 6.
   - `issues-found`:
     - Se `QA_ITER >= 3` → escala. **Não roda teardown** — infra fica de pé pra inspeção.
     - Loop guard idêntico ao do reviewer (se CRÍTICO/ALTO repetem entre iterações, escala — também sem teardown).
     - Senão: invoca `fullstack-developer` em modo fix. Reinvoca `code-reviewer` (review curto sobre o novo diff). Se review limpo → reinvoca `qa-tester`.

#### Step 5.2 — Teardown (orchestrator-owned, só em QA clean)

Roda apenas quando `VERDICT: clean`. Em `issues-found` com cap atingido ou loop não-convergente, infra fica de pé com mensagem acionável.

Lê `infra-owned.json` e derruba só o que tem flag `true`:

```bash
[ "$(jq -r '.app' .dev-cycle/infra-owned.json)" = "true" ] && docker compose down
[ "$(jq -r '.supabase' .dev-cycle/infra-owned.json)" = "true" ] && npm run supabase:stop
rm -f .dev-cycle/infra-owned.json
```

Se a invocação inicial reusou Supabase + app que o usuário já tinha de pé, ambas as flags são `false` e o teardown é no-op — coerente com "não derrubo o que não subi".

### Step 6 — Archive in-place

Roda quando reviewer está limpo E (QA está limpo OU QA foi skipado no 5.0). Acontece **dentro do worktree, na branch `feature/<name>`**, antes do push — assim o PR já vem com a change movida e specs sincronizados.

**Princípio**: equivale a `/opsx:archive` rodando com todas as confirmações auto-aceitas como "proceed". Totalmente não-interativo; falhas hard-stopam antes de qualquer commit/PR.

#### 6.1 — Validate

```bash
openspec status --change "<name>" --json
```

Hard error se algum artifact ≠ `done` ou se algum `- [ ]` resta em `tasks.md` (não deveria acontecer; sinal de bug do orquestrador).

#### 6.2 — Sync delta specs → main specs

Se `openspec/changes/<name>/specs/` estiver vazio: skip (docs-only change). Anuncia "No delta specs — sync skipped".

Caso contrário, invoca `fullstack-developer` com prompt equivalente a `/opsx:sync` em modo não-interativo:

- "Para cada capability sob `specs/`, comparar com `openspec/specs/<cap>/spec.md` e aplicar ADDED/MODIFIED/REMOVED/RENAMED. Não pedir confirmação."
- Persiste sumário em `<worktree>/.dev-cycle/sync-summary.md`.
- Reporting: `VERDICT: PASS — sync applied` ou `VERDICT: FAIL — <razão>`.

Se FAIL: pausa e mostra o sumário. **Não defaulta para skip-sync** — o sync foi prometido.

#### 6.3 — Move directory

```bash
mkdir -p openspec/changes/archive
DATED="openspec/changes/archive/$(date +%F)-<name>"
[ -d "$DATED" ] && { echo "Archive target exists at $DATED"; exit 1; }
mv "openspec/changes/<name>" "$DATED"
```

Hard-stop em colisão (mesma política do `/opsx:archive`).

#### Política de falhas (resumo)

| Sub-passo      | Falha → ação                                                          |
| -------------- | --------------------------------------------------------------------- |
| 6.1 (validate) | Hard error — sinal de bug                                             |
| 6.2 (sync)     | Pausa, mostra `sync-summary.md`, pede decisão. Não defaulta para skip |
| 6.3 (mv)       | Hard error com mensagem                                               |

Princípio: antes do `mv` (6.3), qualquer falha é recuperável e sem efeito colateral; depois do `mv`, abortar é pausar e pedir intervenção, não desfazer.

### Step 7 — Commits semânticos + PR

1. **Commits per-task** já foram criados incrementalmente no step 3 (após cada PASS, um commit por task em ordem de `tasks.md`, com Conventional Commits derivado do título — `feat:`/`fix:`/`test:`/`chore:`). Mais commits eventuais de fixes da regression sweep (step 3.bis) e dos loops reviewer/QA (steps 4–5). O step 7 só verifica a história linear:
   ```bash
   git -C "$WORKTREE" log --oneline main..HEAD
   ```
   Falha (commit faltando ou subject não-CC) → aborta com diagnóstico — sinal de bug no step 3 ou intervenção manual quebrando o contrato. O fallback "commit único" das versões antigas não existe mais — per-task isolation é por construção.
2. **Commit dedicado de archive** (sempre, depois dos per-task):
   ```bash
   git add openspec/changes/archive/$(date +%F)-<name>/ openspec/specs/
   git commit -m "chore(openspec): archive <name> + sync specs"
   ```
   Justificativa do commit isolado: auditável no PR (reviewer vê 1 commit infra separado dos commits de feature), bisectável (sync mau-feito é localizável), rebatível (retry/fix do archive não toca os commits de feature).
3. **Push + PR**:
   ```bash
   git push -u origin feature/<name>
   gh pr create --base main --title "<change title>" --body "..."
   ```
   O body inclui referência à change OpenSpec (com path do archive datado), seção "Archive" (specs synced) e "Evidence" (reports de review/QA — ou "QA skipped" quando aplicável), e checklist de tasks.

---

## 7. Estratégia de re-validação escopada (task + fix)

A mesma sequência roda em **dois contextos**:

- **Task mode** (step 3, per task): agent calcula `CHANGED_FILES = git diff HEAD --name-only` localmente — uncommitted = só o trabalho desta task, porque o orquestrador commita entre tasks.
- **Fix mode** (steps 3.bis, 4, 5, pós-feedback): orquestrador injeta `changed_files` (`git diff <fix-base>...HEAD --name-only`) e `affected_e2e_tags` no prompt.

Sem essa escopagem, full-per-task numa change com 10 tasks gastaria ~50min só de teste antes do reviewer. Com escopagem, ~10–20min, com regression sweep cobrindo o cross-task drift.

### As 4 camadas (ordem fixa, falha-rápido)

| #   | Camada                  | Comando                                                | Por quê                                                                                                                                   |
| --- | ----------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Lint + typecheck (full) | `npm run lint && npm run typecheck`                    | Cheap, mandatório no CLAUDE.md. Lint ~10s, typecheck whole-program (não vale escopar).                                                    |
| 2   | Unit (full)             | `npm run test:unit`                                    | Suíte unitária inteira é barata (<30s típico) e cobre regressões cruzadas sem custo. Não vale escopar — vale como safety net per-task.    |
| 3   | Integration (escopado)  | `npm run test:integration -- --related $CHANGED_FILES` | Vitest `--related` resolve o grafo de dependência e roda apenas testes transitivamente afetados.                                          |
| 4   | E2E (escopado)          | `npm run test:e2e:seeded -- --grep "@<flow-tags>"`     | Playwright filtra por tags `@<dominio>`. Em task mode, agent infere a tag pelo path tocado (`src/app/(app)/<dominio>/**` → `@<dominio>`). |

E2E é **opcional em task mode** (só roda quando a tabela da §5 indica fluxo crítico de UI). Em fix mode, sempre roda — fallback para full se `affected_e2e_tags` veio vazio.

### Sinais que forçam fallback para suítes completas

Qualquer um basta (mesma lista nos dois modos):

- Mudou `src/shared/db/schema/**`, `src/shared/lib/types/**`, ou `src/shared/env/**` (schema/tipos globais).
- Mudou `src/shared/lib/utils/**` ou `src/modules/auth/**` (utilitários compartilhados / módulo de auth).
- Mudou `next.config.ts`, `tailwind.config.*`, ou `drizzle.config.*` (config).
- Mais de 10 arquivos modificados (proxy de "mudança ampla").

O agent deve nomear explicitamente o sinal acionado no resumo pré-`VERDICT`.

### Cross-task drift e a regression sweep

Escopar per-task tem um custo: regressão da task 5 que quebra um teste integration da task 2 sem que `--related` da task 5 inclua aquele teste. **Step 3.bis** fecha esse buraco rodando `test:integration` full (e `test:e2e:seeded` full, condicional) entre o fim do step 3 e o início do step 4. Custo ~2–3min uma vez. Falha → fix mode com synthetic feedback que força full re-validação.

### Custo esperado por iteração (estimado)

| Camada           | Escopado  | Full       |
| ---------------- | --------- | ---------- |
| Lint + typecheck | ~10s      | ~10s       |
| Unit             | ~30s      | ~30s       |
| Integration      | ~20s      | ~2min      |
| E2E              | ~1min     | ~10min     |
| **Total**        | **~2min** | **~13min** |

Com escopagem em task mode + sweep no fim:

- Change de 10 tasks (3 UI crítico): 7×~70s + 3×~3min + sweep ~3min ≈ **~21min** de re-validação total (vs. ~55min do full-per-task antigo).

### Onde a estratégia vive

- **Per-task** (step 3): o agent executa a sequência. Orquestrador não roda testes — só commita entre tasks.
- **Sweep** (step 3.bis): o orquestrador invoca o agent em **modo sweep** com `e2e_required` e `sweep_log_path` — agent roda `test:integration` (e `test:e2e:seeded` quando aplicável) full e devolve `VERDICT: PASS|FAIL`. A heurística de "precisa e2e?" continua no orquestrador, mas execução é sempre via agent. Se a sweep falhar, o agent é re-invocado em modo fix com synthetic feedback.
- **Fix pós-feedback** (steps 3.bis, 4, 5): orquestrador calcula `changed_files`/`affected_e2e_tags` e injeta no prompt; agent executa a sequência e devolve `VERDICT: PASS` apenas com re-validação verde.

**Princípio invariante**: em todos os modos, **só o agent roda `npm run test:*`, `npm run lint` e `npm run typecheck`**. O orquestrador só faz infra (docker/supabase), git, openspec status e gh — nunca dispara testes nem checagens de código direto.

---

## 7.bis Skip-QA — heurística

O `qa-tester` usa Playwright em browser real (~2–5min/iteração, cap 3 = até 15min). Para changes backend-only o custo não se justifica. O step 5.0 do pipeline avalia 2 sinais; se ambos derem PASS, `qa-tester` é skipado — e o bring-up de Supabase + app (step 5.1) não acontece, então não há nem Docker nem `supabase:start` nem teardown a fazer.

### Os 2 sinais (logical AND)

| #   | Sinal                                                                                                              | Comando                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Nenhuma keyword UI em blocos `#### Scenario:` dos `specs/`                                                         | `! grep -irE -A 6 '^#### Scenario:' specs/ \| grep -iqE 'visits\|renders\|clicks\|sees\|visual\|navigates\|page\|form\|button'`          |
| 2   | Diff `main...HEAD` não toca `src/app/(app)/`, `src/app/(auth)/`, `src/modules/<dom>/components/`, `src/shared/ui/` | `! git diff main...HEAD --name-only \| grep -qE '^(src/app/\(app\)/\|src/app/\(auth\)/\|src/modules/[^/]+/components/\|src/shared/ui/)'` |

A combinação **AND** é deliberada: o sinal 1 sozinho pode dar falso-positivo (scenarios escritos em linguagem neutra que ainda assim implicam UI). O sinal 2 (paths tocados no diff) é o catch-all que pega esses casos — qualquer arquivo de UI no diff força QA a rodar mesmo que os scenarios sejam ambíguos.

### Exemplos com changes arquivadas reais

| Change                     | S1  | S2  | Decisão                                                           |
| -------------------------- | --- | --- | ----------------------------------------------------------------- |
| `bootstrap-foundation`     | ✓   | ✓   | **Skip** (infra/tooling, sem UI)                                  |
| `bootstrap-data-and-tests` | ✓   | ✓   | **Skip** (db/lib/test stack)                                      |
| `smoke-health-feature`     | ✗   | ✗   | **Roda** (toca `src/app/(auth)/login`, `src/app/(app)/dashboard`) |
| `dev-cycle-followups-001`  | ✓   | ✓\* | **Skip** (refactor de orquestrador, sem UI)                       |

\*Quando a heurística retorna PASS para uma change que mexe em UI por engano, use `--force-qa`.

### Override

`/dev-cycle <name> --force-qa` desliga a heurística e força o loop QA, anunciando o que o skip teria decidido.

### Mensagens

- **Skip**: lista os 2 sinais com PASS e instrui o usuário a re-invocar com `--force-qa` se discordar.
- **Run após heurística falhar**: nomeia qual sinal disparou (ex.: "Signal 2 failed: diff touches `src/shared/ui/button.tsx`").
- **Run forçado**: "QA forced by --force-qa flag (heuristic would have skipped/run)".

---

## 8. Loop prevention

| Loop                                                       | Cap      | Ação ao bater                                                                                      |
| ---------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| Tentativas internas do dev por task (testes/lint falhando) | 3        | Pausa, mostra logs (`.dev-cycle/task-<n>-fail.log`), espera usuário.                               |
| Regression sweep ↔ dev (step 3.bis)                        | 3        | Pausa, mostra `sweep-fail-<N>.md` e `.dev-cycle/sweep-<N>.log`. Não invoca reviewer.               |
| Ciclo dev ↔ code-reviewer pós-tasks                        | 3        | Pausa, lista BLOCKER/HIGH persistentes do último `review-N.md`.                                    |
| Ciclo dev ↔ qa-tester                                      | 3        | Pausa, lista CRÍTICO/ALTO persistentes do último `qa-N.md`.                                        |
| Mesmo finding repete 2× consecutivas (review ou QA)        | imediato | Pausa ("non-converging loop"). Sinal forte de que a heurística de fix do dev não está convergindo. |

Quando um cap é atingido, o orquestrador imprime:

- A última iteração rodada (`REVIEW_ITER` / `QA_ITER`).
- A lista de issues persistentes.
- Caminho dos relatórios.
- Sugestão de próximo passo (intervenção manual, ajuste no design da change, ou abort).

---

## 9. Onde os artefatos vivem

| Artefato                          | Caminho                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Worktree da change                | `../hubrityp-<name>/` (sibling do repo)                                                                                                          |
| Branch da change                  | `feature/<name>` (criada do `origin/main`)                                                                                                       |
| Relatórios de review              | `<worktree>/.dev-cycle/review-1.md`, `review-2.md`, ...                                                                                          |
| Relatórios de QA                  | `<worktree>/.dev-cycle/qa-1.md`, `qa-2.md`, ...                                                                                                  |
| Sumário do sync de specs          | `<worktree>/.dev-cycle/sync-summary.md`                                                                                                          |
| Logs de falhas de task            | `<worktree>/.dev-cycle/task-<n>-fail.log`                                                                                                        |
| Sumário de cobertura per-task     | `<worktree>/.dev-cycle/task-<n>.summary` (camadas que rodaram, escopado vs. full — usado pelo step 3.bis pra decidir se sweep precisa rodar e2e) |
| Logs/feedback da regression sweep | `<worktree>/.dev-cycle/sweep-<N>.log`, `sweep-fail-<N>.md` (synthetic feedback quando sweep vermelha)                                            |
| Marker de ownership de infra      | `<worktree>/.dev-cycle/infra-owned.json` (existe entre 5.1 e 5.2; persiste se QA escala)                                                         |
| Pasta `.dev-cycle/`               | gitignored (via `.gitignore` na raiz do repo)                                                                                                    |
| Change arquivada                  | `openspec/changes/archive/YYYY-MM-DD-<name>/`                                                                                                    |
| Specs principais sincr.           | `openspec/specs/<cap>/spec.md` (editado no step 6.2)                                                                                             |
| Commits                           | per-task + 1 commit `chore(openspec): archive ...`                                                                                               |
| PR                                | aberto via `gh pr create` contra `main` (já com archive)                                                                                         |

Após o merge, limpe o worktree:

```bash
git worktree remove ../hubrityp-<name>
git branch -d feature/<name>
```

---

## 10. Como interromper / retomar

`/dev-cycle <name>` é interruptível. Você pode `Ctrl+C` ou pausar a qualquer momento. Para retomar:

```
/dev-cycle <name>
```

O orquestrador:

- Detecta o worktree existente e reusa.
- Pula tasks já marcadas `[x]` em `tasks.md`.
- Conta os arquivos `review-N.md` e `qa-N.md` existentes em `.dev-cycle/` para inicializar `REVIEW_ITER` e `QA_ITER` corretamente (não reinicia o cap a cada retomada).
- Lê `infra-owned.json` (se existir) ao entrar no step 5.1 para preservar ownership entre invocações — uma run anterior interrompida que subiu Supabase continua sendo "dona" disso na re-invocação. Se você manualmente derrubou Supabase entre as duas runs, o marker fica stale e o orquestrador re-detecta + sobe + remarca.

---

## 11. Troubleshooting

| Sintoma                                                              | Causa provável                                                                                                       | Resolução                                                                                                                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "docker compose up failed" no step 5.1                               | Docker daemon não está de pé                                                                                         | `sudo systemctl start docker` (Linux) ou abrir Docker Desktop.                                                                                                           |
| `npm run supabase:start` falha no step 5.1                           | Porta 54321 ocupada (suíte `@auth-real` rodando? mock GoTrue da seeded suite?), Docker indisponível, ou crash da CLI | Mensagem de stderr da CLI é surfaceada. Resolver o conflito de porta (`lsof -i:54321`) ou subir o Docker primeiro; re-invocar `/dev-cycle <name>`.                       |
| Infra ficou de pé após QA escalar                                    | Comportamento esperado — step 5.2 não roda em `issues-found`                                                         | Cheque `<worktree>/.dev-cycle/infra-owned.json` para saber o que é seu (true) e derrube manualmente: `npm run supabase:stop` e/ou `docker compose down`.                 |
| "gh: command not found" ou "not authenticated" no step PR            | `gh` ausente ou sem login                                                                                            | Instale GitHub CLI; rode `gh auth login`.                                                                                                                                |
| Vitest `--related` retorna zero testes onde claramente deveria rodar | Grafo de dependência não resolveu (alias quebrado, dynamic import)                                                   | O agent faz fallback automático para suíte full integration e anuncia.                                                                                                   |
| Mapping path → e2e tag retorna vazio                                 | Path mudado não está em `src/__tests__/e2e/seeded/tags.json` nem segue a convenção `src/app/(app)/<dominio>/**`      | O agent faz fallback para suíte e2e completa. Considere atualizar `src/__tests__/e2e/seeded/tags.json`.                                                                  |
| Cap de 3 iterações atingido no loop dev↔reviewer                     | Issues estruturais que o agent não consegue resolver autonomamente                                                   | Revise o `review-3.md` manualmente; ajuste a tarefa ou o design da change e re-invoque.                                                                                  |
| Worktree em estado sujo de invocação anterior                        | `/dev-cycle` foi interrompido com mudanças não commitadas                                                            | `git -C ../hubrityp-<name> status` para inspecionar; se for resíduo de tentativa abandonada, `git stash` ou `git restore .` no worktree. Não delete o worktree às cegas. |
| `qa-tester` aborta porque não há cenários                            | `specs/` vazio E `proposal.md` sem critérios de aceite                                                               | Adicione cenários em `openspec/changes/<name>/specs/` (formato `#### Scenario: ...`) e re-invoque.                                                                       |

---

## 12. Limitações conhecidas

- **Schema OpenSpec**: apenas `spec-driven`.
- **Sem paralelismo**: tasks são sequenciais por design (ordem importa em OpenSpec). Se você quer paralelismo, divida em changes independentes.
- **Local-first**: precisa de Docker + Supabase CLI + `gh` + Playwright local. Não roda em CI.
- **Ports compartilhadas com a suíte `@auth-real`**: o step 5.1 sobe Supabase na porta hardcoded `54321` (ver gotcha em §14). Não é possível rodar `/dev-cycle` e `npm run test:e2e:real` concorrentemente — são mutuamente exclusivos.
- **Custo de QA**: cada iteração do `qa-tester` consome tempo de browser real (~2–5min). Caps de 3 são intencionais; se você precisa de mais, é sinal de problema estrutural. A heurística do step 5.0 (seção 7.bis) skipa QA em changes backend-only para evitar esse custo quando seguro; use `--force-qa` se quiser desligar a heurística.
- **Commits per-task** dependem de isolar arquivos por task com confiança. Se as tasks compartilham muitos arquivos, o orquestrador cai para um commit único e anuncia.

---

## 13. Referências cruzadas

- Comando: `.claude/commands/dev-cycle.md` (especificação executável)
- Agents: `.claude/agents/fullstack-developer.md`, `.claude/agents/code-reviewer.md`, `.claude/agents/qa-tester.md`
- CLAUDE.md: seção "Workflow de change (dev-cycle)"
- OpenSpec: `/opsx:new`, `/opsx:ff`, `/opsx:apply`, `/opsx:verify`, `/opsx:archive`
- Skills relacionadas: `unit-tests`, `integration-tests`, `e2e-tests`
- Skill `openspec-archive-change` (`.claude/skills/openspec-archive-change/SKILL.md`): a versão interativa do archive, espelhada inline no step 6 do `/dev-cycle`. Continua disponível via `/opsx:archive` para uso ad-hoc fora do `/dev-cycle` (changes manuais, fixes pós-merge, retries).
- Skill `openspec-sync-specs` (`.claude/skills/openspec-sync-specs/SKILL.md`): a lógica de sync que o step 6.2 invoca em modo não-interativo.

---

## 14. Gotchas

Armadilhas reais encontradas durante a primeira invocação do `/dev-cycle` (ver `docs/dev-cycle-retrospective-001.md`, seções 3.4–3.6). Todas se manifestam ao mexer em infraestrutura de e2e ou auth. Leia antes de tocar `playwright.seeded.config.ts`, `playwright.real.config.ts`, `src/__tests__/e2e/seeded/setup/start-server.ts` ou qualquer caminho que envolva `supabase.auth.getUser()` no servidor.

### `NEXT_PUBLIC_*` é inlinado no edge runtime em build time

`src/middleware.ts` roda no edge runtime, e o Next inlina o valor de `NEXT_PUBLIC_SUPABASE_URL` no bundle no momento do `next build`. Não dá para sobrescrever via `webServer.env` em runtime — o middleware sempre vai bater no host/porta que o build viu. Por isso o mock GoTrue do suite seeded precisa ouvir na **mesma porta hardcoded** que o build conhece (`127.0.0.1:54321`, idem ao `supabase start`). Helper canônico em `src/__tests__/e2e/seeded/setup/mock-gotrue.ts` (`startMockGotrue({ port })` aceita override mas defaulta para `54321` justamente por isso). Consequência prática: a suíte seeded (mock GoTrue) e a suíte `@auth-real` não rodam concorrentemente — disputam a mesma porta.

### Playwright sobe `webServer` ANTES de `globalSetup`

Verificável em `node_modules/playwright/lib/runner/tasks.js::createGlobalSetupTasks`. Qualquer coisa que `globalSetup` escreve em `process.env` (URL dinâmica do Testcontainers Postgres, porta efêmera de mock) é invisível ao Next.js spawnado — `webServer.env` é capturado no config-load. Workaround canônico: `src/__tests__/e2e/seeded/setup/start-server.ts` faz o boot dinâmico (Postgres + mock GoTrue) e só então `exec`a `next start`, garantindo env completo no momento certo. Esse é o pattern reusável para qualquer suite futuro que precise de recursos efêmeros antes do servidor.

### `playwright.real.config.ts` chama `execSync` no top-level

Mesmo problema da seção anterior em outra fantasia. Como `webServer.env` é capturado em config-load e o suite `@auth-real` depende de URLs/keys que só existem depois de `npx supabase start`, `playwright.real.config.ts` faz `execSync('npx supabase status -o json')` sincronamente no top-level — _não_ em `globalSetup`. **Não tente "consertar" movendo para `globalSetup`**: vai parecer mais limpo e quebrar exatamente como descrito acima, porque o Next spawnado não enxerga as vars. Se a infra de auth-real evoluir, o caminho de fix é o mesmo do mock suite (wrapper de boot tipo `start-server.ts`), não `globalSetup`.

### `supabase status -o json` usa `SCREAMING_SNAKE_CASE`

Quirk do CLI: o payload estruturado usa `API_URL`, `DB_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` (uppercase + underscore), não camelCase como em outras saídas do `supabase` CLI. Ver o tipo `SupabaseStatus` em `playwright.real.config.ts`:

```ts
type SupabaseStatus = {
  API_URL: string;
  DB_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
};
```

Ao adicionar novo parsing em volta do CLI, dump o JSON uma vez localmente e cheque o shape real antes de assumir camelCase — vai economizar uma rodada de erro de tipo ou, pior, uma falha silenciosa de undefined.
