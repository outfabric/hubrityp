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
└────────────────┘         └────────────────┘         └────────────────┘
        │                          │                          │
        │ per task                 │ feedback estruturado     │ feedback estruturado
        ▼                          │ (BLOCKER/HIGH)           │ (CRÍTICO/ALTO)
   impl → unit → integration       │                          │
   → e2e → lint+typecheck          ▼                          ▼
                              dev corrige                dev corrige
                              + re-validação             + re-validação
                              escopada                   escopada
                                                              │
                                                              ▼
                                                       commits semânticos
                                                       + push + gh pr create
```

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

Comportamento:

- Tenta inferir o nome da change pelo contexto da conversa.
- Se ambíguo, executa `openspec list --json` e usa **AskUserQuestion** para o usuário escolher entre as changes ativas.

---

## 5. Anatomia de uma task

Em `openspec/changes/<name>/tasks.md`, cada task é uma linha checkbox. Você pode anotar quais camadas de teste a task exige usando tags entre colchetes no fim da linha:

```
- [ ] Add /api/health route returning 200 with { ok: true } [unit] [integration]
- [ ] Add patient list page with skeleton loading [unit] [e2e]
- [ ] Migrate patient table to add 'archived' column [integration]
- [ ] Refactor billing helper for clarity
```

Convenção:

| Tag             | Significa                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `[unit]`        | Cria/atualiza testes Vitest unitários para essa task.                                                            |
| `[integration]` | Cria/atualiza testes Vitest + Testcontainers contra Postgres real.                                               |
| `[e2e]`         | Cria/atualiza testes Playwright cobrindo o fluxo. Devem receber tag `@<dominio>` (ex.: `@patients`, `@billing`). |
| _(sem tag)_     | Default `[unit]`.                                                                                                |

O `fullstack-developer` recebe essas tags e sabe quais skills (`unit-tests`, `integration-tests`, `e2e-tests`) consultar e quais comandos rodar.

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

1. **Parse das tags de teste** (`[unit]`/`[integration]`/`[e2e]`; default `[unit]`).
2. **Invoca `fullstack-developer`** via Agent tool com:
   - `worktree_path` (absoluto)
   - texto literal da task + trechos relevantes de proposal/specs/design
   - lista de camadas de teste
   - instrução de rodar `npm run check` no fim
   - cap interno de 3 tentativas de fix
   - contrato de saída: `VERDICT: PASS — ...` ou `VERDICT: FAIL — ...`
3. **PASS** → marca a task `- [x]` em `tasks.md` e avança.
4. **FAIL** → pausa, mostra logs em `.dev-cycle/task-<n>-fail.log`, espera o usuário.

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

1. Garante app no ar:
   ```bash
   curl -sf http://localhost:3000 || docker compose up -d
   ```
   Aguarda até 120s. Se não subir, escala.
2. **Extrai cenários** dos arquivos em `specs/` — todos os blocos `#### Scenario:`. Numera. Fallback: critérios de aceite do `proposal.md`. Sem nenhum dos dois → aborta.
3. Invoca `qa-tester` com URL base + lista numerada de cenários. Persiste em `.dev-cycle/qa-<N>.md`.
4. Lê linha `VERDICT:`:
   - `clean` → step 6.
   - `issues-found`:
     - Se `QA_ITER >= 3` → escala.
     - Loop guard idêntico ao do reviewer (se CRÍTICO/ALTO repetem entre iterações, escala).
     - Senão: invoca `fullstack-developer` em modo fix. Reinvoca `code-reviewer` (review curto sobre o novo diff). Se review limpo → reinvoca `qa-tester`.

### Step 6 — Commits semânticos + PR

1. **Commits per-task** (default): para cada task em `tasks.md`, identifica os arquivos exclusivamente tocados por aquela task e cria um commit com Conventional Commits:
   - `feat: <task title>` (default)
   - `fix: <task title>` se a task contém `fix`/`bug`/`corrige`
   - `test: <task title>` se for puramente sobre testes
   - `chore: <task title>` para infra/config
2. **Fallback**: se isolar arquivos por task for inviável (overlap), cria um commit único `feat(<change>): <change title>` e anuncia o fallback.
3. **Push + PR**:
   ```bash
   git push -u origin feature/<name>
   gh pr create --base main --title "<change title>" --body "..."
   ```
   O body inclui referência à change OpenSpec, resumo do proposal, checklist de tasks, e links para `review-N.md` e `qa-N.md` como evidência.

---

## 7. Estratégia de re-validação após fixes (anti-regressão)

Cada fix pós-feedback (do `code-reviewer` ou do `qa-tester`) modifica código que **já passou** pelos gates per-task. Sem re-validação, regressões cruzadas passam: um fix de schema pode quebrar testes de uma task anterior; um fix de QA em um componente pode quebrar e2e de outro fluxo. Re-rodar a suíte inteira a cada fix é caro (e2e custa minutos) e desencoraja iterações; portanto, a estratégia é **escopada por arquivos afetados**, com fallback para suíte completa quando o escopo não puder ser determinado com confiança.

### As 4 camadas (ordem fixa, falha-rápido)

| #   | Camada                  | Comando                                                | Por quê                                                                                                    |
| --- | ----------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1   | Lint + typecheck (full) | `npm run lint && npm run typecheck`                    | Cheap, mandatório no CLAUDE.md. Falha aqui = parar antes de tocar testes.                                  |
| 2   | Unit (full)             | `npm run test:unit`                                    | Suíte unitária inteira é barata (<30s típico) e cobre regressões cruzadas sem custo. Não vale escopar.     |
| 3   | Integration (escopado)  | `npm run test:integration -- --related $CHANGED_FILES` | Vitest `--related` resolve o grafo de dependência e roda apenas testes transitivamente afetados.           |
| 4   | E2E (escopado)          | `npm run test:e2e -- --grep "@<flow-tags>"`            | Playwright filtra por tags `@<dominio>` mantidas em `e2e/tags.json` (ou inferidas da estrutura de `app/`). |

`$CHANGED_FILES` = `git -C <worktree> diff <fix-base>...HEAD --name-only`, calculado pelo orquestrador e passado ao agent.

### Sinais que forçam fallback para suítes completas

Qualquer um basta para acionar `npm run test:integration` full + `npm run test:e2e` full:

- Mudou `db/schema/**`, `lib/types/**`, ou `lib/env.ts` (schema/tipos globais).
- Mudou `lib/utils/**` ou `lib/auth/**` (utilitários compartilhados).
- Mudou `next.config.ts`, `tailwind.config.*`, ou `drizzle.config.*` (config).
- Mais de 10 arquivos modificados no fix (proxy de "mudança ampla").

O agent deve nomear explicitamente o sinal acionado no resumo pré-`VERDICT`.

### Custo esperado por iteração de fix (estimado)

| Camada           | Escopado  | Full       |
| ---------------- | --------- | ---------- |
| Lint + typecheck | ~10s      | ~10s       |
| Unit             | ~30s      | ~30s       |
| Integration      | ~20s      | ~2min      |
| E2E              | ~1min     | ~10min     |
| **Total**        | **~2min** | **~13min** |

Com cap de 3 iters por loop e dois loops (reviewer + QA), pior caso ≈ 12min de re-validação por change — aceitável.

### Onde a estratégia vive

- O orquestrador **não** roda testes diretamente; instrui o `fullstack-developer` no prompt de fix.
- O orquestrador **calcula** `changed_files` e `affected_e2e_tags` antes de invocar o agent.
- O `fullstack-developer` executa a sequência e devolve `VERDICT: PASS` apenas se toda a re-validação ficar verde.

---

## 8. Loop prevention

| Loop                                                       | Cap      | Ação ao bater                                                                                      |
| ---------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| Tentativas internas do dev por task (testes/lint falhando) | 3        | Pausa, mostra logs (`.dev-cycle/task-<n>-fail.log`), espera usuário.                               |
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

| Artefato               | Caminho                                                 |
| ---------------------- | ------------------------------------------------------- |
| Worktree da change     | `../hubrityp-<name>/` (sibling do repo)                 |
| Branch da change       | `feature/<name>` (criada do `origin/main`)              |
| Relatórios de review   | `<worktree>/.dev-cycle/review-1.md`, `review-2.md`, ... |
| Relatórios de QA       | `<worktree>/.dev-cycle/qa-1.md`, `qa-2.md`, ...         |
| Logs de falhas de task | `<worktree>/.dev-cycle/task-<n>-fail.log`               |
| Pasta `.dev-cycle/`    | gitignored (via `.gitignore` na raiz do repo)           |
| Commits                | dentro do worktree, na branch `feature/<name>`          |
| PR                     | aberto via `gh pr create` contra `main`                 |

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

---

## 11. Troubleshooting

| Sintoma                                                              | Causa provável                                                                               | Resolução                                                                                                                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "docker compose up failed" no step QA                                | Docker daemon não está de pé                                                                 | `sudo systemctl start docker` (Linux) ou abrir Docker Desktop.                                                                                                           |
| "gh: command not found" ou "not authenticated" no step PR            | `gh` ausente ou sem login                                                                    | Instale GitHub CLI; rode `gh auth login`.                                                                                                                                |
| Vitest `--related` retorna zero testes onde claramente deveria rodar | Grafo de dependência não resolveu (alias quebrado, dynamic import)                           | O agent faz fallback automático para suíte full integration e anuncia.                                                                                                   |
| Mapping path → e2e tag retorna vazio                                 | Path mudado não está em `e2e/tags.json` nem segue a convenção `app/(dashboard)/<dominio>/**` | O agent faz fallback para suíte e2e completa. Considere atualizar `e2e/tags.json`.                                                                                       |
| Cap de 3 iterações atingido no loop dev↔reviewer                     | Issues estruturais que o agent não consegue resolver autonomamente                           | Revise o `review-3.md` manualmente; ajuste a tarefa ou o design da change e re-invoque.                                                                                  |
| Worktree em estado sujo de invocação anterior                        | `/dev-cycle` foi interrompido com mudanças não commitadas                                    | `git -C ../hubrityp-<name> status` para inspecionar; se for resíduo de tentativa abandonada, `git stash` ou `git restore .` no worktree. Não delete o worktree às cegas. |
| `qa-tester` aborta porque não há cenários                            | `specs/` vazio E `proposal.md` sem critérios de aceite                                       | Adicione cenários em `openspec/changes/<name>/specs/` (formato `#### Scenario: ...`) e re-invoque.                                                                       |

---

## 12. Limitações conhecidas

- **Schema OpenSpec**: apenas `spec-driven`.
- **Sem paralelismo**: tasks são sequenciais por design (ordem importa em OpenSpec). Se você quer paralelismo, divida em changes independentes.
- **Local-first**: precisa de Docker + `gh` + Playwright local. Não roda em CI.
- **Custo de QA**: cada iteração do `qa-tester` consome tempo de browser real. Caps de 3 são intencionais; se você precisa de mais, é sinal de problema estrutural.
- **Commits per-task** dependem de isolar arquivos por task com confiança. Se as tasks compartilham muitos arquivos, o orquestrador cai para um commit único e anuncia.

---

## 13. Referências cruzadas

- Comando: `.claude/commands/dev-cycle.md` (especificação executável)
- Agents: `.claude/agents/fullstack-developer.md`, `.claude/agents/code-reviewer.md`, `.claude/agents/qa-tester.md`
- CLAUDE.md: seção "Workflow de change (dev-cycle)"
- OpenSpec: `/opsx:new`, `/opsx:ff`, `/opsx:apply`, `/opsx:verify`, `/opsx:archive`
- Skills relacionadas: `unit-tests`, `integration-tests`, `e2e-tests`
