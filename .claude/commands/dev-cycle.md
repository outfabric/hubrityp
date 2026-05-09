---
name: "Dev Cycle"
description: "Closed-loop dev workflow for an OpenSpec change: per-section dev→tests→lint, end-of-change reviewer→QA→commits→PR."
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
- `docker` daemon running and Supabase CLI available (`npm run supabase:start` resolves) — required when QA runs. Step 5a brings up Supabase + app if needed; step 5e tears down only what step 5a started, and only when QA passes.

---

## Steps

### 1. Select and validate the change

```bash
openspec status --change "<name>" --json
```

- Parse `schemaName`. If ≠ `spec-driven`, abort with: "Only the spec-driven schema is supported by /dev-cycle today."
- Parse the artifact list. Read into context: `proposal.md`, `tasks.md`, `design.md` (if present), and every file under `openspec/changes/<name>/specs/`.
- Announce: "Using change: <name> (schema: spec-driven). Sections: S total, P already complete (M/M subtasks done)."

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

### 3. Per-section loop (sequential)

Parse `tasks.md` from the worktree into **sections**. A section is a `## N. <title>` heading plus every line until the next `## ` heading or end of file. Subtasks are `- [ ] N.M ...` lines under the heading. The natural unit of work for the agent is **one section** — typically a coherent group of 3–11 subtasks.

For every section that contains at least one `- [ ]` subtask, in file order:

#### 3a. Pre-section sanity + agent invocation

**Pre-section sanity check** (assert before invoking the agent):

```bash
# Working tree must be clean — section-level commits land at end of each section.
git -C "$WORKTREE" diff --quiet HEAD || { echo "Working tree dirty at start of section <N> — abort"; exit 1; }
```

If a section is in **mixed state** (some `- [x]` AND some `- [ ]` subtasks), hard-stop with:
```
Section <N> is in mixed state (some [x], some [ ]). This can only happen via manual edit of tasks.md
between runs. Section atomicity requires either a full rerun (revert all [x] in this section to [ ])
or a clean state. Refusing to guess intent.
```

Then invoke `fullstack-developer` (Agent tool) in **section mode** with a prompt containing:

- **Scope marker**: "You are operating on worktree `<absolute-path>`. All file edits and bash commands must run inside it (`cd <path> && ...`). Do not touch the main repo working tree."
- **`section`** field: the literal section text from `tasks.md` — header `## N. <title>` plus every subtask line (`- [ ] N.M ...`) and any prose paragraphs between them. Plus relevant excerpts from `proposal.md`, `design.md`, and the `specs/` files referenced by the section's subtasks.
- **Section-as-unit instruction**: "Implement every subtask in this section as a single unit of work. Do not pause between subtasks. Run scoped re-validation ONCE at the end of the section, not after each subtask. The orchestrator will atomically flip every `- [ ]` in this section to `- [x]` only on `VERDICT: PASS` — partial completion produces nothing."
- **Re-validation**: the agent follows its built-in "Re-validação escopada" contract (defined in `.claude/agents/fullstack-developer.md`). It decides which layers to run based on the nature of the files changed — from skip-total (non-code sections) through lint+typecheck+unit+integration+e2e (UI flows). Integration and e2e are **always scoped, never full** — full suites run exclusively in the regression sweep (step 3c).
- **Reporting contract**: end the response with one of:
  - `VERDICT: PASS — implementation complete, tests pass, npm run check green.`
  - `VERDICT: FAIL — <one-line reason, including which subtask broke if applicable>. Logs: <path under .dev-cycle/>.` (Save full logs to `<worktree>/.dev-cycle/section-<N>-fail.log`.)
- **Iteration cap**: "You may iterate internally up to 3 times to fix failing tests or lint errors. After 3 failed attempts, return FAIL with the root-cause diagnosis."

#### 3b. Process the result

- If `PASS`:
  1. **Atomically flip all `- [ ] N.M` lines in section N to `- [x] N.M`** in `tasks.md`. Use `Edit` per line (each subtask line is unique because of the `N.M` prefix + free text). Do not use sed/awk on the whole file. If any individual line edit fails (line text changed unexpectedly between read and edit), abort with a diagnostic — never half-flip a section.
  2. Stage everything in the working tree: `git -C "$WORKTREE" add -A`.
  3. Commit with a Conventional Commits subject derived from the **section title** (not subtask titles). Lowercase the title for the subject; preserve original casing in the body bullets. Type heuristic:
     - Default: `feat: <section title lowercased>`
     - Title contains `test`/`testes`: `test: <section title>`
     - Title contains `doc`/`documenta`: `docs: <section title>`
     - Title contains `fix`/`bug`/`corrige`: `fix: <section title>`
     - Title contains `validação final` / `ci` / `tooling` / `setup`: `chore: <section title>`
     - Body shape:
       ```
       OpenSpec change: <name>

       Subtasks completed:
       - N.1 <subtask text>
       - N.2 <subtask text>
       ...

       Co-Authored-By: <follow repo convention from `git log`>
       ```
  4. **Hooks must run** (no `--no-verify`). If pre-commit hooks fail, treat as a fix-iteration trigger: re-invoke the agent with the hook output as synthetic feedback. The agent's internal retry budget covers it (cap 3, same as test/lint failures).
  5. Move to the next section. Next section's agent invocation will see `git diff HEAD --name-only` reflecting only its own work.
- If `FAIL`: stop the loop. Print a summary (which section + which subtask broke, the FAIL reason line, the log path) and wait for the user. Do not attempt the next section. The working tree is left dirty with the agent's partial work; the user can amend, revert, or instruct continuation. **Do not commit on FAIL** and **do not flip any subtask to `[x]`** — atomicity is per-section: a section is either fully done + committed or fully pending.

#### 3c. End-of-sections regression sweep

After every section is fully complete (all subtasks `[x]`) and committed, run a full-suite regression sweep before invoking the reviewer. This catches cross-section drift that scoped per-section re-validation can miss (section 5 broke an integration test from section 2 whose import graph the scoped run doesn't touch).

**Test execution is delegated to `fullstack-developer` in sweep mode.** The orchestrator does not run `npm run test:*` directly — its job here is to (a) decide whether e2e is needed, (b) compute the log path, (c) invoke the agent, and (d) on failure, write the synthetic feedback file and re-route to fix mode.

```bash
cd "$WORKTREE"

# Pick the next sweep number (resume-safe).
SWEEP_N=$(( $(ls .dev-cycle/sweep-*.log 2>/dev/null | wc -l) + 1 ))
SWEEP_LOG="$(pwd)/.dev-cycle/sweep-${SWEEP_N}.log"
```

Then invoke `fullstack-developer` (Agent tool) in **sweep mode** with:

- **Scope marker**: `worktree_path = <absolute-path>`.
- **Mode**: `sweep`.
- **Flags**: `sweep_log_path = <absolute path to $SWEEP_LOG>`.
- **Instruction**: "Run `npm run test:integration` (full) and `npm run test:e2e:seeded` (full). Append all stdout+stderr to `sweep_log_path`. Do NOT modify code, run lint/typecheck/unit, or scope via `--related`/`--grep`/file paths — sweep is full-only and read-only."
- **Reporting contract**:
  - `VERDICT: PASS — sweep clean (integration: X tests, e2e: Y tests)`
  - `VERDICT: FAIL — <one-line cause>. Logs: <sweep_log_path>`

Note: lint/typecheck/unit are NOT in the sweep — they ran full on every per-section invocation already (step 3a contract), so re-running here is redundant. Sweep is exclusively for the layers that were scoped per-section.

**Branch on the agent's verdict:**

- `VERDICT: PASS` → "Regression sweep clean — proceeding to reviewer." Go to step 4.
- `VERDICT: FAIL` → persist a synthetic feedback file at `<worktree>/.dev-cycle/sweep-fail-<N>.md` containing:
  ```
  # Regression sweep failure (iteration N)

  **Forced full re-validation**: this is a cross-section regression caught by the end-of-sections sweep. At the end of your fix, run `npm run test:integration` full AND (if applicable) `npm run test:e2e:seeded` full — NOT scoped via --related/--grep. The regression by definition isn't covered by your changed-files graph.

  ## Failing tests
  <parsed list of failing tests from $SWEEP_LOG>

  ## Raw output
  <tail of $SWEEP_LOG>
  ```

  Then invoke `fullstack-developer` in **fix mode** with `feedback_file=.dev-cycle/sweep-fail-<N>.md`. Cap 3 iterations (separate budget from steps 4 and 5).

  Each fix iteration: agent does its fix, runs full re-validation per the synthetic feedback's instruction, returns `VERDICT: PASS`. Orchestrator commits the fix as `fix: <short summary of regression>` (Conventional Commits) and re-invokes `fullstack-developer` in **sweep mode** (back to top of 3c). At cap 3, escalate without invoking the reviewer — broken regressions never reach review.

### 4. End-of-sections: code-reviewer loop (cap 3)

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
  - Otherwise: invoke `fullstack-developer` in **fix mode** (see step 6 prompt template), passing the review file path and the orchestrator's computed `changed_files`. Then re-invoke `code-reviewer` (back to 4a).

### 5. End-of-review: qa-tester loop (cap 3)

Initialize `QA_ITER=0`.

#### 5.0 Skip-QA decision gate

Before bringing up the app, evaluate the skip-QA heuristic. The goal is to avoid the cost of `qa-tester` (Playwright browser, ~2–5 min per iteration, cap 3 = up to 15 min) on backend-only changes.

**Skip QA if both signals pass** (logical AND):

```bash
# Signal 1: no UI keywords in #### Scenario: blocks under specs/
UI_KEYWORDS='visits|renders|clicks|sees|visual|navigates|page|form|button'
SIGNAL_1=$(! grep -irE -A 6 '^#### Scenario:' "$WORKTREE/openspec/changes/<name>/specs/" 2>/dev/null \
  | grep -iqE "$UI_KEYWORDS" && echo PASS || echo FAIL)

# Signal 2: diff main...HEAD doesn't touch UI paths
CHANGED=$(git -C "$WORKTREE" diff main...HEAD --name-only)
SIGNAL_2=$(! echo "$CHANGED" | grep -qE '^(src/app/\(app\)/|src/app/\(auth\)/|src/modules/[^/]+/components/|src/shared/ui/)' && echo PASS || echo FAIL)
```

Persist `CHANGED` for reuse in step 6 (fix-mode) — it's the same value the orchestrator computes there.

**Decision matrix**:

| `--force-qa` | Heuristic | Action |
|---|---|---|
| true | (any) | Run QA. Print: `QA forced by --force-qa flag (heuristic would have <skipped|run>: signals=<1>/<2>).` |
| false | both PASS | Skip QA. Print the skip message below. Jump to step 7. |
| false | any FAIL | Run QA. Print: `QA running — signal X failed: <reason>.` |

**Skip message** (printed when QA is skipped):

```
## QA Skipped — <change>

Heuristic concluded this change does not require browser QA:
  - Signal 1 (no UI keywords in spec scenarios):                        PASS
  - Signal 2 (diff doesn't touch src/app/(app)/, src/app/(auth)/, src/modules/<dom>/components/, src/shared/ui/): PASS

Skipping qa-tester. Proceeding to step 7 (archive) and step 8 (commits + PR).
To force QA on this change, re-invoke as: /dev-cycle <name> --force-qa
```

If skipping, do not initialize Docker (no `docker compose up`). Proceed directly to step 7.

#### 5a. Ensure Supabase + app are up (track ownership)

QA needs a real Supabase stack (Postgres + GoTrue + Kong) and the Next.js app. The orchestrator brings them up if needed and records what it started in `<worktree>/.dev-cycle/infra-owned.json` so step 5e tears down only what it owns. Resumed runs read the existing marker first to preserve ownership across `/dev-cycle <name>` re-invocations.

```bash
cd "$WORKTREE"

# Read existing marker (resumed run) or default to "I don't own anything yet".
OWNS_SUPABASE=$(jq -r '.supabase // false' .dev-cycle/infra-owned.json 2>/dev/null || echo false)
OWNS_APP=$(jq -r '.app // false' .dev-cycle/infra-owned.json 2>/dev/null || echo false)

# 1. Supabase: validate via the same CLI the @auth-real suite uses.
if ! npx supabase status -o json >/dev/null 2>&1; then
  if ! npm run supabase:start; then
    # Surface the CLI's stderr in the escalation, mirroring readSupabaseStatus()
    # in playwright.real.config.ts. Don't collapse it into "bootstrap failed".
    exit 1
  fi
  OWNS_SUPABASE=true

  # Orchestrator-owned startup → reset DB so QA gets a clean state.
  # If Supabase was already up (user-owned), DO NOT reset — we'd wipe their data.
  npm run supabase:reset
fi

# 2. Inject Supabase keys into .env.local so the Next.js container picks them up.
# docker-compose.yml only injects DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL via
# hardcoded service hostnames; ANON_KEY and SERVICE_ROLE_KEY must come from the
# running CLI. We write them unconditionally (idempotent) — the values are stable
# for the lifetime of the local stack.
SUPABASE_STATUS_JSON=$(npx supabase status -o json)
ANON_KEY=$(echo "$SUPABASE_STATUS_JSON" | jq -r '.ANON_KEY')
SERVICE_ROLE_KEY=$(echo "$SUPABASE_STATUS_JSON" | jq -r '.SERVICE_ROLE_KEY')
if [ -z "$ANON_KEY" ] || [ "$ANON_KEY" = "null" ]; then
  echo "Could not read ANON_KEY from supabase status — aborting"; exit 1
fi
# Remove stale entries if present, then append current values.
grep -v 'NEXT_PUBLIC_SUPABASE_ANON_KEY\|SUPABASE_SERVICE_ROLE_KEY' .env.local > .env.local.tmp 2>/dev/null || true
mv .env.local.tmp .env.local 2>/dev/null || true
printf 'NEXT_PUBLIC_SUPABASE_ANON_KEY=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' \
  "$ANON_KEY" "$SERVICE_ROLE_KEY" >> .env.local

# 3. App
if ! curl -sf http://localhost:3000 >/dev/null; then
  if ! docker compose up -d; then
    exit 1
  fi
  OWNS_APP=true
fi

# Poll readiness up to 120s; escalate on timeout.
for i in $(seq 1 60); do
  curl -sf http://localhost:3000 >/dev/null && break
  sleep 2
done
curl -sf http://localhost:3000 >/dev/null || { echo "App not reachable after 120s"; exit 1; }

# 4. Persist marker (overwrites — fresh source of truth for step 5e).
mkdir -p .dev-cycle
cat > .dev-cycle/infra-owned.json <<EOF
{
  "supabase": $OWNS_SUPABASE,
  "app": $OWNS_APP,
  "started_at": "$(date -u -Iseconds)"
}
EOF
```

**Ownership matrix** (drives step 5e):

| Initial state             | Bootstrap action                     | Marker                          |
|---------------------------|--------------------------------------|---------------------------------|
| Both already up           | Reuse; no DB reset                   | `{supabase: false, app: false}` |
| Supabase up, app down     | Start app                            | `{supabase: false, app: true}`  |
| Both down                 | Start Supabase, reset DB, start app  | `{supabase: true, app: true}`   |
| Supabase down, app up     | Start Supabase, reset DB             | `{supabase: true, app: false}`  |

The "I started it → I reset the DB" policy is deliberate: never wipe a Supabase the user is also using; always reset one we just brought up so QA sees a clean fixture.

This diverges from the `@auth-real` suite's "validate-only, fail loud" pattern (`playwright.real.config.ts:readSupabaseStatus`). The divergence is conscious — the suite is a one-shot test runner the user invokes manually; `/dev-cycle` is an end-to-end workflow that owns its scratch space.

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

- `clean` → proceed to step 5e (teardown), then step 6.
- `issues-found`:
  - If `QA_ITER >= 3` → stop and escalate. **Do NOT run step 5e** — leave infra up for inspection (see escalation message below).
  - **Loop guard**: same as 4b — compare CRÍTICO/ALTO titles between `qa-<QA_ITER>.md` and `qa-<QA_ITER-1>.md`; halt on identical lists. Same teardown rule: leave infra up.
  - Otherwise: invoke `fullstack-developer` in **fix mode** (see step 6 prompt), passing the QA report path. Then re-invoke `code-reviewer` (one short pass on the new diff — `review-after-qa-<QA_ITER>.md`); if it stays clean, re-invoke `qa-tester` (back to 5c). If the short review fails, treat it as a normal review-fix loop (subject to its own 3-iter cap, shared budget with step 4).

#### 5e. Teardown (orchestrator-owned only, on QA clean)

Runs only when step 5d returned `VERDICT: clean`. Skipped on:
- `VERDICT: issues-found` with cap hit or non-converging loop (infra left up so the user can inspect).
- Any earlier escalation in steps 5a–5d.
- QA skipped at step 5.0 (no marker was written; nothing to tear down).

```bash
cd "$WORKTREE"
[ -f .dev-cycle/infra-owned.json ] || exit 0

OWNS_APP=$(jq -r '.app' .dev-cycle/infra-owned.json)
OWNS_SUPABASE=$(jq -r '.supabase' .dev-cycle/infra-owned.json)

if [ "$OWNS_APP" = "true" ]; then
  docker compose down
fi
if [ "$OWNS_SUPABASE" = "true" ]; then
  npm run supabase:stop
fi
rm -f .dev-cycle/infra-owned.json
```

**Escalation message when leaving infra up** (printed at the cap-hit / non-converging point in step 5d, *before* exiting):

```
QA escalated — infra left up for inspection.
Marker: <worktree>/.dev-cycle/infra-owned.json indicates what /dev-cycle started.
Manual teardown (only what's orchestrator-owned):
  jq -r '.supabase' <worktree>/.dev-cycle/infra-owned.json  # true → npm run supabase:stop
  jq -r '.app' <worktree>/.dev-cycle/infra-owned.json       # true → docker compose down
```

### 6. Fix-mode prompt template (used by 4b and 5d)

When invoking `fullstack-developer` to address feedback:

- **Scope**: worktree path (same as before).
- **Feedback file**: absolute path to `review-N.md` or `qa-N.md`.
- **Fix instruction**: "Address every BLOCKER/HIGH from the review (or every CRÍTICO/ALTO from the QA report). Do not introduce out-of-scope refactors."
- **Re-validation**: the agent follows its built-in "Re-validação escopada" contract (same as section mode, but using `--changed <fix-base>` and `affected_e2e_tags` from the orchestrator). Always scoped, never full.
- **Reporting contract**: same `VERDICT: PASS` / `VERDICT: FAIL` lines as step 3b.

The orchestrator computes `changed_files` itself before invoking the agent — the agent receives it as a plain list in the prompt. The agent extracts the subset matching `src/__tests__/e2e/seeded/**/*.spec.ts` to drive scoped e2e (see the agent's "Re-validação escopada" contract). Per-section e2e covers only the specs the section touched; the regression sweep at step 3c runs the full e2e suite as the safety net.

### 7. Archive in-place

Trigger only when reviewer is clean AND (QA is clean OR QA was skipped at step 5.0). The change is archived inside the worktree on `feature/<name>` so the move + sync land in the same PR as the implementation. **No prompts to the user** — this step is fully non-interactive (defaults below); failures hard-stop before any commits/PR are created.

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

### 8. Commits and PR

Once archive (step 7) completed without unresolved errors:

#### 8a. Per-section commits (already done in step 3b)

Per-section Conventional Commits were created incrementally during step 3b — one commit per section in `tasks.md` order, with subjects derived from the section title (`feat:`/`fix:`/`test:`/`docs:`/`chore:`) and a body listing the subtasks completed plus `OpenSpec change: <name>`. Plus any commits from sweep fixes (step 3c) and review/QA fix iterations (steps 4–5), each made at the time of the fix.

Verify the linear history before proceeding to 8b:

```bash
git -C "$WORKTREE" log --oneline main..HEAD
```

If a section is missing a commit or has a non-CC subject, abort with a diagnostic — this indicates a bug in step 3b or a manual intervention after a step-3b failure that didn't restore the contract. Per-section isolation is by construction; do not fall back to a single combined commit.

#### 8b. Dedicated archive commit

After 8a, stage and commit everything the archive step (7) produced as a single dedicated commit:

```bash
cd "$WORKTREE"
git add \
  openspec/changes/archive/$(date +%F)-<name>/ \
  openspec/specs/
git commit -m "chore(openspec): archive <name> + sync specs

OpenSpec change: <name>
- Archived to openspec/changes/archive/$(date +%F)-<name>/
- Synced delta specs into openspec/specs/<cap>/spec.md (see .dev-cycle/sync-summary.md)"
```

Notes:
- The `mv` from step 7.3 shows up as a rename in `git status`; `git add openspec/changes/archive/<dated>/` stages the rename plus any modifications.
- `git add openspec/specs/` picks up sync edits from step 7.2.
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

Sections: S/S complete (M/M subtasks)
Worktree: ../hubrityp-<name>/ (branch: feature/<name>)
Review iterations: X/3
QA: <Y/3 | skipped (backend-only heuristic)>
Infra: <torn down (orchestrator-owned: supabase=<bool>, app=<bool>) | reused user-owned, no teardown | left up — QA escalated, manual teardown noted above>
Archive: openspec/changes/archive/YYYY-MM-DD-<name>/
  - Specs synced: <list or "none">
Commits created: <count> per-section + 1 archive commit
Reports: .dev-cycle/{review-1.md, ..., qa-1.md, ..., sync-summary.md, infra-owned.json (if QA escalated)}
PR: <url>
```

---

## Loop prevention summary

| Loop | Cap | On cap-hit |
|---|---|---|
| Dev internal retries per section | 3 | Pause, show logs, wait for user |
| dev ↔ code-reviewer (post-sections) | 3 | Pause, list persistent BLOCKER/HIGH |
| dev ↔ qa-tester | 3 | Pause, list persistent CRÍTICO/ALTO |
| Same finding repeats 2× consecutively | immediate | Pause (non-converging signal) |

---

## Resume behavior

`/dev-cycle <name>` is interruptible and idempotent:
- Detects an existing worktree and reuses it.
- Skips sections fully complete (every subtask `[x]`); refuses to resume a section in mixed `[x]`/`[ ]` state.
- Preserves prior `.dev-cycle/*.md` reports and counts them when applying the iteration cap (does not start `REVIEW_ITER` from 0 if `.dev-cycle/review-*.md` already exists; pick up where it stopped).

---

## Out of scope

- Does not run in CI (this is a local-first workflow that needs a real browser for QA).
- Does not parallelize tasks within a change (sequential by design — ordering matters in OpenSpec tasks).
- Does not support OpenSpec schemas other than `spec-driven`.
- Does not create the change itself — use `/opsx:new` or `/opsx:ff` first.
