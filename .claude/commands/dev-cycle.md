---
name: "Dev Cycle"
description: "Closed-loop dev workflow for an OpenSpec change: per-task dev→tests→lint, end-of-change reviewer→QA→commits→PR."
category: Workflow
tags: [workflow, openspec, agents, hubrityp]
---

Closed-loop development workflow that consumes an existing OpenSpec change and orchestrates the three project subagents (`fullstack-developer`, `code-reviewer`, `qa-tester`) until the change is implemented, reviewed, QA-validated, committed, and opened as a PR.

**Input**: `/dev-cycle <change-name>` (kebab-case). If omitted, infer from conversation context. If ambiguous, run `openspec list --json` and use **AskUserQuestion** to let the user pick.

**Pre-conditions** (verify upfront, abort with a clear message if missing):
- Change exists at `openspec/changes/<name>/` with at least `tasks.md` and `proposal.md`.
- `git` working tree on `main` is clean (no uncommitted changes that would conflict with worktree creation).
- `gh` is authenticated (`gh auth status`) — required for PR creation at the end.
- `docker` is available — required for QA step (the agent will start `docker compose` if needed).

---

## Steps

### 1. Select and validate the change

```bash
openspec status --change "<name>" --json
```

- Parse `schemaName`. If ≠ `spec-driven`, abort with: "Only the spec-driven schema is supported by /dev-cycle today."
- Parse the artifact list. Read into context: `proposal.md`, `tasks.md`, `design.md` (if present), and every file under `openspec/changes/<name>/specs/`.
- Announce: "Using change: <name> (schema: spec-driven). Tasks: M total, K already complete."

### 2. Setup the worktree (sibling)

Worktree path: `<repo-parent>/hubrityp-<name>` (i.e., sibling of the main repo).

```bash
WORKTREE="../hubrityp-<name>"
BRANCH="feature/<name>"

if git worktree list --porcelain | grep -q "$WORKTREE"; then
  echo "Reusing existing worktree at $WORKTREE on branch $BRANCH"
else
  git fetch origin main
  git worktree add "$WORKTREE" -b "$BRANCH" origin/main
fi

mkdir -p "$WORKTREE/.dev-cycle"
```

If `.gitignore` in the main repo doesn't already include `.dev-cycle/`, append it (one-time setup) so feedback artifacts never get staged.

### 3. Per-task loop (sequential)

Read `tasks.md` from the worktree. For every task line still marked `- [ ]`, in file order:

#### 3a. Parse test requirements from the task

Convention: a task line may end with bracketed tags `[unit]`, `[integration]`, `[e2e]` (any subset). If no tag is present, default to `[unit]`. Example:

```
- [ ] Add /api/health route returning 200 with { ok: true } [unit] [integration]
```

#### 3b. Invoke `fullstack-developer` (Agent tool)

Build a prompt that contains:
- **Scope marker**: "You are operating on worktree `<absolute-path>`. All file edits and bash commands must run inside it (`cd <path> && ...`). Do not touch the main repo working tree."
- **Task**: the full task line text plus relevant excerpts from `proposal.md`, `design.md`, and the `specs/` files referenced by this task.
- **Test requirements**: the parsed test tags. Spell out what must be created/updated and run:
  - Always: unit tests for code in this task (Vitest).
  - If `[integration]`: integration tests (Vitest + Testcontainers).
  - If `[e2e]`: E2E tests (Playwright). Tag the e2e tests with `@<dominio>` matching the task's domain (e.g., `@patients`, `@billing`).
- **Quality gate**: after tests pass, run `npm run check` (lint + format + typecheck). All three must pass.
- **Reporting contract**: end the response with one of:
  - `VERDICT: PASS — implementation complete, tests pass, npm run check green.`
  - `VERDICT: FAIL — <one-line reason>. Logs: <path under .dev-cycle/>.` (Save full logs to `<worktree>/.dev-cycle/task-<n>-fail.log`.)
- **Iteration cap**: "You may iterate internally up to 3 times to fix failing tests or lint errors. After 3 failed attempts, return FAIL with the root-cause diagnosis."

#### 3c. Process the result

- If `PASS`: edit the task line in `tasks.md` from `- [ ]` to `- [x]`. Move to the next task.
- If `FAIL`: stop the loop. Print a summary (which task failed, the FAIL reason line, the log path) and wait for the user. Do not attempt the next task until the user resolves it.

### 4. End-of-tasks: code-reviewer loop (cap 3)

Trigger only when every task in `tasks.md` is `[x]`. Initialize `REVIEW_ITER=0`.

#### 4a. Invoke `code-reviewer` (Agent tool)

Prompt:
- "Review the diff `main...feature/<name>` inside worktree `<absolute-path>`. Run `git -C <path> diff main...HEAD` to scope yourself."
- "Persist the full report to `<path>/.dev-cycle/review-<REVIEW_ITER+1>.md`."
- "End your response with a single parseable line: `VERDICT: approve` | `approve-with-comments` | `request-changes`."

Increment `REVIEW_ITER` after the agent returns.

#### 4b. Branch on verdict

- `approve` or `approve-with-comments` → proceed to step 5.
- `request-changes`:
  - If `REVIEW_ITER >= 3` → **stop**: print the persistent BLOCKER/HIGH list from `review-<REVIEW_ITER>.md`, escalate to user.
  - **Loop guard**: diff `review-<REVIEW_ITER>.md` against `review-<REVIEW_ITER-1>.md` (if it exists). If the BLOCKER/HIGH titles are identical, stop immediately ("non-converging loop") and escalate.
  - Otherwise: invoke `fullstack-developer` in **fix mode** (see step 6 prompt template), passing the review file path and the orchestrator's computed `changed_files` and `affected_e2e_tags`. Then re-invoke `code-reviewer` (back to 4a).

### 5. End-of-review: qa-tester loop (cap 3)

Initialize `QA_ITER=0`.

#### 5a. Bring up the app

```bash
cd "$WORKTREE"
if ! curl -sf http://localhost:3000 > /dev/null; then
  docker compose up -d
  # Poll for readiness, max 120s
fi
```

If the app is not reachable after 120s, escalate to user with the docker logs.

#### 5b. Extract scenarios from the change's specs

Read every file under `openspec/changes/<name>/specs/` and extract every block under a `#### Scenario:` heading (spec-driven schema convention). Keep the literal text. Build a numbered list:

```
1. Scenario: <heading from spec>
   <full GIVEN/WHEN/THEN body>
2. Scenario: ...
```

If no scenarios are present, fall back to the acceptance criteria section of `proposal.md`. If neither exists, escalate to user (we cannot anchor QA without criteria).

#### 5c. Invoke `qa-tester` (Agent tool)

Prompt:
- **Base URL**: `http://localhost:3000`.
- **Scenarios**: the full numbered list from 5b. "Validate every scenario in the browser. For each scenario, mark `Scenario N: PASS` or `Scenario N: FAIL — <reason>`."
- **Free exploration**: after the scripted scenarios, run adjacent exploratory testing on the affected flows (visual, accessibility, edge cases per the agent's checklist).
- **Persistence**: "Save the full report to `<worktree>/.dev-cycle/qa-<QA_ITER+1>.md`."
- **Reporting contract**: end with `VERDICT: clean` (no CRÍTICO/ALTO) or `VERDICT: issues-found`.

Increment `QA_ITER` after the agent returns.

#### 5d. Branch on verdict

- `clean` → proceed to step 6.
- `issues-found`:
  - If `QA_ITER >= 3` → stop and escalate.
  - **Loop guard**: same as 4b — compare CRÍTICO/ALTO titles between `qa-<QA_ITER>.md` and `qa-<QA_ITER-1>.md`; halt on identical lists.
  - Otherwise: invoke `fullstack-developer` in **fix mode** (see step 6 prompt), passing the QA report path. Then re-invoke `code-reviewer` (one short pass on the new diff — `review-after-qa-<QA_ITER>.md`); if it stays clean, re-invoke `qa-tester` (back to 5a). If the short review fails, treat it as a normal review-fix loop (subject to its own 3-iter cap, shared budget with step 4).

### 6. Fix-mode prompt template (used by 4b and 5d)

When invoking `fullstack-developer` to address feedback:

- **Scope**: worktree path (same as before).
- **Feedback file**: absolute path to `review-N.md` or `qa-N.md`.
- **Fix instruction**: "Address every BLOCKER/HIGH from the review (or every CRÍTICO/ALTO from the QA report). Do not introduce out-of-scope refactors."
- **Re-validation contract** (mandatory before returning PASS):
  1. Compute `CHANGED=$(git -C <worktree> diff <fix-base>...HEAD --name-only)` where `<fix-base>` = the SHA at the start of this fix iteration.
  2. Run `npm run lint` and `npm run typecheck` (full). If either fails → fix and retry (internal cap 3).
  3. Run `npm run test:unit` (full suite). If fails → fix and retry.
  4. Run `npm run test:integration -- --related $CHANGED`. If `--related` produces no test files OR Vitest cannot resolve, fall back to full integration. If fails → fix and retry.
  5. Run `npm run test:e2e -- --grep "@<flow-tags>"` where `<flow-tags>` is the orchestrator-supplied list. If empty/ambiguous, fall back to full E2E.
  6. **Forced fallback to full suites** when any of these signals applies (announce which signal triggered it):
     - Changed any file under `db/schema/**`, `lib/types/**`, `lib/env.ts`
     - Changed any file under `lib/utils/**`, `lib/auth/**`
     - Changed any of `next.config.ts`, `tailwind.config.*`, `drizzle.config.*`
     - Changed more than 10 files
- **Reporting contract**: same `VERDICT: PASS` / `VERDICT: FAIL` lines as step 3b. On PASS, also print the re-validation summary (which suites ran, scoped or full, and pass/fail).

The orchestrator computes `changed_files` and `affected_e2e_tags` itself before invoking the agent — the agent receives them as plain lists in the prompt. Tag mapping comes from `e2e/tags.json` if it exists, else inferred from the path (e.g., `app/(dashboard)/patients/**` → `@patients`).

### 7. Commits and PR

Once both reviewer and QA are clean:

#### 7a. Semantic commits per task

Strategy:
1. For each task in the original `tasks.md` order, compute the set of files exclusively touched by that task. Use `git -C <worktree> log --reverse --oneline` if intermediate commits were already made by the dev agent during the per-task loop; otherwise, replay by reading the worktree's reflog.
2. If per-task isolation is feasible, create one commit per task with subject derived from the task title and Conventional Commits prefix:
   - Default: `feat: <task title>`
   - If task title contains `fix`/`bug`/`corrige`: `fix: <task title>`
   - If task title is purely about tests: `test: <task title>`
   - If task title is infra/config: `chore: <task title>`
3. **If per-task isolation is not feasible** (files overlap across tasks), fall back to a single commit: `feat(<change>): <change title from proposal.md>` and announce this fallback in the final summary.

All commits include in the body:
- Reference to the OpenSpec change (`OpenSpec change: <name>`)
- Co-author trailer if appropriate (per repo convention; check existing log)
- No `--no-verify`. If pre-commit hooks fail, treat as a fix-iteration trigger (route back to step 6).

#### 7b. Push and open PR

```bash
git -C "$WORKTREE" push -u origin "$BRANCH"

gh pr create \
  --base main \
  --head "$BRANCH" \
  --title "<change title from proposal.md>" \
  --body "$(cat <<'EOF'
## OpenSpec change
- Name: <name>
- Path: openspec/changes/<name>/

## Summary
<extracted from proposal.md>

## Tasks completed
<bulleted list from tasks.md, all checked>

## Evidence
- Code review: .dev-cycle/review-N.md (final iteration)
- QA report: .dev-cycle/qa-N.md (final iteration)
- Re-validation iterations: dev↔reviewer X/3, dev↔QA Y/3
EOF
)"
```

---

## Final summary (printed by the orchestrator)

```
## Dev Cycle Complete — <change>

Tasks: M/M complete
Worktree: ../hubrityp-<name>/ (branch: feature/<name>)
Review iterations: X/3
QA iterations: Y/3
Commits created: <count> (<strategy: per-task | single>)
Reports: .dev-cycle/{review-1.md, ..., qa-1.md, ...}
PR: <url>
```

---

## Loop prevention summary

| Loop | Cap | On cap-hit |
|---|---|---|
| Dev internal retries per task | 3 | Pause, show logs, wait for user |
| dev ↔ code-reviewer (post-tasks) | 3 | Pause, list persistent BLOCKER/HIGH |
| dev ↔ qa-tester | 3 | Pause, list persistent CRÍTICO/ALTO |
| Same finding repeats 2× consecutively | immediate | Pause (non-converging signal) |

---

## Resume behavior

`/dev-cycle <name>` is interruptible and idempotent:
- Detects an existing worktree and reuses it.
- Skips tasks already marked `[x]`.
- Preserves prior `.dev-cycle/*.md` reports and counts them when applying the iteration cap (does not start `REVIEW_ITER` from 0 if `.dev-cycle/review-*.md` already exists; pick up where it stopped).

---

## Out of scope

- Does not run in CI (this is a local-first workflow that needs a real browser for QA).
- Does not parallelize tasks within a change (sequential by design — ordering matters in OpenSpec tasks).
- Does not support OpenSpec schemas other than `spec-driven`.
- Does not create the change itself — use `/opsx:new` or `/opsx:ff` first.
