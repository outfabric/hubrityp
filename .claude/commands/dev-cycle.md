---
name: "Dev Cycle"
description: "Closed-loop dev workflow for an OpenSpec change: per-task dev→tests→lint, end-of-change reviewer→QA→commits→PR."
category: Workflow
tags: [workflow, openspec, agents, hubrityp]
---

Closed-loop development workflow that consumes an existing OpenSpec change and orchestrates the three project subagents (`fullstack-developer`, `code-reviewer`, `qa-tester`) until the change is implemented, reviewed, QA-validated, committed, and opened as a PR.

**Input**: `/dev-cycle <change-name> [flags]` (kebab-case). If `<change-name>` omitted, infer from conversation context. If ambiguous, run `openspec list --json` and use **AskUserQuestion** to let the user pick.

**Flags**:
- `--force-qa`: bypass the skip-QA heuristic in step 5.0 and always run `qa-tester`. Default: false (heuristic decides).

**Pre-conditions** (verify upfront, abort with a clear message if missing):
- Change exists at `openspec/changes/<name>/` with at least `tasks.md` and `proposal.md`.
- `git` working tree on `main` is clean (no uncommitted changes that would conflict with worktree creation).
- `gh` is authenticated (`gh auth status`) — required for PR creation at the end.
- `docker` is available — required for QA step (the agent will start `docker compose` if needed AND the heuristic doesn't skip QA).

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

#### 5.0 Skip-QA decision gate

Before bringing up the app, evaluate the skip-QA heuristic. The goal is to avoid the cost of `qa-tester` (Playwright browser, ~2–5 min per iteration, cap 3 = up to 15 min) on backend-only changes.

**Skip QA if all three signals pass** (logical AND):

```bash
# Signal 1: no [e2e] tags in tasks.md
SIGNAL_1=$(! grep -qE '\[e2e\]' "$WORKTREE/openspec/changes/<name>/tasks.md" && echo PASS || echo FAIL)

# Signal 2: no UI keywords in #### Scenario: blocks under specs/
UI_KEYWORDS='visits|renders|clicks|sees|visual|navigates|page|form|button'
SIGNAL_2=$(! grep -irE -A 6 '^#### Scenario:' "$WORKTREE/openspec/changes/<name>/specs/" 2>/dev/null \
  | grep -iqE "$UI_KEYWORDS" && echo PASS || echo FAIL)

# Signal 3: diff main...HEAD doesn't touch UI paths
CHANGED=$(git -C "$WORKTREE" diff main...HEAD --name-only)
SIGNAL_3=$(! echo "$CHANGED" | grep -qE '^(src/app/\(app\)/|src/app/\(auth\)/|src/modules/[^/]+/components/|src/shared/ui/)' && echo PASS || echo FAIL)
```

Persist `CHANGED` for reuse in step 6 (fix-mode) — it's the same value the orchestrator computes there.

**Decision matrix**:

| `--force-qa` | Heuristic | Action |
|---|---|---|
| true | (any) | Run QA. Print: `QA forced by --force-qa flag (heuristic would have <skipped|run>: signals=<1>/<2>/<3>).` |
| false | all 3 PASS | Skip QA. Print the skip message below. Jump to step 7. |
| false | any FAIL | Run QA. Print: `QA running — signal X failed: <reason>.` |

**Skip message** (printed when QA is skipped):

```
## QA Skipped — <change>

Heuristic concluded this change does not require browser QA:
  - Signal 1 (no [e2e] tags in tasks.md):                               PASS
  - Signal 2 (no UI keywords in spec scenarios):                        PASS
  - Signal 3 (diff doesn't touch src/app/(app)/, src/app/(auth)/, src/modules/<dom>/components/, src/shared/ui/): PASS

Skipping qa-tester. Proceeding to step 7 (archive) and step 8 (commits + PR).
To force QA on this change, re-invoke as: /dev-cycle <name> --force-qa
```

If skipping, do not initialize Docker (no `docker compose up`). Proceed directly to step 7.

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
  5. Run `npm run test:e2e:seeded -- --grep "@<flow-tags>"` where `<flow-tags>` is the orchestrator-supplied list. If empty/ambiguous, fall back to full E2E.
  6. **Forced fallback to full suites** when any of these signals applies (announce which signal triggered it):
     - Changed any file under `src/shared/db/schema/**`, `src/shared/lib/types/**`, `src/shared/env/**`
     - Changed any file under `src/shared/lib/utils/**`, `src/modules/auth/**`
     - Changed any of `next.config.ts`, `tailwind.config.*`, `drizzle.config.*`
     - Changed more than 10 files
- **Reporting contract**: same `VERDICT: PASS` / `VERDICT: FAIL` lines as step 3b. On PASS, also print the re-validation summary (which suites ran, scoped or full, and pass/fail).

The orchestrator computes `changed_files` and `affected_e2e_tags` itself before invoking the agent — the agent receives them as plain lists in the prompt. Tag mapping comes from `src/__tests__/e2e/seeded/tags.json` if it exists, else inferred from the path (e.g., `src/app/(app)/patients/**` → `@patients`).

### 7. Archive in-place

Trigger only when reviewer is clean AND (QA is clean OR QA was skipped at step 5.0). The change is archived inside the worktree on `feature/<name>` so the move + sync + docs land in the same PR as the implementation. **No prompts to the user** — this step is fully non-interactive (defaults below); failures hard-stop before any commits/PR are created.

This step is the inline equivalent of `/opsx:archive` running with all confirmations auto-accepted as "proceed". The standalone `/opsx:archive` command continues to exist for ad-hoc archives outside `/dev-cycle`.

#### 7.1 Validate

```bash
openspec status --change "<name>" --json
```

- If any artifact ≠ `done`: hard error (this should never happen at this point — flag as orchestrator bug and abort).
- If any task in `tasks.md` is `- [ ]`: hard error (step 3 of `/dev-cycle` guarantees all tasks are `[x]`; flag as bug and abort).

#### 7.2 Sync delta specs → main specs

If `openspec/changes/<name>/specs/` is empty: skip (docs-only change, no sync needed). Announce: "No delta specs found — sync skipped."

Otherwise, invoke `fullstack-developer` with a sync prompt (semantically equivalent to `/opsx:sync` in non-interactive mode):

- **Scope marker**: same worktree path constraint as other agent invocations.
- **Sync instruction**: "For each capability dir under `openspec/changes/<name>/specs/`, compare the delta spec with `openspec/specs/<capability>/spec.md` and apply ADDED/MODIFIED/REMOVED/RENAMED operations to bring the main spec in line with the delta. Do not ask for confirmation — apply all changes."
- **Output**: persist a summary to `<worktree>/.dev-cycle/sync-summary.md` listing capabilities touched and operations applied.
- **Reporting contract**: end with `VERDICT: PASS — sync applied` or `VERDICT: FAIL — <reason>`.

If FAIL: pause and show `sync-summary.md`. Do **not** default to skip-sync — sync was promised to the user.

#### 7.3 Move directory

```bash
cd "$WORKTREE"
mkdir -p openspec/changes/archive
DATED="openspec/changes/archive/$(date +%F)-<name>"
if [ -d "$DATED" ]; then
  echo "Archive target already exists at $DATED"
  echo "Options: rename existing archive, delete it (if duplicate), or wait until a different date."
  exit 1
fi
mv "openspec/changes/<name>" "$DATED"
```

Hard-stop on collision (same policy as `/opsx:archive`).

#### 7.4 Generate or update `docs/<capability>.md`

For each capability dir under `$DATED/specs/`, generate or update `docs/<cap>.md` (pt-BR prose, code identifiers/paths/commands stay in English). Source material to read:

- `openspec/specs/<cap>/spec.md` (post-sync source of truth; fall back to the archived delta if 7.2 was skipped).
- The archived `proposal.md`, `design.md` (if present), `tasks.md`.
- Existing `docs/<cap>.md` if present (preserve manual edits and prior history entries).

Template sections (same as the standalone archive skill):

- **Resumo** — 1–2 sentences on what this capability is and why it exists.
- **Onde mora o código** — bullet list of main files/folders with relative paths.
- **Superfície pública** — routes, server actions, exported components/utilities, env vars, contract surface.
- **Comportamento e invariantes** — edge cases, gotchas, RLS/LGPD/idempotency notes.
- **Testes** — test files covering the capability with layer (unit/integration/e2e) and relative paths.
- **Histórico de changes** — bullet list, **newest first**, of the form `- YYYY-MM-DD <change-name> — <one-line summary>` linking to `../openspec/changes/archive/<dated>/`. Prepend the just-archived change; never drop prior entries.

**Update vs. create**: when `docs/<cap>.md` already exists, edit in place — refresh stale sections, prepend the change to the history, preserve manual content (especially custom sections outside the template above).

If write fails for any capability: pause, list the failed capability(ies). **Do not** rollback the `mv` from 7.3 — the change is semantically archived; the doc can be corrected manually before the commit in 8b.

#### 7.5 Pre-commit safety check

Run `git -C "$WORKTREE" status --short` and `git -C "$WORKTREE" diff --stat docs/` to verify the doc edits look reasonable. If any pre-existing `docs/<cap>.md` shows a destructive diff (e.g., manual sections deleted, history truncated), pause and ask the user before proceeding to step 8.

### 8. Commits and PR

Once archive (step 7) completed without unresolved errors:

#### 8a. Semantic commits per task

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

#### 8b. Dedicated archive commit

After 8a, stage and commit everything the archive step (7) produced as a single dedicated commit:

```bash
cd "$WORKTREE"
git add \
  openspec/changes/archive/$(date +%F)-<name>/ \
  openspec/specs/ \
  docs/
git commit -m "chore(openspec): archive <name> + sync specs + docs

OpenSpec change: <name>
- Archived to openspec/changes/archive/$(date +%F)-<name>/
- Synced delta specs into openspec/specs/<cap>/spec.md (see .dev-cycle/sync-summary.md)
- Updated docs/<cap>.md for each touched capability"
```

Notes:
- The `mv` from step 7.3 shows up as a rename in `git status`; `git add openspec/changes/archive/<dated>/` stages the rename plus any modifications.
- `git add openspec/specs/` picks up sync edits from step 7.2.
- `git add docs/` picks up doc edits from step 7.4.
- If `git status` shows untracked files outside these paths, **do not** stage them blindly — pause and ask the user.
- If pre-commit hooks fail, treat as a fix-iteration trigger (route back to step 6, scoped re-validation).

#### 8c. Push and open PR

```bash
git -C "$WORKTREE" push -u origin "$BRANCH"

gh pr create \
  --base main \
  --head "$BRANCH" \
  --title "<change title from proposal.md>" \
  --body "$(cat <<'EOF'
## OpenSpec change
- Name: <name>
- Archived to: openspec/changes/archive/YYYY-MM-DD-<name>/

## Summary
<extracted from proposal.md>

## Tasks completed
<bulleted list from tasks.md, all checked>

## Archive
- Specs synced: <list of openspec/specs/<cap>/spec.md touched, or "none — docs-only change">
- Docs updated: <list of docs/<cap>.md created or updated>

## Evidence
- Code review: .dev-cycle/review-N.md (final iteration)
- QA report: .dev-cycle/qa-N.md (final iteration, or "skipped — backend-only heuristic" / "skipped — --force-qa override")
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
QA: <Y/3 | skipped (backend-only heuristic) | skipped (--force-qa override)>
Archive: openspec/changes/archive/YYYY-MM-DD-<name>/
  - Specs synced: <list or "none">
  - Docs updated: <list or "none">
Commits created: <count> per-task + 1 archive commit (<strategy: per-task | single>)
Reports: .dev-cycle/{review-1.md, ..., qa-1.md, ..., sync-summary.md}
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
