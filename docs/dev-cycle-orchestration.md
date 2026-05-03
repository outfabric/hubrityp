# dev-cycle-orchestration

## Resumo

Capability que governa o slash command `/dev-cycle`, o contrato em modo orquestrado do agent `fullstack-developer` (incluindo quais arquivos o agent não pode tocar) e a pegada de documentação que invocadores futuros do workflow dependem para encontrar gotchas e helpers.

## Onde mora o código

- `.claude/commands/dev-cycle.md` — definição do slash command (passos, loops, caps de iteração, contratos de saída).
- `.claude/agents/fullstack-developer.md` — system prompt do agent invocado pelo orquestrador. A seção `## Modo orquestrado (dev-cycle)` carrega o contrato de input/output e a regra anti-mutação de `tasks.md`.
- `.claude/agents/code-reviewer.md`, `.claude/agents/qa-tester.md` — agents downstream chamados em loop após as tasks.
- `docs/dev-cycle.md` — manual humano do workflow, incluindo a seção `## 14. Gotchas` com os pitfalls conhecidos.
- `docs/dev-cycle-retrospective-001.md` — retrospectiva da primeira execução, fonte das gotchas documentadas.

## Superfície pública

- **Slash command**: `/dev-cycle <change-name>` (kebab-case opcional; sem argumento, infere do contexto ou prompta seleção via `openspec list --json`).
- **Pré-condições verificadas** pelo orquestrador antes de iniciar: change existe em `openspec/changes/<name>/`, working tree de `main` limpo, `gh auth status` OK, `docker info` OK.
- **Worktree gerado**: `../hubrityp-<name>/` na branch `feature/<name>`, com `.dev-cycle/` (gitignored) para artefatos de feedback.
- **Tags em `tasks.md`**: cada linha pode terminar em qualquer subconjunto de `[unit]` `[integration]` `[e2e]` (default `[unit]`). Determinam quais camadas de teste o `fullstack-developer` deve criar/atualizar.
- **Contrato de saída do `fullstack-developer`** (em modo orquestrado): última linha parseável `VERDICT: PASS — <descrição>` ou `VERDICT: FAIL — <razão>. Logs: <path>`.
- **Contrato de saída do `code-reviewer`**: última linha `VERDICT: approve | approve-with-comments | request-changes`.
- **Contrato de saída do `qa-tester`**: última linha `VERDICT: clean | issues-found`.

## Comportamento e invariantes

- **`fullstack-developer` em modo orquestrado NÃO pode modificar nenhum arquivo que case com `openspec/changes/*/tasks.md`.** Marcar tasks `[x]` é responsabilidade exclusiva do orquestrador. A regra está ancorada na seção `## Modo orquestrado (dev-cycle)` do system prompt do agent (callout `> [!IMPORTANT]`) para sobreviver a refactors do prompt sem ser removida acidentalmente.
- **Caps de iteração**: dev internal retries por task (3), dev↔reviewer pós-tasks (3), dev↔QA (3), achado idêntico repetido 2× consecutivos → halt imediato (sinal de não-convergência).
- **Re-validação escopada em fix-mode**: lint+typecheck full → unit full → integration `--related $CHANGED` → e2e `--grep "@<flow-tags>"`. Fallback forçado para suítes completas se mudou `db/schema/**`, `lib/types/**`, `lib/env.ts`, `lib/utils/**`, `lib/auth/**`, `next.config.ts`, `tailwind.config.*`, `drizzle.config.*`, ou >10 arquivos.
- **Documentação de gotchas** em `docs/dev-cycle.md` é load-bearing: o spec exige que o arquivo contenha uma seção "Gotchas" (ou heading equivalente) cobrindo os 4 pitfalls e que `grep -E "NEXT_PUBLIC|webServer|globalSetup|supabase status" docs/dev-cycle.md` retorne ≥1 match por tópico. Removendo qualquer um quebra o spec.
- **Resume behavior**: `/dev-cycle <name>` é interruptível e idempotente — detecta worktree existente, pula tasks já `[x]`, preserva relatórios prévios em `.dev-cycle/*.md`.
- **Out of scope**: não roda em CI (workflow local-first com browser real para QA), não paraleliza tasks dentro de uma change, suporta apenas schema `spec-driven`, não cria a change (use `/opsx:new` ou `/opsx:ff`).

## Testes

- **Mecânico**: a regra de `tasks.md` e a presença das gotchas são verificáveis via grep. Sem suíte automatizada — observação fica para a QA review da próxima execução de dev-cycle.
- **Cobertura prática**: a primeira execução completa do workflow (`smoke-health-feature`, archived 2026-05-02) gerou `docs/dev-cycle-retrospective-001.md`, fonte da retrospectiva que motivou esta capability.

## Histórico de changes

- 2026-05-02 dev-cycle-followups-001 — codifica regra anti-mutação de `tasks.md` no system prompt do `fullstack-developer` e adiciona seção `## Gotchas` em `docs/dev-cycle.md` com 4 pitfalls (NEXT_PUBLIC inlining, Playwright webServer pré-globalSetup, `playwright.auth-real` síncrono, key-naming do `supabase status -o json`). Capability criada por este archive. Veja `../openspec/changes/archive/2026-05-02-dev-cycle-followups-001/`.
